// Cloudflare Worker：編輯後台 + API
// 安全設計（由外而內）：
//   1) Cloudflare Access 在最外層擋住不在名單內的人（登入網址）。
//   2) 這個 Worker 再驗證一次 Access 簽發的 JWT，並比對 EDITORS 名單（雙重保險）。
//   3) 寫入 GitHub 用的 Token 只存在 Worker 的 Secret，瀏覽器看不到。
//   4) 所有內容在伺服器端重新檢查格式，圖片只收真正的 jpg/png/gif/webp。

const BLOCK_TYPES = new Set(['p', 'h2', 'h3', 'note', 'verse', 'img']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status, error) => json({ error }, status);

// ---------- Base64 / UTF-8 ----------
const b64uToBytes = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const utf8ToB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

// ---------- Cloudflare Access JWT 驗證 ----------
let jwksCache = { keys: [], at: 0 };
async function getKeys(env, force) {
  if (!force && jwksCache.keys.length && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('cannot load Access certs');
  jwksCache = { keys: (await r.json()).keys || [], at: Date.now() };
  return jwksCache.keys;
}

export async function verifyAccess(request, env) {
  // 本機開發才用：在 .dev.vars 設定 DEV_EMAIL。正式環境絕對不要設。
  if (env.DEV_EMAIL) return env.DEV_EMAIL.toLowerCase();

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
    if (header.alg !== 'RS256') return null;
    let keys = await getKeys(env, false);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { keys = await getKeys(env, true); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (!p.exp || p.exp < now) return null;
    if (p.nbf && p.nbf > now + 60) return null;
    if (p.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    return typeof p.email === 'string' ? p.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

const editors = (env) => (env.EDITORS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ---------- GitHub Contents API ----------
async function gh(env, method, path, body) {
  const url = `https://api.github.com/repos/${env.GH_REPO}/contents/${path}` + (method === 'GET' ? `?ref=${encodeURIComponent(env.GH_BRANCH || 'main')}` : '');
  const r = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'rebukanostory-admin',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify({ branch: env.GH_BRANCH || 'main', ...body }) : undefined,
  });
  return r;
}
async function readJSON(env, path) {
  const r = await gh(env, 'GET', path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const d = await r.json();
  return { data: JSON.parse(b64ToUtf8(d.content)), sha: d.sha };
}
async function writeJSON(env, path, data, message, sha) {
  const r = await gh(env, 'PUT', path, { message, content: utf8ToB64(JSON.stringify(data, null, 2) + '\n'), ...(sha ? { sha } : {}) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return { sha: (await r.json()).content.sha };
}

// 更新 index.json（遇到同時編輯就重試一次）
async function updateIndex(env, mutate, message) {
  for (let i = 0; i < 3; i++) {
    const cur = await readJSON(env, 'content/index.json');
    if (!cur) throw new Error('content/index.json 不存在');
    mutate(cur.data);
    const res = await writeJSON(env, 'content/index.json', cur.data, message, cur.sha);
    if (!res.conflict) return;
  }
  throw new Error('index.json 更新衝突，請稍後再試');
}

// ---------- 內容檢查 ----------
export function sanitizePage(input) {
  if (!input || typeof input !== 'object') throw new Error('資料格式錯誤');
  const title = String(input.title || '').trim();
  if (!title || title.length > 200) throw new Error('標題不可空白，且不超過 200 字');
  if (!Array.isArray(input.blocks) || input.blocks.length > 3000) throw new Error('內容區塊格式錯誤');
  const blocks = input.blocks.map((b) => {
    if (!b || !BLOCK_TYPES.has(b.type)) throw new Error('不支援的區塊類型');
    if (b.type === 'img') {
      if (typeof b.src !== 'string' || !/^assets\/img\/[A-Za-z0-9._-]+$/.test(b.src)) throw new Error('圖片路徑不合法');
      return { type: 'img', src: b.src, alt: String(b.alt || '').slice(0, 300), caption: String(b.caption || '').slice(0, 300) };
    }
    const text = String(b.text ?? '');
    if (text.length > 30000) throw new Error('單一區塊文字過長');
    return { type: b.type, text };
  });
  const out = { title, published: input.published === true, updated: new Date().toISOString(), blocks };
  if (typeof input.source === 'string' && /^https:\/\/rebukamnostory\.wixsite\.com\//.test(input.source)) out.source = input.source;
  return out;
}

function imageExt(bytes) {
  const s = (a) => String.fromCharCode(...bytes.subarray(a[0], a[1]));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && s([1, 4]) === 'PNG') return 'png';
  if (s([0, 4]) === 'GIF8') return 'gif';
  if (s([0, 4]) === 'RIFF' && s([8, 12]) === 'WEBP') return 'webp';
  return null;
}

// ---------- 路由 ----------
async function api(request, env, url, email) {
  const method = request.method;
  const path = url.pathname;

  if (method !== 'GET') {
    // 防 CSRF：寫入請求必須來自同一個網站
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== url.host) return fail(403, '來源不符');
  }

  if (path === '/api/me') return json({ email, siteUrl: env.SITE_URL || '' });

  if (path === '/api/index' && method === 'GET') {
    const cur = await readJSON(env, 'content/index.json');
    return cur ? json(cur.data) : fail(404, '找不到 index.json');
  }

  if (path === '/api/site' && method === 'PUT') {
    const b = await request.json();
    const title = String(b.title || '').trim().slice(0, 100);
    const subtitle = String(b.subtitle || '').trim().slice(0, 200);
    if (!title) return fail(400, '網站名稱不可空白');
    await updateIndex(env, (d) => { d.site = { title, subtitle }; }, '更新網站名稱');
    return json({ ok: true });
  }

  if (path === '/api/reorder' && method === 'POST') {
    const { slugs } = await request.json();
    if (!Array.isArray(slugs)) return fail(400, '格式錯誤');
    await updateIndex(env, (d) => {
      const map = new Map(d.pages.map((p) => [p.slug, p]));
      if (slugs.length !== map.size || slugs.some((s) => !map.has(s)) || new Set(slugs).size !== slugs.length) throw new Error('順序資料與現有頁面不符，請重新整理後再試');
      d.pages = slugs.map((s) => map.get(s));
    }, '調整章節順序');
    return json({ ok: true });
  }

  if (path === '/api/upload' && method === 'POST') {
    const { filename, data } = await request.json();
    if (typeof data !== 'string' || data.length > 6_000_000) return fail(413, '圖片太大（上限約 4.5 MB）');
    let bytes;
    try { bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { return fail(400, '圖片資料錯誤'); }
    const ext = imageExt(bytes);
    if (!ext) return fail(415, '只接受 JPG、PNG、GIF、WebP 圖片');
    const base = String(filename || 'img').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'img';
    const name = `${Date.now().toString(36)}-${base}.${ext}`;
    const r = await gh(env, 'PUT', `assets/img/${name}`, { message: `上傳圖片 ${name}`, content: data });
    if (!r.ok) return fail(502, `GitHub 寫入失敗（${r.status}）`);
    return json({ src: `assets/img/${name}` });
  }

  const m = path.match(/^\/api\/page\/([^/]+)$/);
  if (m) {
    const slug = m[1];
    if (slug !== '_home' && !SLUG_RE.test(slug)) return fail(400, '網址代號只能用小寫英文、數字與連字號');
    const file = `content/pages/${slug}.json`;

    if (method === 'GET') {
      const cur = await readJSON(env, file);
      return cur ? json({ page: cur.data, sha: cur.sha }) : fail(404, '找不到頁面');
    }
    if (method === 'PUT') {
      const { page, sha } = await request.json();
      let clean;
      try { clean = sanitizePage(page); } catch (e) { return fail(400, e.message); }
      if (slug === '_home') clean.published = true;
      const res = await writeJSON(env, file, clean, `${sha ? '編輯' : '新增'}頁面：${slug}${clean.published ? '（已發布）' : '（草稿）'}`, sha || undefined);
      if (res.conflict) return fail(409, sha ? '這個頁面剛剛被別人修改過，請重新載入後再編輯。' : '這個網址代號已經有頁面了，請換一個。');
      if (slug !== '_home') {
        await updateIndex(env, (d) => {
          const row = d.pages.find((p) => p.slug === slug);
          if (row) Object.assign(row, { title: clean.title, published: clean.published, updated: clean.updated });
          else d.pages.push({ slug, title: clean.title, published: clean.published, updated: clean.updated });
        }, `更新目錄：${slug}`);
      }
      return json({ ok: true, sha: res.sha, updated: clean.updated });
    }
    if (method === 'DELETE') {
      if (slug === '_home') return fail(400, '首頁不能刪除');
      const cur = await readJSON(env, file);
      if (!cur) return fail(404, '找不到頁面');
      const r = await gh(env, 'DELETE', file, { message: `刪除頁面：${slug}`, sha: cur.sha });
      if (!r.ok) return fail(502, `GitHub 刪除失敗（${r.status}）`);
      await updateIndex(env, (d) => { d.pages = d.pages.filter((p) => p.slug !== slug); }, `更新目錄：移除 ${slug}`);
      return json({ ok: true });
    }
  }
  return fail(404, 'Not found');
}

const ADMIN_CSP = "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const email = await verifyAccess(request, env);
    if (!email || !editors(env).includes(email)) {
      if (url.pathname.startsWith('/api/')) return fail(403, '你沒有編輯權限');
      return new Response('403 — 這個帳號沒有編輯權限。', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url, email); }
      catch (e) { return fail(500, e.message || '伺服器錯誤'); }
    }
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    h.set('content-security-policy', ADMIN_CSP);
    h.set('x-content-type-options', 'nosniff');
    h.set('referrer-policy', 'no-referrer');
    h.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers: h });
  },
};
