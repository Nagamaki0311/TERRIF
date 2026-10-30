// ホームページの起動。データ（site/profile/posts/feeds）を読み、各区画を描く。
import { fmtTime, getJSON } from './util.js';
import { createDesk } from './physics.js';
import { createBgm } from './bgm.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

// ===== SECTION: 起動 =====
async function boot() {
  const [site, profile, posts, feeds] = await Promise.all([
    getJSON('data/site.json'),
    getJSON('data/profile.json'),
    getJSON('data/posts.json').catch(() => []),
    getJSON('data/feeds.json').catch(() => ({ note: [], youtube: [] })),
  ]);
  posts.sort((a, b) => (a.at < b.at ? 1 : -1));
  renderHero(site, posts);
  renderDesk(posts);
  renderSns(site, feeds);
  renderProfile(profile);
  setupRiso();
  setupReveal();
  if (finePointer && !reduced) setupSparkle();
  if (!reduced) setupDisc();
  setupLamp();
  setupBgm();
  setupProgress();
  if (finePointer) setupWinDrag();
}

// ===== SECTION: ヒーロー =====
function renderHero(site, posts) {
  $$('[data-name]').forEach((el) => (el.textContent = site.name));
  // 見出しの名前は1文字ずつに分け、触れるとはねるようにする（読み上げは元の文字列）
  const title = $('#hero-title');
  title.setAttribute('aria-label', site.name);
  const name = title.querySelector('[data-name]');
  name.setAttribute('aria-hidden', 'true');
  name.replaceChildren(...[...site.name].map((c) => Object.assign(document.createElement('span'), { className: 'ch', textContent: c })));
  $('[data-kana]').textContent = site.kana;
  $('[data-tagline]').textContent = site.tagline;
  $('[data-intro]').textContent = site.intro;
  document.title = `${site.name} のホームページ`;

  const latest = posts[0];
  const ticker = $('[data-ticker]');
  ticker.textContent = latest ? `${latest.text}　―　${fmtTime(latest.at)}` : 'まだ何も置いていません。';
  ticker.style.setProperty('--marquee-dur', `${Math.max(12, [...ticker.textContent].length * 0.45)}s`);
  $('[data-updated]').textContent = latest ? fmtTime(latest.at) : '----';

  // この端末での訪問回数（サーバーを持たないため、端末ごとに数える）
  let n = 1;
  try {
    n = Number(localStorage.getItem('nk.visits') || 0);
    if (!sessionStorage.getItem('nk.counted')) {
      n += 1;
      localStorage.setItem('nk.visits', String(n));
      sessionStorage.setItem('nk.counted', '1');
    }
  } catch { /* 保存できない環境では1回目として表示する */ }
  const digits = String(Math.max(1, n)).padStart(6, '0');
  kiriban(n);
  const box = $('[data-counter]');
  box.setAttribute('aria-label', `${n}回目`);
  box.replaceChildren(...[...digits].map((d) => Object.assign(document.createElement('b'), { textContent: d })));

  const clock = $('[data-clock]');
  const tick = () => (clock.textContent = fmtTime(new Date().toISOString()));
  tick();
  setInterval(tick, 1000);
}

// ===== SECTION: 机（投稿） =====
function renderDesk(posts) {
  const desk = $('[data-desk]');
  const modal = $('[data-modal]');
  const open = (post) => {
    $('[data-modal-text]').textContent = post.text;
    $('[data-modal-time]').textContent = fmtTime(post.at);
    modal.showModal();
  };
  $('[data-close]').addEventListener('click', () => modal.close());
  modal.addEventListener('click', (e) => e.target === modal && modal.close());

  const ctl = createDesk(desk, $('[data-posts]'), posts, { reduced, onOpen: open });
  $('[data-count]').textContent = `${ctl.count}まい`;
  const tidyBtn = $('[data-act="tidy"]');
  const sync = () => {
    tidyBtn.setAttribute('aria-pressed', String(ctl.tidy));
    tidyBtn.textContent = ctl.tidy ? 'ちらかす' : 'ならべる';
    $('[data-act="shake"]').disabled = ctl.tidy;
  };
  sync();
  tidyBtn.addEventListener('click', () => {
    ctl.setTidy(!ctl.tidy);
    sync();
  });
  $('[data-act="shake"]').addEventListener('click', () => ctl.shake());
  // ガチャ: カプセルが落ちてきて、過去の投稿が1つ出る
  $('[data-act="gacha"]').addEventListener('click', () => {
    if (!posts.length) return;
    const pick = posts[Math.floor(Math.random() * posts.length)];
    if (reduced) return open(pick);
    const cap = $('[data-capsule]');
    cap.classList.remove('is-go');
    void cap.offsetWidth;
    cap.classList.add('is-go');
    setTimeout(() => {
      cap.classList.remove('is-go');
      open(pick);
    }, 1900);
  });
  const tiltBtn = $('[data-act="tilt"]');
  if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches && !reduced) {
    tiltBtn.hidden = false;
    tiltBtn.addEventListener('click', async () => {
      const ok = await ctl.tilt();
      tiltBtn.textContent = ok ? 'かたむけ中' : 'かたむけ非対応';
      tiltBtn.disabled = true;
    });
  }
}

