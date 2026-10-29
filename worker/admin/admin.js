// 編輯後台：直接在版面上編輯、新增頁面、發布 / 取消發布、插入圖片、匯入純文字。
(function () {
  const $ = (id) => document.getElementById(id);
  const TYPES = { p: '段落', h2: '大標題', h3: '小標題', note: '註解', verse: '詩歌／歌詞' };
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
  const state = { index: null, cur: null, dirty: false, siteUrl: '' };
  let toastTimer;

  // ---------- 小工具 ----------
  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function say(msg, isErr) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 9000 : 5000);
  }
  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(data.error || ('錯誤 ' + r.status)); err.status = r.status; throw err; }
    return data;
  }
  function setDirty(v) { state.dirty = v; $('dirty').hidden = !v; }
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  const confirmLeave = () => !state.dirty || confirm('目前的修改還沒儲存，確定要離開嗎？');
  const slugify = (t) => { const s = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); return /^[a-z0-9]/.test(s) ? s : 'page-' + Math.random().toString(36).slice(2, 7); };

  // ---------- 頁面清單 ----------
  function renderList() {
    const ul = $('page-list'); ul.textContent = '';
    const mk = (slug, title, published, movable, i, n) => {
      const li = el('li');
      const b = el('button', { type: 'button', class: 'pick' });
      b.appendChild(document.createTextNode(title));
      if (movable) b.appendChild(el('span', { class: 'badge ' + (published ? 'pub' : 'draft') }, published ? '已發布' : '草稿'));
      if (state.cur && state.cur.slug === slug) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => openPage(slug));
      li.appendChild(b);
      if (movable) {
        const up = el('button', { type: 'button', class: 'btn mv', 'aria-label': '上移：' + title }, '↑');
        const dn = el('button', { type: 'button', class: 'btn mv', 'aria-label': '下移：' + title }, '↓');
        up.disabled = i === 0; dn.disabled = i === n - 1;
        up.addEventListener('click', () => move(i, -1));
        dn.addEventListener('click', () => move(i, 1));
        li.append(up, dn);
      }
      ul.appendChild(li);
    };
    mk('_home', '首頁介紹文字', true, false);
    const pages = state.index.pages;
    pages.forEach((p, i) => mk(p.slug, p.title, p.published, true, i, pages.length));
    // 尚未儲存的新頁面
    if (state.cur && state.cur.isNew) {
      const li = el('li'); const b = el('button', { type: 'button', class: 'pick', 'aria-current': 'true' }, state.cur.page.title + '（新，未儲存）');
      li.appendChild(b); ul.appendChild(li);
    }
  }
  async function move(i, d) {
    const pages = state.index.pages; const j = i + d;
    if (j < 0 || j >= pages.length) return;
    const copy = pages.slice(); [copy[i], copy[j]] = [copy[j], copy[i]];
    try {
      await api('POST', '/api/reorder', { slugs: copy.map((p) => p.slug) });
      state.index.pages = copy; renderList();
      $('live').textContent = '已移動：' + copy[j].title;
      say('順序已更新（公開網站約 1–2 分鐘後生效）');
    } catch (e) { say(e.message, true); }
  }

  // ---------- 編輯區 ----------
  function plainOK() { const t = document.createElement('div'); t.contentEditable = 'plaintext-only'; return t.contentEditable === 'plaintext-only'; }
  const PLAIN = plainOK();

  function readText(node, type) {
    let t = node.innerText.replace(/ /g, ' ').replace(/\r/g, '');
    if (type === 'verse') return t.replace(/\n+$/, '');
    return t.replace(/\s*\n+\s*/g, ' ').trim();
  }
  function blockLabel(i, type) { return TYPES[type] + ' 第 ' + (i + 1) + ' 區塊'; }

  function makeBlock(b) {
    const wrap = el('div', { class: 'block', role: 'listitem', 'data-type': b.type });
    if (b.type === 'img') {
      wrap.dataset.src = b.src;
      const img = el('img', { src: b.src, alt: b.alt || '（圖片）' });
      const f = el('div', { class: 'imgfields' });
      const l1 = el('label', null, '圖片說明（替代文字，給看不到圖片的讀者；必填）');
      const alt = el('input', { type: 'text', class: 'alt', maxlength: '300' }); alt.value = b.alt || '';
      const l2 = el('label', null, '圖說（顯示在圖片下方，可不填）');
      const cap = el('input', { type: 'text', class: 'cap', maxlength: '300' }); cap.value = b.caption || '';
      l1.appendChild(alt); l2.appendChild(cap); f.append(l1, l2);
      alt.addEventListener('input', () => { alt.classList.remove('bad'); img.alt = alt.value || '（圖片）'; setDirty(true); });
      cap.addEventListener('input', () => setDirty(true));
      wrap.append(img, f);
    } else {
      const ed = el('div', { class: 'edit', role: 'textbox', 'aria-multiline': 'true', 'data-ph': '在這裡輸入文字…' });
      ed.contentEditable = PLAIN ? 'plaintext-only' : 'true';
      ed.textContent = b.text || '';
      ed.addEventListener('input', () => setDirty(true));
      ed.addEventListener('keydown', onKey);
      ed.addEventListener('paste', onPaste);
      wrap.appendChild(ed);
    }
    wrap.appendChild(makeTools(wrap));
    return wrap;
  }

  function makeTools(wrap) {
    const t = el('div', { class: 'tools', role: 'group' });
    const isImg = wrap.dataset.type === 'img';
    if (!isImg) {
      const sel = el('select', { 'aria-label': '區塊類型' });
      for (const k in TYPES) { const o = el('option', { value: k }, TYPES[k]); if (k === wrap.dataset.type) o.selected = true; sel.appendChild(o); }
      sel.addEventListener('change', () => { wrap.dataset.type = sel.value; setDirty(true); relabel(); });
      t.appendChild(sel);
    }
    const mkb = (label, text, fn) => { const b = el('button', { type: 'button', class: 'btn', 'aria-label': label }, text); b.addEventListener('click', fn); t.appendChild(b); return b; };
    mkb('上移此區塊', '↑', () => shift(wrap, -1));
    mkb('下移此區塊', '↓', () => shift(wrap, 1));
    mkb('在下方新增段落', '＋段落', () => { const n = insertAfter(wrap, { type: 'p', text: '' }); focusBlock(n); });
    mkb('在下方插入圖片', '＋圖片', () => pickImage(wrap));
    mkb('刪除此區塊', '刪除', () => { if (confirm('確定刪除這個區塊？')) removeBlock(wrap); });
    return t;
  }
  function blocksEl() { return $('blocks'); }
  function relabel() {
    [...blocksEl().children].forEach((w, i) => {
      const ed = w.querySelector('.edit');
      if (ed) ed.setAttribute('aria-label', blockLabel(i, w.dataset.type));
      else w.setAttribute('aria-label', '圖片 第 ' + (i + 1) + ' 區塊');
    });
  }
  function insertAfter(ref, b) {
    const n = makeBlock(b);
    if (ref && ref.nextSibling) blocksEl().insertBefore(n, ref.nextSibling); else blocksEl().appendChild(n);
    setDirty(true); relabel(); return n;
  }
  function focusBlock(w) {
    const t = w.querySelector('.edit') || w.querySelector('.alt');
    if (t) { t.focus(); const r = document.createRange(); if (t.classList.contains('edit')) { r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
  }
  function shift(w, d) {
    const sib = d < 0 ? w.previousElementSibling : w.nextElementSibling;
    if (!sib) return;
    if (d < 0) blocksEl().insertBefore(w, sib); else blocksEl().insertBefore(sib, w);
    setDirty(true); relabel();
    const b = w.querySelector('.tools .btn[aria-label^="' + (d < 0 ? '上移' : '下移') + '"]'); if (b) b.focus();
    $('live').textContent = '區塊已' + (d < 0 ? '上' : '下') + '移';
  }
  function removeBlock(w) {
    const prev = w.previousElementSibling || w.nextElementSibling;
    w.remove(); setDirty(true); relabel();
    if (prev) focusBlock(prev);
    $('live').textContent = '區塊已刪除';
  }
  function onKey(e) {
    const ed = e.currentTarget, wrap = ed.closest('.block'), type = wrap.dataset.type;
    if (e.key === 'Enter' && !e.isComposing) {
      if (type === 'verse' && !e.ctrlKey) { if (!PLAIN) { e.preventDefault(); document.execCommand('insertText', false, '\n'); } return; }
      e.preventDefault();
      const n = insertAfter(wrap, { type: type === 'h2' || type === 'h3' ? 'p' : (type === 'verse' ? 'p' : type), text: '' });
      focusBlock(n);
    } else if (e.key === 'Backspace' && !e.isComposing && ed.innerText.replace(/\s/g, '') === '' && blocksEl().children.length > 1) {
      e.preventDefault(); removeBlock(wrap);
    }
  }
  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r/g, '');
    const wrap = e.currentTarget.closest('.block');
    const verse = wrap.dataset.type === 'verse';
    const paras = verse ? [text] : text.split(/\n\s*\n/).map((s) => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    if (!paras.length) return;
    document.execCommand('insertText', false, paras[0]);
    let ref = wrap;
    for (const p of paras.slice(1)) ref = insertAfter(ref, { type: 'p', text: p });
    setDirty(true);
  }

  function renderBlocks(blocks) {
    const c = blocksEl(); c.textContent = '';
    (blocks.length ? blocks : [{ type: 'p', text: '' }]).forEach((b) => c.appendChild(makeBlock(b)));
    relabel();
  }
  function collect() {
    return [...blocksEl().children].map((w) => {
      const type = w.dataset.type;
      if (type === 'img') return { type, src: w.dataset.src, alt: w.querySelector('.alt').value.trim(), caption: w.querySelector('.cap').value.trim() };
      return { type, text: readText(w.querySelector('.edit'), type) };
    }).filter((b) => b.type === 'img' || b.text !== '');
  }

  // ---------- 開啟 / 儲存 ----------
  function showEditor() {
    const c = state.cur;
    $('empty').hidden = true; $('work').hidden = false;
    $('title').value = c.page.title;
    $('title').disabled = c.slug === '_home';
    $('slug-show').textContent = c.slug === '_home' ? '（首頁）' : c.slug;
    renderBlocks(c.page.blocks || []);
    refreshButtons(); setDirty(false); renderList();
    const pv = $('preview');
    if (state.siteUrl && !c.isNew && c.page.published) { pv.href = state.siteUrl + (c.slug === '_home' ? '' : '#/' + c.slug); pv.hidden = false; } else pv.hidden = true;
  }
  function refreshButtons() {
    const c = state.cur, home = c.slug === '_home', pub = c.page.published;
    const badge = $('status-badge');
    badge.textContent = home ? '首頁' : (pub ? '已發布' : '草稿'); badge.className = 'badge ' + (pub ? 'pub' : 'draft');
    $('btn-save').textContent = pub && !home ? '儲存修改' : (home ? '儲存' : '儲存草稿');
    $('btn-publish').hidden = home || pub;
    $('btn-unpublish').hidden = home || !pub;
    $('btn-delete').hidden = home || c.isNew;
  }
  async function openPage(slug) {
    if (!confirmLeave()) return;
    try {
      const d = await api('GET', '/api/page/' + encodeURIComponent(slug));
      state.cur = { slug, page: d.page, sha: d.sha, isNew: false };
      showEditor(); $('editor').focus();
      $('live').textContent = '已開啟：' + d.page.title;
    } catch (e) { say('開啟失敗：' + e.message, true); }
  }
  async function save(publish) {
    const c = state.cur; if (!c) return;
    const page = { title: c.slug === '_home' ? c.page.title : $('title').value.trim(), blocks: collect(), source: c.page.source, published: publish == null ? c.page.published : publish };
    if (!page.title) { say('請先輸入標題', true); $('title').focus(); return; }
    if (publish === true && !page.blocks.some((b) => b.type !== 'note' || !/^【草稿】/.test(b.text))) { if (!confirm('這個頁面看起來還沒有正文，確定要發布嗎？')) return; }
    if (page.blocks.some((b) => b.type === 'img' && !b.alt)) {
      const bad = [...blocksEl().querySelectorAll('.block[data-type="img"] .alt')].filter((i) => !i.value.trim());
      bad.forEach((i) => i.classList.add('bad'));
      if (!confirm('有圖片沒有填「圖片說明」。看不到圖片的讀者（例如使用讀屏軟體）會不知道圖片內容。\n\n仍要儲存嗎？（按「取消」回去補寫）')) { bad[0] && bad[0].focus(); return; }
    }
    // 草稿頁剛匯入正文後，移除原本的「【草稿】尚未搬過來」提示
    page.blocks = page.blocks.filter((b, i, a) => !(b.type === 'note' && /^【草稿】這一章的原文還沒有搬過來/.test(b.text) && a.length > 1));
    const btns = document.querySelectorAll('.bar .btn'); btns.forEach((b) => (b.disabled = true));
    try {
      const r = await api('PUT', '/api/page/' + encodeURIComponent(c.slug), { page, sha: c.isNew ? undefined : c.sha });
      c.sha = r.sha; c.isNew = false; c.page = Object.assign({}, c.page, page, { updated: r.updated });
      if (c.slug !== '_home') {
        const row = state.index.pages.find((p) => p.slug === c.slug);
        if (row) Object.assign(row, { title: page.title, published: page.published, updated: r.updated });
        else state.index.pages.push({ slug: c.slug, title: page.title, published: page.published, updated: r.updated });
      }
      showEditor();
      say(page.published ? '已儲存並發布。公開網站約 1–2 分鐘後更新。' : '草稿已儲存（讀者看不到）。');
    } catch (e) { say('儲存失敗：' + e.message, true); }
    finally { btns.forEach((b) => (b.disabled = false)); refreshButtons(); }
  }

  // ---------- 圖片 ----------
  let imgAfter = null;
  function pickImage(after) { imgAfter = after || null; $('file').value = ''; $('file').click(); }
  function readB64(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); }); }
  async function shrink(file) {
    if (file.size <= 3 * 1024 * 1024) return file;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    return new Promise((res) => cv.toBlob((b) => res(b), 'image/jpeg', 0.85));
  }
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0]; if (!f) return;
    try {
      say('圖片上傳中…');
      const blob = await shrink(f);
      const data = await readB64(blob);
      const r = await api('POST', '/api/upload', { filename: f.name, data });
      const n = insertAfter(imgAfter || blocksEl().lastElementChild, { type: 'img', src: r.src, alt: '', caption: '' });
      n.querySelector('img').src = new URL(r.src, state.siteUrl || location.href).href; // 上傳後約 1 分鐘公開站才看得到，預覽先用相對網址
      focusBlock(n);
      say('圖片已上傳，請填寫「圖片說明」。');
    } catch (e) { say('圖片上傳失敗：' + e.message, true); }
  });

  // ---------- 匯入純文字 ----------
  function parseText(txt) {
    const out = [];
    for (const raw of txt.replace(/\r/g, '').split(/\n\s*\n/)) {
      const c = raw.trim(); if (!c) continue;
      if (c.startsWith('| ')) out.push({ type: 'verse', text: c.split('\n').map((l) => l.replace(/^\|\s?/, '')).join('\n') });
      else if (c.startsWith('### ')) out.push({ type: 'h3', text: c.slice(4) });
      else if (c.startsWith('## ')) out.push({ type: 'h2', text: c.slice(3) });
      else if (c.startsWith('[註]')) out.push({ type: 'note', text: c.replace(/^\[註\]\s*/, '') });
      else out.push({ type: 'p', text: c.replace(/\s*\n\s*/g, ' ') });
    }
    return out;
  }

  // ---------- 新增頁面 / 設定 / 對話框 ----------
  const dlgNew = $('dlg-new'), dlgImp = $('dlg-import'), dlgSite = $('dlg-site');
  $('new-page').addEventListener('click', () => { if (!confirmLeave()) return; $('form-new').reset(); dlgNew.showModal(); $('new-title').focus(); });
  $('new-title').addEventListener('input', () => { const s = $('new-slug'); if (!s.dataset.touched) s.value = slugify($('new-title').value); });
  $('new-slug').addEventListener('input', () => { $('new-slug').dataset.touched = '1'; });
  $('new-cancel').addEventListener('click', () => dlgNew.close());
  $('form-new').addEventListener('submit', (e) => {
    const slug = $('new-slug').value.trim(), title = $('new-title').value.trim();
    if (!SLUG_RE.test(slug) || !title) { e.preventDefault(); say('網址代號只能用小寫英文、數字與連字號', true); return; }
    if (state.index.pages.some((p) => p.slug === slug) || slug === '_home') { e.preventDefault(); say('這個網址代號已經存在，請換一個。', true); return; }
    state.cur = { slug, page: { title, published: false, blocks: [{ type: 'p', text: '' }] }, sha: null, isNew: true };
    showEditor(); setDirty(true); focusBlock(blocksEl().firstElementChild);
  });
  $('btn-import').addEventListener('click', () => { $('import-text').value = ''; dlgImp.showModal(); $('import-text').focus(); });
  $('import-cancel').addEventListener('click', () => dlgImp.close());
  $('form-import').addEventListener('submit', () => {
    const blocks = parseText($('import-text').value);
    if (!blocks.length) return;
    renderBlocks(blocks); setDirty(true); say('已匯入 ' + blocks.length + ' 個區塊，請檢查後再儲存。');
  });
  $('site-settings').addEventListener('click', () => { $('site-title').value = state.index.site.title; $('site-sub').value = state.index.site.subtitle; dlgSite.showModal(); });
  $('site-cancel').addEventListener('click', () => dlgSite.close());
  $('form-site').addEventListener('submit', async () => {
    const title = $('site-title').value.trim(), subtitle = $('site-sub').value.trim();
    try { await api('PUT', '/api/site', { title, subtitle }); state.index.site = { title, subtitle }; say('網站名稱已更新'); } catch (e) { say(e.message, true); }
  });

  $('btn-save').addEventListener('click', () => save(state.cur && state.cur.slug === '_home' ? true : (state.cur.page.published ? true : false)));
  $('btn-publish').addEventListener('click', () => save(true));
  $('btn-unpublish').addEventListener('click', () => { if (confirm('取消發布後，讀者將看不到這一頁（內容仍保留為草稿）。確定嗎？')) save(false); });
  $('btn-delete').addEventListener('click', async () => {
    const c = state.cur;
    if (!confirm('確定要永久刪除「' + c.page.title + '」？\n（GitHub 的歷史紀錄仍能找回舊版本）')) return;
    try {
      await api('DELETE', '/api/page/' + encodeURIComponent(c.slug));
      state.index.pages = state.index.pages.filter((p) => p.slug !== c.slug);
      state.cur = null; setDirty(false); $('work').hidden = true; $('empty').hidden = false; renderList(); say('已刪除');
    } catch (e) { say('刪除失敗：' + e.message, true); }
  });
  $('add-p').addEventListener('click', () => { const n = insertAfter(blocksEl().lastElementChild, { type: 'p', text: '' }); focusBlock(n); });
  $('add-img').addEventListener('click', () => pickImage(blocksEl().lastElementChild));
  $('title').addEventListener('input', () => setDirty(true));
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.cur) $('btn-save').click(); } });

  // ---------- 登入 / 啟動 ----------
  async function showLogin(msg) {
    $('layout').hidden = true; $('logout').hidden = true; $('login').hidden = false;
    $('who').textContent = '尚未登入';
    if (msg) $('login-msg').textContent = msg;
    let cfg = {};
    try { cfg = await api('GET', '/api/config'); } catch (e) {}
    if (!cfg.clientId) { $('login-msg').textContent = '後台尚未設定 Google 用戶端 ID（GOOGLE_CLIENT_ID）。'; return; }
    await new Promise((res, rej) => {
      if (window.google && window.google.accounts) return res();
      const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = res; sc.onerror = rej;
      document.head.appendChild(sc);
    }).catch(() => { $('login-msg').textContent = '無法載入 Google 登入，請檢查網路後重新整理。'; });
    if (!(window.google && window.google.accounts)) return;
    google.accounts.id.initialize({
      client_id: cfg.clientId,
      callback: async (resp) => {
        $('login-msg').textContent = '驗證中…';
        try { await api('POST', '/api/login', { credential: resp.credential }); location.reload(); }
        catch (e) { $('login-msg').textContent = e.message; }
      },
    });
    google.accounts.id.renderButton($('g-btn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'zh-TW' });
  }
  $('logout').addEventListener('click', async () => {
    if (!confirmLeave()) return;
    try { await api('POST', '/api/logout', {}); } catch (e) {}
    setDirty(false); location.reload();
  });

  (async function init() {
    let me;
    try { me = await api('GET', '/api/me'); }
    catch (e) { return showLogin(e.status === 403 ? e.message : ''); }
    try {
      $('who').textContent = me.email;
      $('layout').hidden = false; $('logout').hidden = false;
      state.siteUrl = me.siteUrl || '';
      if (state.siteUrl) { const v = $('view-site'); v.href = state.siteUrl; v.hidden = false; }
      state.index = await api('GET', '/api/index');
      renderList();
    } catch (e) {
      say('載入失敗：' + e.message, true);
    }
  })();
})();
