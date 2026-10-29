// 不需要網路與帳號的自動測試：node test/worker.test.mjs
import assert from 'node:assert/strict';
import worker, { sanitizePage } from '../src/index.js';

const CID = 'client123.apps.googleusercontent.com';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function gtoken({ email, aud = CID, iss = 'https://accounts.google.com', exp = Math.floor(Date.now() / 1000) + 600, verified = true, key = kp.privateKey }) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), p = b64u(JSON.stringify({ email, aud, iss, exp, email_verified: verified }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(sig)}`;
}

// 假 GitHub（記憶體）
const files = new Map();
const put = (path, obj) => files.set(path, { content: Buffer.from(JSON.stringify(obj)).toString('base64'), sha: 'sha' + Math.random().toString(36).slice(2) });
put('content/index.json', { site: { title: 'T', subtitle: 'S' }, pages: [{ slug: 'ch-1', title: 'One', published: true, updated: 'x' }] });
put('content/pages/ch-1.json', { title: 'One', published: true, blocks: [{ type: 'p', text: 'hi' }] });
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('googleapis.com/oauth2/v3/certs')) return Response.json({ keys: [jwk] });
  const m = url.match(/contents\/([^?]+)/);
  if (!m) return new Response('nope', { status: 404 });
  const path = decodeURIComponent(m[1]); const method = init.method || 'GET';
  calls.push(method + ' ' + path);
  if (method === 'GET') { const f = files.get(path); return f ? Response.json(f) : new Response('{}', { status: 404 }); }
  const body = JSON.parse(init.body); const cur = files.get(path);
  if (method === 'DELETE') { if (!cur || cur.sha !== body.sha) return new Response('{}', { status: 409 }); files.delete(path); return Response.json({}); }
  if (cur && cur.sha !== body.sha) return new Response('{}', { status: 422 }); // 已存在但沒給對的 sha
  const sha = 'sha' + Math.random().toString(36).slice(2);
  files.set(path, { content: body.content, sha });
  return Response.json({ content: { sha } });
};

const env = { GOOGLE_CLIENT_ID: CID, EDITORS: 'rjian@st-laurentacademy.com, Bremen2006@gmail.com', GH_REPO: 'o/r', GH_BRANCH: 'main', GH_TOKEN: 'ghp_test_secret', ASSETS: { fetch: async () => new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }) } };
const BASE = 'https://admin.example.dev';
const req = async (method, path, { body, tok, origin = BASE } = {}) => {
  const headers = {}; if (tok) headers.cookie = 'rbs_session=' + tok; if (body) headers['content-type'] = 'application/json'; if (method !== 'GET' && origin) headers.origin = origin;
  return worker.fetch(new Request(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
};
let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

const login = async (email, opts = {}) => {
  const r = await worker.fetch(new Request(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: opts.origin ?? BASE }, body: JSON.stringify({ credential: opts.cred ?? await gtoken({ email, ...opts.t }) }) }), env);
  return r;
};
const sess = (r) => (r.headers.get('set-cookie') || '').match(/rbs_session=([^;]+)/)?.[1];

// --- 登入與權限 ---
assert.equal((await req('GET', '/api/me')).status, 401); ok('沒登入 → 401');
assert.equal((await req('GET', '/api/me', { tok: 'abc.def' })).status, 401); ok('亂填的 Cookie → 401');
assert.equal((await req('GET', '/')).status, 200); ok('後台頁面只有登入畫面與程式，可公開讀取');
assert.equal((await (await req('GET', '/api/config')).json()).clientId, CID); ok('公開設定只給出 Google 用戶端 ID');
assert.equal((await login('evil@x.com')).status, 403); ok('Google 驗證通過但不在名單 → 403，且沒有 Cookie');
assert.equal(sess(await login('evil@x.com')), undefined); ok('不在名單不會發 Cookie');
assert.equal((await login('rjian@st-laurentacademy.com', { t: { aud: 'other' } })).status, 401); ok('發給別的網站的 token（aud 不符）→ 401');
assert.equal((await login('rjian@st-laurentacademy.com', { t: { iss: 'https://evil.com' } })).status, 401); ok('iss 不符 → 401');
assert.equal((await login('rjian@st-laurentacademy.com', { t: { exp: 1 } })).status, 401); ok('過期的 Google token → 401');
assert.equal((await login('rjian@st-laurentacademy.com', { t: { verified: false } })).status, 401); ok('Email 未驗證 → 401');
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
assert.equal((await login('rjian@st-laurentacademy.com', { t: { key: other.privateKey } })).status, 401); ok('偽造簽章 → 401');
assert.equal((await login('x', { cred: 'not-a-jwt' })).status, 401); ok('亂填憑證 → 401');
assert.equal((await login('rjian@st-laurentacademy.com', { origin: 'https://evil.com' })).status, 403); ok('跨站登入請求 → 403');
let lr = await login('rjian@st-laurentacademy.com'); assert.equal(lr.status, 200);
const ck = lr.headers.get('set-cookie'); assert.match(ck, /HttpOnly/); assert.match(ck, /Secure/); assert.match(ck, /SameSite=Strict/); ok('編輯者 1 登入成功，Cookie 帶 HttpOnly/Secure/SameSite=Strict');
const good = sess(lr);
const good2 = sess(await login('Bremen2006@Gmail.com')); assert.ok(good2); ok('編輯者 2 登入成功（大小寫不影響）');
let r = await req('GET', '/api/me', { tok: good }); assert.equal((await r.json()).email, 'rjian@st-laurentacademy.com'); ok('帶 Cookie 可讀 /api/me');
assert.equal((await req('GET', '/api/me', { tok: good.slice(0, -3) + 'AAA' })).status, 401); ok('竄改 Cookie 簽章 → 401');
const [body] = good.split('.'); const forged = Buffer.from(JSON.stringify({ e: 'evil@x.com', x: 9999999999 })).toString('base64url');
assert.equal((await req('GET', '/api/me', { tok: forged + '.' + good.split('.')[1] })).status, 401); ok('偽造別人的 Cookie 內容 → 401');
const expired = await (async () => { const real = Date.now; Date.now = () => real() + 13 * 3600_000; const st = (await req('GET', '/api/me', { tok: good })).status; Date.now = real; return st; })();
assert.equal(expired, 401); ok('超過 12 小時 Cookie 失效');
r = await req('GET', '/', { tok: good }); assert.match(r.headers.get('content-security-policy'), /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/); ok('後台頁面帶 CSP 標頭');
r = await req('POST', '/api/logout', { tok: good, body: {} }); assert.match(r.headers.get('set-cookie'), /Max-Age=0/); ok('登出會清除 Cookie');

// --- CSRF ---
assert.equal((await req('PUT', '/api/page/ch-1', { tok: good, body: {}, origin: 'https://evil.com' })).status, 403); ok('跨站寫入 → 403');
assert.equal((await req('PUT', '/api/page/ch-1', { tok: good, body: {}, origin: null })).status, 403); ok('缺 Origin 的寫入 → 403');

// --- 讀 ---
r = await req('GET', '/api/index', { tok: good }); assert.equal((await r.json()).pages.length, 1); ok('讀目錄');
r = await req('GET', '/api/page/ch-1', { tok: good }); const d = await r.json(); assert.equal(d.page.title, 'One'); ok('讀頁面（含 sha）');
assert.equal((await req('GET', '/api/page/..%2Fsecret', { tok: good })).status, 400); ok('路徑穿越的代號被擋');

// --- 新增 / 發布 ---
const page = { title: '新章節', published: false, blocks: [{ type: 'p', text: '內容' }] };
r = await req('PUT', '/api/page/ch-16', { tok: good, body: { page } }); assert.equal(r.status, 200); ok('新增草稿頁面');
let idx = JSON.parse(Buffer.from(files.get('content/index.json').content, 'base64'));
assert.equal(idx.pages.length, 2); assert.equal(idx.pages[1].published, false); ok('目錄已加入新頁（草稿）');
r = await req('PUT', '/api/page/ch-16', { tok: good, body: { page } }); assert.equal(r.status, 409); ok('重複的網址代號 → 409');
const sha = files.get('content/pages/ch-16.json').sha;
r = await req('PUT', '/api/page/ch-16', { tok: good2, body: { page: { ...page, published: true }, sha } }); assert.equal(r.status, 200); ok('編輯者 2 發布');
idx = JSON.parse(Buffer.from(files.get('content/index.json').content, 'base64')); assert.equal(idx.pages[1].published, true); ok('目錄顯示已發布');
r = await req('PUT', '/api/page/ch-16', { tok: good, body: { page, sha } }); assert.equal(r.status, 409); ok('用舊 sha 編輯 → 衝突 409');

// --- 內容檢查 ---
assert.throws(() => sanitizePage({ title: '', blocks: [] })); ok('空標題被拒');
assert.throws(() => sanitizePage({ title: 'a', blocks: [{ type: 'script', text: 'x' }] })); ok('未知區塊類型被拒');
assert.throws(() => sanitizePage({ title: 'a', blocks: [{ type: 'img', src: 'https://evil/x.png' }] })); ok('外部圖片網址被拒');
assert.throws(() => sanitizePage({ title: 'a', blocks: [{ type: 'img', src: 'assets/img/../../x' }] })); ok('圖片路徑穿越被拒');
const s = sanitizePage({ title: 'a', published: 'yes', blocks: [{ type: 'p', text: '<script>alert(1)</script>', extra: 1 }] });
assert.equal(s.published, false); assert.deepEqual(Object.keys(s.blocks[0]), ['type', 'text']); ok('published 只接受 true；多餘欄位被丟掉');

// --- 排序 / 刪除 ---
r = await req('POST', '/api/reorder', { tok: good, body: { slugs: ['ch-16', 'ch-1'] } }); assert.equal(r.status, 200);
idx = JSON.parse(Buffer.from(files.get('content/index.json').content, 'base64')); assert.equal(idx.pages[0].slug, 'ch-16'); ok('調整順序');
r = await req('POST', '/api/reorder', { tok: good, body: { slugs: ['ch-16'] } }); assert.equal(r.status, 500); ok('順序資料不完整被拒');
r = await req('DELETE', '/api/page/ch-16', { tok: good }); assert.equal(r.status, 200); assert.ok(!files.has('content/pages/ch-16.json')); ok('刪除頁面');
assert.equal((await req('DELETE', '/api/page/_home', { tok: good })).status, 400); ok('首頁不能刪');

// --- 圖片上傳 ---
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]).toString('base64');
r = await req('POST', '/api/upload', { tok: good, body: { filename: 'My Photo.PNG', data: png } }); assert.equal(r.status, 200);
const up = await r.json(); assert.match(up.src, /^assets\/img\/[a-z0-9]+-my-photo\.png$/); ok('上傳 PNG 成功：' + up.src);
r = await req('POST', '/api/upload', { tok: good, body: { filename: 'x.png', data: Buffer.from('<svg onload=alert(1)>').toString('base64') } }); assert.equal(r.status, 415); ok('偽裝成圖片的 SVG/文字被拒');
r = await req('POST', '/api/upload', { tok: good, body: { filename: 'x.png', data: 'A'.repeat(6_000_001) } }); assert.equal(r.status, 413); ok('過大的圖片被拒');

console.log(`\n全部 ${n} 項通過`);
