// Private artwork store: compressed JPEGs live in D1; every read requires admin login.
const MAX_IMAGE_BYTES = 1800000;
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
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    let marker = bytes[offset++];
    while (marker === 0xff) marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker) && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 && width <= 6000 && height <= 6000 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = origin === env.ALLOWED_ORIGIN;
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Edit-Token, X-Exhibition-Consent", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "Vary": "Origin" } : {};
    const reply = (body, status = 200) => json(body, status, cors);
    if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.ALLOWED_ORIGIN) return reply({ error: "服务尚未配置" }, 503);
    if (request.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors }) : reply({ error: "来源无效" }, 403);
    if (!allowed) return reply({ error: "来源无效" }, 403);
    const path = new URL(request.url).pathname;
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const client = b64((await digest(`${env.SESSION_SECRET}:${ip}`)).slice(0, 12));
    try {
      if ((path === "/api/artworks" && request.method === "POST") || (/^\/api\/artworks\/[a-f0-9-]{36}$/.test(path) && request.method === "PUT")) {
        if (request.headers.get("X-Exhibition-Consent") !== "notice") return reply({ error: "需要同意提交作品" }, 400);
        if (request.headers.get("Content-Type") !== "image/jpeg") return reply({ error: "只接收 JPEG 作品" }, 415);
        if (Number(request.headers.get("Content-Length")) > MAX_IMAGE_BYTES) return reply({ error: "图片超过 1.8 MB" }, 413);
        if (!await consumeLimit(env, `upload:${client}`, 10000, 24 * 3600 * 1000)) return reply({ error: "今日提交次数已达上限" }, 429);
        const bytes = new Uint8Array(await request.arrayBuffer());
        const dimensions = bytes.byteLength <= MAX_IMAGE_BYTES ? imageSize(bytes) : null;
        if (!dimensions) return reply({ error: "JPEG 图片无效或超过 1.8 MB" }, 400);
        if (request.method === "PUT") {
          const id = path.split("/").pop();
          const row = await env.DB.prepare("SELECT edit_hash FROM artworks WHERE id = ?").bind(id).first();
          const credential = request.headers.get("X-Edit-Token") || "";
          if (!row || !credential || !equal(row.edit_hash, b64(await digest(credential)))) return reply({ error: "无法更新作品" }, 403);
          await env.DB.prepare("UPDATE artworks SET image=?,bytes=?,width=?,height=?,updated_at=? WHERE id=?").bind(bytes, bytes.byteLength, dimensions.width, dimensions.height, new Date().toISOString(), id).run();
          return reply({ id });
        }
        const id = crypto.randomUUID(), editToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        await env.DB.prepare("INSERT INTO artworks (id,artist,image,edit_hash,created_at,updated_at,bytes,width,height) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, "", bytes, b64(await digest(editToken)), now, now, bytes.byteLength, dimensions.width, dimensions.height).run();
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
      const work = await env.DB.prepare("SELECT id,print_count FROM artworks WHERE id = ?").bind(match[1]).first();
      if (!work) return reply({ error: "作品不存在" }, 404);
      if (match[2] === "image" && request.method === "GET") {
        const image = await env.DB.prepare("SELECT image FROM artworks WHERE id = ?").bind(work.id).first();
        return image ? new Response(new Uint8Array(image.image), { headers: { ...cors, "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="manana-${work.id}.jpg"` } }) : reply({ error: "图片不存在" }, 404);
      }
      if (match[2] === "print" && request.method === "PATCH") {
        await env.DB.prepare("UPDATE artworks SET print_count = print_count + 1 WHERE id = ?").bind(work.id).run();
        return reply({ ok: true });
      }
      if (!match[2] && request.method === "DELETE") {
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
