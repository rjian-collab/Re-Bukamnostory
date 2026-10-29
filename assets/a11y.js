// 無障礙設定面板：文字大小、主題、字體、行距、朗讀。設定存在瀏覽器 localStorage。
(function () {
  const KEY = 'rbs-a11y-v1';
  const DEFAULTS = { fs: 1, theme: 'auto', font: 'serif', lh: '1.9', narrow: false, underline: false, motion: false, rate: '1' };
  const root = document.documentElement;
  let st = Object.assign({}, DEFAULTS);

  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 無痕模式等情況：忽略 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };

  function apply() {
    root.style.setProperty('--fs', st.fs);
    root.style.setProperty('--lh', st.lh);
    root.dataset.theme = st.theme;
    root.dataset.font = st.font;
    root.dataset.narrow = st.narrow ? '1' : '0';
    root.dataset.underline = st.underline ? '1' : '0';
    root.dataset.motion = st.motion ? 'reduce' : '';
    if (st.theme === 'auto') delete root.dataset.theme;
    const out = document.getElementById('fs-out');
    if (out) out.textContent = Math.round(st.fs * 100) + '%';
  }
  apply();

  const $ = (id) => document.getElementById(id);
  const panel = $('a11y-panel');
  const openBtn = $('a11y-btn');
  let lastFocus = null;

  function syncForm() {
    document.querySelectorAll('input[name=theme]').forEach(r => r.checked = r.value === st.theme);
    document.querySelectorAll('input[name=font]').forEach(r => r.checked = r.value === st.font);
    $('lh').value = st.lh;
    $('narrow').checked = st.narrow;
    $('underline').checked = st.underline;
    $('motion').checked = st.motion;
    $('tts-rate').value = st.rate;
    $('fs-out').textContent = Math.round(st.fs * 100) + '%';
  }

  function openPanel() {
    lastFocus = document.activeElement;
    syncForm();
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    $('a11y-close').focus();
  }
  function closePanel() {
    panel.hidden = true;
    document.body.style.overflow = '';
    (lastFocus || openBtn).focus();
  }
  openBtn.addEventListener('click', openPanel);
  $('a11y-close').addEventListener('click', closePanel);
  panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanel(); return; }
    if (e.key !== 'Tab') return; // 焦點限制在對話框內
    const f = [...panel.querySelectorAll('button, input, select')].filter(x => !x.disabled);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  panel.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'fs-up') st.fs = Math.min(2, +(st.fs + 0.1).toFixed(2));
    if (act === 'fs-down') st.fs = Math.max(0.8, +(st.fs - 0.1).toFixed(2));
    if (act) { apply(); save(); }
  });
  document.querySelectorAll('input[name=theme]').forEach(r => r.addEventListener('change', () => { st.theme = r.value; apply(); save(); }));
  document.querySelectorAll('input[name=font]').forEach(r => r.addEventListener('change', () => { st.font = r.value; apply(); save(); }));
  $('lh').addEventListener('change', (e) => { st.lh = e.target.value; apply(); save(); });
  $('narrow').addEventListener('change', (e) => { st.narrow = e.target.checked; apply(); save(); });
  $('underline').addEventListener('change', (e) => { st.underline = e.target.checked; apply(); save(); });
  $('motion').addEventListener('change', (e) => { st.motion = e.target.checked; apply(); save(); });
  $('tts-rate').addEventListener('change', (e) => { st.rate = e.target.value; save(); });
  $('a11y-reset').addEventListener('click', () => { st = Object.assign({}, DEFAULTS); apply(); save(); syncForm(); });

  // ---- 朗讀（瀏覽器內建語音，不會上傳任何資料）----
  const synth = window.speechSynthesis;
  const hint = $('tts-hint');
  let queue = [], idx = 0, speaking = false, current = null;

  function pickVoice() {
    const vs = synth ? synth.getVoices() : [];
    return vs.find(v => /zh[-_]TW/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
  }
  function clearMark() { if (current) current.classList.remove('speaking'); current = null; }
  function stop() {
    speaking = false; queue = [];
    if (synth) synth.cancel();
    clearMark();
    $('tts-play').textContent = '▶ 開始朗讀';
  }
  function next() {
    clearMark();
    if (!speaking || idx >= queue.length) { stop(); return; }
    const el = queue[idx++];
    const u = new SpeechSynthesisUtterance(el.innerText.trim());
    const v = pickVoice();
    u.lang = v ? v.lang : 'zh-TW';
    if (v) u.voice = v;
    u.rate = parseFloat(st.rate) || 1;
    u.onend = next;
    u.onerror = () => { if (speaking) next(); };
    current = el; el.classList.add('speaking');
    synth.speak(u);
  }
  $('tts-play').addEventListener('click', () => {
    if (!synth) { hint.textContent = '這個瀏覽器不支援朗讀功能。'; return; }
    if (speaking) { // 暫停 / 繼續
      if (synth.paused) { synth.resume(); $('tts-play').textContent = '⏸ 暫停朗讀'; }
      else { synth.pause(); $('tts-play').textContent = '▶ 繼續朗讀'; }
      return;
    }
    queue = [...document.querySelectorAll('#main h1, #main h2, #main h3, #main p, #main .verse, #main .note')];
    idx = 0; speaking = true;
    $('tts-play').textContent = '⏸ 暫停朗讀';
    if (!pickVoice()) hint.textContent = '找不到中文語音，將使用系統預設語音；Windows 可在「設定 → 時間與語言 → 語音」新增中文語音。';
    else hint.textContent = '';
    next();
  });
  $('tts-stop').addEventListener('click', stop);
  window.addEventListener('hashchange', stop);
  if (synth) synth.onvoiceschanged = () => {};

  window.A11Y = { stop, apply };
})();
