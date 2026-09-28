// Private artwork store: public uploads require explicit consent; every read requires admin login.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
async function digest(value) { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function signature(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
async function signedSession(env) {
  const expiry = Date.now() + 8 * 3600 * 1000;
  const payload = `${expiry}.${crypto.randomUUID()}`;
  return `${payload}.${await signature(payload, env.SESSION_SECRET)}`;
}
async function authorized(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const match = token.match(/^(\d+)\.([\w-]+)\.([\w-]+)$/);
  if (!match || Number(match[1]) < Date.now() || Number(match[1]) > Date.now() + 8 * 3600 * 1000) return false;
  return equal(match[3], await signature(`${match[1]}.${match[2]}`, env.SESSION_SECRET));
}
async function consumeLimit(env, key, max, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, updated_at FROM limits WHERE key = ?").bind(key).first();
  if (row && now - row.updated_at < windowMs && row.count >= max) return false;
  await env.DB.prepare("INSERT INTO limits (key,count,updated_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = ?, updated_at = ?")
    .bind(key, now, row && now - row.updated_at < windowMs ? row.count + 1 : 1, row && now - row.updated_at < windowMs ? row.updated_at : now).run();
  return true;
}
function imageSize(bytes) {
  if (bytes.byteLength < 24) return null;
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!png.every((value, index) => bytes[index] === value) || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = data.getUint32(16), height = data.getUint32(20);
  return width > 0 && height > 0 && width <= 6000 && height <= 6000 ? { width, height } : null;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = origin === env.ALLOWED_ORIGIN;
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Artist-Name, X-Exhibition-Consent", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Vary": "Origin" } : {};
    const reply = (body, status = 200) => json(body, status, cors);
    if (!env.DB || !env.ARTWORKS || !env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.ALLOWED_ORIGIN) return reply({ error: "服务尚未配置" }, 503);
    if (request.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors }) : reply({ error: "来源无效" }, 403);
    if (!allowed) return reply({ error: "来源无效" }, 403);
    const path = new URL(request.url).pathname;
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const client = b64((await digest(`${env.SESSION_SECRET}:${ip}`)).slice(0, 12));
    try {
      if ((path === "/api/artworks" && request.method === "POST") || (/^\/api\/artworks\/[a-f0-9-]{36}$/.test(path) && request.method === "PUT")) {
        if (request.headers.get("X-Exhibition-Consent") !== "notice") return reply({ error: "需要同意提交作品" }, 400);
        if (request.headers.get("Content-Type") !== "image/png") return reply({ error: "只接收 PNG 作品" }, 415);
        if (Number(request.headers.get("Content-Length")) > MAX_IMAGE_BYTES) return reply({ error: "图片超过 5 MB" }, 413);
        if (!await consumeLimit(env, `upload:${client}`, 10000, 24 * 3600 * 1000)) return reply({ error: "今日提交次数已达上限" }, 429);
        const bytes = new Uint8Array(await request.arrayBuffer());
        const dimensions = bytes.byteLength <= MAX_IMAGE_BYTES ? imageSize(bytes) : null;
        if (!dimensions) return reply({ error: "PNG 图片无效或超过 5 MB" }, 400);
        if (request.method === "PUT") {
          const id = path.split("/").pop();
          const row = await env.DB.prepare("SELECT object_key,edit_hash FROM artworks WHERE id = ?").bind(id).first();
          const credential = request.headers.get("X-Edit-Token") || "";
          if (!row || !credential || !equal(row.edit_hash, b64(await digest(credential)))) return reply({ error: "无法更新作品" }, 403);
          await env.ARTWORKS.put(row.object_key, bytes, { httpMetadata: { contentType: "image/png" } });
          await env.DB.prepare("UPDATE artworks SET bytes=?,width=?,height=?,updated_at=? WHERE id=?").bind(bytes.byteLength, dimensions.width, dimensions.height, new Date().toISOString(), id).run();
          return reply({ id });
        }
        const id = crypto.randomUUID(), editToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const key = `artworks/${now.slice(0, 10)}/${id}.png`;
        await env.ARTWORKS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
        try {
          await env.DB.prepare("INSERT INTO artworks (id,artist,object_key,edit_hash,created_at,updated_at,bytes,width,height) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(id, "", key, b64(await digest(editToken)), now, now, bytes.byteLength, dimensions.width, dimensions.height).run();
        } catch (error) { await env.ARTWORKS.delete(key); throw error; }
        return reply({ id, edit_token: editToken, created_at: now }, 201);
      }
      if (path === "/api/admin/login" && request.method === "POST") {
        if (!await consumeLimit(env, `login:${client}`, 8, 15 * 60 * 1000)) return reply({ error: "尝试过多，请稍后再试" }, 429);
        const body = await request.json();
        if (!body || typeof body.password !== "string" || !equal(b64(await digest(body.password)), b64(await digest(env.ADMIN_PASSWORD)))) return reply({ error: "密码错误" }, 401);
        return reply({ token: await signedSession(env) });
      }
      if (!path.startsWith("/api/admin/") || !await authorized(request, env)) return reply({ error: "未授权" }, 401);
      if (path === "/api/admin/artworks" && request.method === "GET") {
        const page = Math.max(0, Math.min(10000, Number.parseInt(new URL(request.url).searchParams.get("page") || "0", 10) || 0));
        const works = await env.DB.prepare("SELECT id, artist, created_at, updated_at, bytes, width, height, print_count FROM artworks ORDER BY created_at DESC LIMIT 48 OFFSET ?").bind(page * 48).all();
        const stats = await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(print_count),0) AS prints, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today FROM artworks").bind(new Date().toISOString().slice(0, 10)).first();
        return reply({ works: works.results, stats, page });
      }
      const match = path.match(/^\/api\/admin\/artworks\/([a-f0-9-]{36})(?:\/(image|print))?$/);
      if (!match) return reply({ error: "未找到" }, 404);
      const work = await env.DB.prepare("SELECT * FROM artworks WHERE id = ?").bind(match[1]).first();
      if (!work) return reply({ error: "作品不存在" }, 404);
      if (match[2] === "image" && request.method === "GET") {
        const object = await env.ARTWORKS.get(work.object_key);
        return object ? new Response(object.body, { headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="manana-${work.id}.png"` } }) : reply({ error: "图片不存在" }, 404);
      }
      if (match[2] === "print" && request.method === "PATCH") {
        await env.DB.prepare("UPDATE artworks SET print_count = print_count + 1 WHERE id = ?").bind(work.id).run();
        return reply({ ok: true });
      }
      if (!match[2] && request.method === "DELETE") {
        await env.ARTWORKS.delete(work.object_key);
        await env.DB.prepare("DELETE FROM artworks WHERE id = ?").bind(work.id).run();
        return reply({ ok: true });
      }
      return reply({ error: "不支持此操作" }, 405);
    } catch (error) {
      console.error("Artwork API failure", error);
      return reply({ error: "服务器暂时无法处理，请稍后重试" }, 500);
    }
  }
};
