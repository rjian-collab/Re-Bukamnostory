// 讀取 content/index.json 與 content/pages/*.json，用 hash 路由顯示（#/ch-1）。
// 所有文字都用 textContent 寫入，內容不可能夾帶 HTML / script。
(function () {
  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const live = $('live');
  let INDEX = null;

  const el = (tag, attrs, text) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  async function getJSON(path) {
    const r = await fetch(path, { cache: 'no-cache' }); // 發布後讀者能很快看到新內容
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  const visible = () => (INDEX ? INDEX.pages.filter(p => p.published) : []);

  function renderBlocks(container, blocks) {
    for (const b of blocks || []) {
      let n;
      switch (b.type) {
        case 'h2': n = el('h2', null, b.text); break;
        case 'h3': n = el('h3', null, b.text); break;
        case 'note': n = el('p', { class: 'note' }, b.text); break;
        case 'verse': n = el('p', { class: 'verse' }, b.text); break;
        case 'img': {
          n = el('figure');
          const img = el('img', { src: b.src, alt: b.alt || '', loading: 'lazy' });
          n.appendChild(img);
          if (b.caption) n.appendChild(el('figcaption', null, b.caption));
          break;
        }
        default: n = el('p', null, b.text);
      }
      container.appendChild(n);
    }
  }

  function buildToc(currentSlug) {
    const ol = $('toc-list');
    ol.textContent = '';
    for (const p of visible()) {
      const li = el('li');
      const a = el('a', { href: '#/' + p.slug }, p.title);
      if (p.slug === currentSlug) a.setAttribute('aria-current', 'page');
      li.appendChild(a);
      ol.appendChild(li);
    }
    applyFilter();
  }
  function applyFilter() {
    const q = $('toc-filter').value.trim().toLowerCase();
    let shown = 0;
    $('toc-list').querySelectorAll('li').forEach(li => {
      const hit = !q || li.textContent.toLowerCase().includes(q);
      li.hidden = !hit; if (hit) shown++;
    });
    $('toc-empty').hidden = shown > 0;
  }

  function setTitle(t) {
    const site = INDEX.site.title;
    document.title = t ? t + ' | ' + site : site + ' — ' + INDEX.site.subtitle;
  }
  function announce(msg) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 50); }

  async function showHome() {
    const home = await getJSON('content/pages/_home.json').catch(() => ({ blocks: [] }));
    main.textContent = '';
    main.appendChild(el('h1', null, INDEX.site.title));
    main.appendChild(el('p', { class: 'subtitle' }, INDEX.site.subtitle));
    renderBlocks(main, home.blocks);
    main.appendChild(el('h2', null, '章節目錄'));
    const ul = el('ul', { class: 'chapter-grid' });
    for (const p of visible()) {
      const li = el('li');
      li.appendChild(el('a', { href: '#/' + p.slug }, p.title));
      ul.appendChild(li);
    }
    main.appendChild(ul);
    buildToc(null);
    setTitle('');
    return INDEX.site.title;
  }

  async function showPage(slug) {
    const list = visible();
    const i = list.findIndex(p => p.slug === slug);
    if (i < 0) return showMissing();
    const page = await getJSON('content/pages/' + encodeURIComponent(slug) + '.json');
    main.textContent = '';
    main.appendChild(el('h1', null, page.title));
    const chars = (page.blocks || []).reduce((s, b) => s + (b.text ? b.text.length : 0), 0);
    if (chars > 0) main.appendChild(el('p', { class: 'meta' }, '約 ' + Math.max(1, Math.round(chars / 400)) + ' 分鐘閱讀'));
    const tools = el('div', { class: 'read-tools' });
    const tts = el('button', { type: 'button', class: 'btn' }, '🔊 朗讀本頁');
    tts.addEventListener('click', () => { $('a11y-btn').click(); $('tts-play').focus(); });
    tools.appendChild(tts);
    main.appendChild(tools);
    renderBlocks(main, page.blocks);

    const pager = el('nav', { class: 'pager', 'aria-label': '上下章' });
    if (list[i - 1]) pager.appendChild(el('a', { href: '#/' + list[i - 1].slug, rel: 'prev' }, '← ' + list[i - 1].title));
    else pager.appendChild(el('span'));
    if (list[i + 1]) pager.appendChild(el('a', { href: '#/' + list[i + 1].slug, rel: 'next' }, list[i + 1].title + ' →'));
    main.appendChild(pager);
    buildToc(slug);
    setTitle(page.title);
    return page.title;
  }

  function showMissing() {
    main.textContent = '';
    main.appendChild(el('h1', null, '找不到這個頁面'));
    const p = el('p'); p.appendChild(document.createTextNode('這個頁面不存在，或尚未發布。'));
    main.appendChild(p);
    main.appendChild(el('p')).appendChild(el('a', { href: '#/' }, '回到首頁'));
    buildToc(null);
    setTitle('找不到頁面');
    return '找不到頁面';
  }

  let first = true;
  async function route() {
    const slug = decodeURIComponent((location.hash.replace(/^#\/?/, '') || '')).replace(/[^\w-]/g, '');
    let title;
    try {
      if (!INDEX) INDEX = await getJSON('content/index.json');
      title = slug ? await showPage(slug) : await showHome();
    } catch (e) {
      main.textContent = '';
      main.appendChild(el('h1', null, '載入失敗'));
      main.appendChild(el('p', null, '內容暫時讀不到，請稍後重新整理。'));
      title = '載入失敗';
    }
    $('toc').hidden = true; $('toc-btn').setAttribute('aria-expanded', 'false');
    if (!first) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); announce('已切換到：' + title); }
    first = false;
  }

  $('toc-btn').addEventListener('click', () => {
    const t = $('toc'); const open = t.hidden;
    t.hidden = !open; $('toc-btn').setAttribute('aria-expanded', String(open));
    if (open) $('toc-filter').focus();
  });
  $('toc').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('toc').hidden = true; $('toc-btn').setAttribute('aria-expanded', 'false'); $('toc-btn').focus(); } });
  $('toc-filter').addEventListener('input', applyFilter);

  const cfg = window.SITE || {};
  const admin = $('admin-link');
  if (cfg.adminUrl && !/YOUR-SUBDOMAIN/.test(cfg.adminUrl)) admin.href = cfg.adminUrl;
  else admin.addEventListener('click', (e) => { e.preventDefault(); alert('還沒設定編輯後台網址：請先依 README 部署 Cloudflare Worker，再修改 config.js。'); });

  window.addEventListener('hashchange', route);
  route();
})();