// ===== SECTION: よそのページ =====
function card(item) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = item.link;
  a.target = '_blank';
  a.rel = 'noopener';
  const th = document.createElement('div');
  th.className = 'card__thumb';
  if (item.thumb) {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    th.append(img);
  }
  const body = document.createElement('div');
  const t = document.createElement('p');
  t.className = 'card__title';
  t.textContent = item.title;
  const d = document.createElement('p');
  d.className = 'stamp-time mono';
  d.textContent = item.date ? fmtTime(item.date) : '';
  body.append(t, d);
  a.append(th, body);
  const li = document.createElement('li');
  li.append(a);
  return li;
}
function fillCards(list, items, emptyText, href) {
  if (items?.length) {
    list.replaceChildren(...items.slice(0, 4).map(card));
    return;
  }
  const li = document.createElement('li');
  const a = Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener', textContent: emptyText, className: 'win__empty' });
  li.append(a);
  list.replaceChildren(li);
}

function renderSns(site, feeds) {
  fillCards($('[data-note]'), feeds.note, 'noteで記事を読む ↗', site.sns.note.url);
  fillCards($('[data-youtube]'), feeds.youtube, 'YouTubeで動画を見る ↗', site.sns.youtube.url);
  for (const k of ['x', 'note', 'youtube']) $(`[data-link="${k}"]`).href = site.sns[k].url;

  // X は公式の無料埋め込み。窓が見えたときに読み込み、表示されなければリンクに切り替える
  const box = $('[data-x]');
  new IntersectionObserver((ents, io) => {
    if (!ents.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const a = Object.assign(document.createElement('a'), {
      className: 'twitter-timeline',
      href: `https://twitter.com/${site.sns.x.handle}`,
      textContent: `@${site.sns.x.handle} の投稿を読みこみ中…`,
    });
    a.dataset.height = '680';
    a.dataset.lang = 'ja';
    a.dataset.chrome = 'noheader nofooter noborders transparent';
    a.dataset.dnt = 'true';
    box.replaceChildren(a);
    const s = Object.assign(document.createElement('script'), { src: 'https://platform.twitter.com/widgets.js', async: true, charset: 'utf-8' });
    document.body.append(s);
    // 埋め込みは、ログインしていない閲覧者には空で表示されることがある。中身が出ていなければ代わりのカードにする
    setTimeout(() => {
      const f = box.querySelector('iframe');
      if (f && f.offsetHeight > 160) return;
      const card = document.createElement('div');
      card.className = 'xcard';
      card.append(
        Object.assign(document.createElement('p'), { className: 'xcard__handle', textContent: `@${site.sns.x.handle}` }),
        Object.assign(document.createElement('p'), { className: 'xcard__note', textContent: 'いちばん新しいつぶやきは、Xで見られます。' }),
        Object.assign(document.createElement('a'), { className: 'xcard__btn', href: site.sns.x.url, target: '_blank', rel: 'noopener', textContent: 'Xでつぶやきを見る ↗' }),
      );
      box.replaceChildren(card);
    }, 10000);
  }, { rootMargin: '200px' }).observe(box);
}

// ===== SECTION: プロフ帳 =====
function renderProfile(profile) {
  const dl = $('[data-profile]');
  for (const [k, v] of profile.fields) {
    dl.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
  }
}

// ===== SECTION: 視覚効果 =====
function setupRiso() {
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) e.target.classList.toggle('is-aligned', e.isIntersecting);
  }, { threshold: 0.6 });
  for (const el of $$('[data-riso]')) {
    el.dataset.text = el.textContent;
    io.observe(el);
  }
}
function setupReveal() {
  const els = $$('.sec-head, .windows, .prof, .desk-tools');
  els.forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { threshold: 0.12 });
  els.forEach((el) => io.observe(el));
}
/** キリ番（ゾロ目や100ごと）の訪問で、紙吹雪を降らせる */
function kiriban(n) {
  const s = String(n);
  if (!(n >= 7 && (n % 100 === 0 || (s.length > 1 && /^(\d)\1+$/.test(s)) || n === 7))) return;
  const box = $('[data-kiriban]');
  box.hidden = false;
  box.textContent = `${n}回目の訪問！ キリ番です！`;
  if (!reduced) {
    const colors = ['#ff4fa3', '#0a7bd1', '#ffd23f', '#00a37a'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % 4]};--dx:${(Math.random() - 0.5) * 30}vw;--t:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 0.8}s`;
      document.body.append(c);
      c.addEventListener('animationend', () => c.remove());
    }
  }
  setTimeout(() => (box.hidden = true), 5000);
}

/** 夜のあかり。日本時間の19時〜5時は自動でつく。ボタンで切り替えられる */
function setupLamp() {
  const btn = $('[data-lamp]');
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  // 指で操作する端末では光の位置を動かせないため、自動ではつけない
  let on = finePointer && (hour >= 19 || hour < 5);
  try {
    const saved = localStorage.getItem('nk.lamp');
    if (saved) on = saved === '1';
  } catch { /* 保存できない環境では時刻で決める */ }
  const set = (v) => {
    on = v;
    document.documentElement.classList.toggle('is-lamp', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? '夜のあかりを消す' : '夜のあかりをつける';
  };
  set(on);
  btn.addEventListener('click', () => {
    set(!on);
    try { localStorage.setItem('nk.lamp', on ? '1' : '0'); } catch { /* 何もしない */ }
  });
  const layer = $('[data-lamp-layer]');
  addEventListener('pointermove', (e) => {
    layer.style.setProperty('--lx', `${e.clientX}px`);
    layer.style.setProperty('--ly', `${e.clientY}px`);
  }, { passive: true });
}

/** BGM のボタン。押したときだけ鳴らす（自動再生しない） */
function setupBgm() {
  const btn = $('[data-bgm]');
  const bgm = createBgm();
  btn.addEventListener('click', async () => {
    if (bgm.on) bgm.stop();
    else await bgm.start();
    btn.setAttribute('aria-pressed', String(bgm.on));
    btn.title = bgm.on ? 'BGMを止める' : 'BGMを鳴らす';
  });
}

function setupProgress() {
  const bar = $('[data-progress]');
  const upd = () => bar.style.setProperty('--p', String(Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight))));
  addEventListener('scroll', upd, { passive: true });
  upd();
}

/** 窓をタイトルバーでつまんで動かす。ダブルクリックで元の位置に戻る */
function setupWinDrag() {
  for (const win of $$('.sns .win')) {
    const bar = win.querySelector('.win__bar');
    let start = null, x = 0, y = 0;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a, button')) return;
      start = { px: e.clientX - x, py: e.clientY - y };
      bar.setPointerCapture(e.pointerId);
      win.classList.add('is-drag');
    });
    bar.addEventListener('pointermove', (e) => {
      if (!start) return;
      x = e.clientX - start.px;
      y = e.clientY - start.py;
      win.style.translate = `${x}px ${y}px`;
    });
    bar.addEventListener('pointerup', () => {
      start = null;
      win.classList.remove('is-drag');
    });
    bar.addEventListener('dblclick', () => {
      x = y = 0;
      win.style.translate = '';
    });
  }
}

function setupDisc() {
  const face = document.querySelector('[data-disc] .disc__face');
  if (!face) return;
  addEventListener('pointermove', (e) => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    face.style.setProperty('--ry', `${x * 50}deg`);
    face.style.setProperty('--rx', `${-y * 40}deg`);
  }, { passive: true });
}
function setupSparkle() {
  const chars = ['✦', '★', '✧', '･'];
  const colors = ['var(--pink)', 'var(--blue)', 'var(--yellow)', 'var(--green)'];
  let last = 0, i = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.timeStamp - last < 45) return;
    last = e.timeStamp;
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = chars[i % chars.length];
    s.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;color:${colors[i++ % colors.length]};--dx:${(Math.random() - 0.5) * 40}px;--dy:${12 + Math.random() * 26}px`;
    s.setAttribute('aria-hidden', 'true');
    document.body.append(s);
    s.addEventListener('animationend', () => s.remove());
  }, { passive: true });
}

boot().catch((e) => {
  console.error(e);
  const t = $('[data-ticker]');
  if (t) t.textContent = 'データを読みこめませんでした。時間をおいて再読みこみしてください。';
});
