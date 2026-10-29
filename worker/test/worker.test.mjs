// 不需要網路與帳號的自動測試：node test/worker.test.mjs
import assert from 'node:assert/strict';
import worker, { sanitizePage } from '../src/index.js';

const TEAM = 'demo.cloudflareaccess.com', AUD = 'aud123';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function token({ email, aud = AUD, iss = `https://${TEAM}`, exp = Math.floor(Date.now() / 1000) + 600, key = kp.privateKey }) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), p = b64u(JSON.stringify({ email, aud: [aud], iss, exp }));
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
  if (url.includes('/cdn-cgi/access/certs')) return Response.json({ keys: [jwk] });
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

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, EDITORS: 'rjian@st-laurentacademy.com, Bremen2006@gmail.com', GH_REPO: 'o/r', GH_BRANCH: 'main', GH_TOKEN: 'x', ASSETS: { fetch: async () => new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }) } };
const BASE = 'https://admin.example.dev';
const req = async (method, path, { body, tok, origin = BASE } = {}) => {
  const headers = {}; if (tok) headers['Cf-Access-Jwt-Assertion'] = tok; if (body) headers['content-type'] = 'application/json'; if (method !== 'GET' && origin) headers.origin = origin;
  return worker.fetch(new Request(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
};
let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

const good = await token({ email: 'rjian@st-laurentacademy.com' });
const good2 = await token({ email: 'BREMEN2006@gmail.com' });

// --- 權限 ---
assert.equal((await req('GET', '/api/me')).status, 403); ok('沒有 token → 403');
assert.equal((await req('GET', '/', {})).status, 403); ok('沒有 token 連後台頁面都不給');
assert.equal((await req('GET', '/api/me', { tok: await token({ email: 'evil@x.com' }) })).status, 403); ok('不在名單的 email → 403');
assert.equal((await req('GET', '/api/me', { tok: await token({ email: 'rjian@st-laurentacademy.com', aud: 'other' }) })).status, 403); ok('aud 不符 → 403');
assert.equal((await req('GET', '/api/me', { tok: await token({ email: 'rjian@st-laurentacademy.com', iss: 'https://evil.cloudflareaccess.com' }) })).status, 403); ok('iss 不符 → 403');
assert.equal((await req('GET', '/api/me', { tok: await token({ email: 'rjian@st-laurentacademy.com', exp: 1 }) })).status, 403); ok('過期 token → 403');
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
assert.equal((await req('GET', '/api/me', { tok: await token({ email: 'rjian@st-laurentacademy.com', key: other.privateKey }) })).status, 403); ok('偽造簽章 → 403');
let r = await req('GET', '/api/me', { tok: good }); assert.equal(r.status, 200); assert.equal((await r.json()).email, 'rjian@st-laurentacademy.com'); ok('編輯者 1 通過');
r = await req('GET', '/api/me', { tok: good2 }); assert.equal(r.status, 200); ok('編輯者 2 通過（大小寫不影響）');
r = await req('GET', '/', { tok: good }); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); ok('後台頁面帶 CSP 標頭');

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
