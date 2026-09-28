(function () {
  "use strict";
  const apiBase = (window.MANANA_ARTWORKS_API || "").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  const message = text => { $("message").textContent = text; };
  let token = sessionStorage.getItem("manana-admin-token") || "";
  let page = 0, works = [], selected = null, imageUrl = "";
  const thumbnails = new Map();
  async function request(path, options = {}) {
    if (!apiBase) throw new Error("作品库服务尚未配置");
    const response = await fetch(apiBase + path, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) } });
    if (response.status === 401 && path !== "/api/admin/login") { logout(); throw new Error("登录已失效，请重新登录"); }
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "操作失败"); }
    return response;
  }
  function logout() { thumbnails.forEach(item => URL.revokeObjectURL(item.url)); thumbnails.clear(); token = ""; sessionStorage.removeItem("manana-admin-token"); $("dashboard").hidden = true; $("loginPanel").hidden = false; $("logout").hidden = true; closeViewer(); }
  async function imageBlob(work) {
    const response = await request("/api/admin/artworks/" + work.id + "/image");
    return URL.createObjectURL(await response.blob());
  }
  async function load() {
    message("正在读取作品…");
    const result = await (await request("/api/admin/artworks?page=" + page)).json();
    works = result.works;
    $("total").textContent = result.stats.total;
    $("today").textContent = result.stats.today || 0;
    $("prints").textContent = result.stats.prints;
    $("pageLabel").textContent = "第 " + (page + 1) + " 页";
    $("previous").disabled = page === 0; $("next").disabled = works.length < 48;
    const gallery = $("gallery");
    gallery.replaceChildren();
    if (!works.length) gallery.textContent = "这一页暂无作品";
    works.forEach(async work => {
      const card = document.createElement("button"), img = document.createElement("img"), meta = document.createElement("div"), name = document.createElement("b"), date = document.createElement("small");
      card.className = "card"; img.alt = work.artist || "匿名作品"; img.loading = "lazy";
      name.textContent = work.artist || "匿名作品"; date.textContent = new Date(work.created_at).toLocaleString("zh-CN") + " · 已打印 " + work.print_count;
      meta.append(name, date); card.append(img, meta); gallery.append(card);
      card.addEventListener("click", () => openViewer(work));
      try {
        const cached = thumbnails.get(work.id);
        if (cached && cached.version === work.updated_at) { img.src = cached.url; return; }
        const url = await imageBlob(work);
        if (cached) URL.revokeObjectURL(cached.url);
        thumbnails.set(work.id, { version: work.updated_at, url });
        if (card.isConnected) img.src = url;
      } catch (_) { img.alt = "图片读取失败"; }
    });
    message("");
  }
  async function openViewer(work) {
    selected = work; $("viewer").hidden = false; $("viewerMeta").textContent = "图片加载中…";
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    try {
      const url = await imageBlob(work);
      if (selected !== work) { URL.revokeObjectURL(url); return; }
      imageUrl = url; $("largeImage").src = url;
      $("viewerMeta").textContent = (work.artist || "匿名作品") + " · " + new Date(work.created_at).toLocaleString("zh-CN") + " · " + work.width + "×" + work.height + " · 打印 " + work.print_count + " 次";
    } catch (error) { message(error.message); closeViewer(); }
  }
  function closeViewer() { selected = null; $("viewer").hidden = true; $("largeImage").removeAttribute("src"); if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; }
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const result = await (await request("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) })).json();
      token = result.token; sessionStorage.setItem("manana-admin-token", token); $("password").value = "";
      $("loginPanel").hidden = true; $("dashboard").hidden = false; $("logout").hidden = false; await load();
    } catch (error) { message(error.message); }
  });
  $("logout").addEventListener("click", logout);
  $("refresh").addEventListener("click", () => load().catch(error => message(error.message)));
  $("previous").addEventListener("click", () => { if (page) { page--; load().catch(error => message(error.message)); } });
  $("next").addEventListener("click", () => { page++; load().catch(error => message(error.message)); });
  $("closeViewer").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", event => { if (event.target === $("viewer")) closeViewer(); });
  $("downloadImage").addEventListener("click", () => { if (!selected || !imageUrl) return; const link = document.createElement("a"); link.href = imageUrl; link.download = "manana-" + selected.id + ".jpg"; link.click(); });
  $("printImage").addEventListener("click", async () => {
    if (!selected || !imageUrl) return;
    try { await request("/api/admin/artworks/" + selected.id + "/print", { method: "PATCH" }); selected.print_count++; $("viewerMeta").textContent += " · 已记录打印"; window.print(); load().catch(error => message(error.message)); }
    catch (error) { message(error.message); }
  });
  $("deleteImage").addEventListener("click", async () => {
    if (!selected || !confirm("确定永久删除这幅作品吗？")) return;
    try { await request("/api/admin/artworks/" + selected.id, { method: "DELETE" }); closeViewer(); await load(); }
    catch (error) { message(error.message); }
  });
  if (token) { $("loginPanel").hidden = true; $("dashboard").hidden = false; $("logout").hidden = false; load().catch(error => message(error.message)); }
  else if (!apiBase) message("作品库服务尚未配置，管理员暂时无法登录。");
  setInterval(function () { if (token && $("viewer").hidden && !document.hidden) load().catch(error => message(error.message)); }, 5000);
})();
