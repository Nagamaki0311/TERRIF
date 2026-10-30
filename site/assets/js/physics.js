// 机の上（カッターマット）に投稿を物体として落とし、つまんで動かせるようにする。物理演算は Matter.js。
// 文字は DOM のまま残し（読み上げ・選択・拡大に対応）、位置と回転だけを transform で与える。
import { fmtTime, hash } from './util.js';

const VARIANTS = ['note', 'balloon', 'window', 'led', 'sticker', 'bubble'];
const NOTE_TINTS = ['', 'is-pink', 'is-blue'];
const MAX_ON_DESK = 30;

/** 投稿IDから見た目を決める（同じ投稿はいつも同じ見た目）。バブルは短い言葉だけ */
export function variantOf(post) {
  const h = hash(post.id);
  let v = VARIANTS[h % VARIANTS.length];
  if (v === 'bubble' && [...post.text].length > 22) v = 'note';
  return { v, tint: NOTE_TINTS[(h >> 3) % NOTE_TINTS.length], tilt: ((h >> 5) % 13) - 6 };
}

function objHTML(el, post, { v, tint }) {
  el.className = `obj obj--${v} ${v === 'note' ? tint : ''}`;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `投稿を開く: ${post.text.slice(0, 40)}`);
  const text = document.createElement('p');
  text.className = 'obj__text';
  text.textContent = post.text;
  const time = document.createElement('p');
  time.className = 'stamp-time mono';
  time.textContent = fmtTime(post.at);
  if (v === 'window') {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<span>memo.txt</span><i aria-hidden="true">_ □ ×</i>';
    const body = document.createElement('div');
    body.className = 'obj__body';
    body.append(text, time);
    el.append(bar, body);
  } else {
    el.append(text, time);
  }
  if (v === 'bubble') el.style.setProperty('--w', `${120 + Math.min(70, [...post.text].length * 4)}px`);
  else el.style.setProperty('--w', `${Math.min(300, 176 + [...post.text].length * 1.3) * (innerWidth > 900 ? 1.12 : innerWidth < 600 ? 0.86 : 1)}px`);
}

/**
 * desk: 机の要素 / list: 物体を入れる ol / posts: 新しい順
 * opts: { reduced, onOpen(post) }
 */
export function createDesk(desk, list, posts, opts) {
  const M = window.Matter;
  const items = posts.map((post) => {
    const el = document.createElement('li');
    const look = variantOf(post);
    objHTML(el, post, look);
    list.append(el);
    return { post, el, look, body: null };
  });
  // 投稿ではない小物（消しゴム・カセット・ハートのシール）。つまんで遊べるが、開かない
  for (const [kind, label] of [['eraser', 'MONO'], ['cassette', 'MIX 2026'], ['heart', '']]) {
    const el = document.createElement('li');
    el.className = `obj decor decor--${kind}`;
    el.setAttribute('aria-hidden', 'true');
    if (label) el.append(Object.assign(document.createElement('span'), { textContent: label }));
    list.append(el);
    items.push({ post: { id: `decor-${kind}`, text: '' }, el, look: { v: kind === 'heart' ? 'bubble' : 'decor', tilt: kind === 'cassette' ? 8 : -12 }, body: null, decor: true });
  }
  const open = (it) => !it.decor && opts.onOpen(it.post);
  for (const it of items.filter((x) => !x.decor)) {
    it.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(it);
      }
    });
  }

  let tidy = !M || opts.reduced;
  const setTidy = (on) => {
    tidy = on;
    desk.classList.toggle('is-tidy', on);
    if (on) stop();
    else start();
  };

  // ===== SECTION: 物理演算 =====
  let engine = null, raf = 0, walls = [], W = 0, H = 0, dropped = false;
  const onDesk = [...items.filter((x) => !x.decor).slice(0, MAX_ON_DESK), ...items.filter((x) => x.decor)];
  desk.style.setProperty('--n', String(onDesk.length - 3));
  // 物体として置かない古い投稿は、ならべる表示でのみ見える
  items.filter((x) => !x.decor).slice(MAX_ON_DESK).forEach((it) => (it.el.hidden = true));

  const buildWalls = () => {
    W = desk.clientWidth;
    H = desk.clientHeight;
    if (walls.length) M.Composite.remove(engine.world, walls);
    const t = 200;
    walls = [
      M.Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, { isStatic: true }),
      M.Bodies.rectangle(-t / 2, H / 2, t, H * 4, { isStatic: true }),
      M.Bodies.rectangle(W + t / 2, H / 2, t, H * 4, { isStatic: true }),
    ];
    M.Composite.add(engine.world, walls);
  };

  const drop = () => {
    dropped = true;
    // 古いものから落とし、新しい投稿ほど上に積もる
    [...onDesk].reverse().forEach((it, i) => {
      setTimeout(() => {
        if (!engine) return;
        const w = it.el.offsetWidth, h = it.el.offsetHeight;
        const x = 40 + ((hash(it.post.id) % 1000) / 1000) * Math.max(10, W - 80);
        const y = -h - 40;
        const body = it.look.v === 'bubble'
          ? M.Bodies.circle(x, y, w / 2, { restitution: 0.6, friction: 0.05, frictionAir: 0.02 })
          : M.Bodies.rectangle(x, y, w, h, { chamfer: { radius: 8 }, restitution: 0.15, friction: 0.6, frictionAir: 0.015, density: 0.0015 });
        M.Body.setAngle(body, (it.look.tilt * Math.PI) / 180);
        body.plugin = { it };
        it.body = body;
        M.Composite.add(engine.world, body);
      }, i * 160);
    });
  };

  const sync = () => {
    for (const it of onDesk) {
      const b = it.body;
      if (!b) {
        it.el.style.transform = 'translate(-9999px, 0)';
        continue;
      }
      const w = it.el.offsetWidth, h = it.el.offsetHeight;
      it.el.style.transform = `translate(${b.position.x - w / 2}px, ${b.position.y - h / 2}px) rotate(${b.angle}rad)`;
    }
  };

  let last = 0;
  const loop = (now) => {
    const dt = Math.min(1000 / 30, now - (last || now));
    last = now;
    M.Engine.update(engine, dt || 16);
    sync();
    raf = requestAnimationFrame(loop);
  };

  function start() {
    if (!M || engine) return;
    engine = M.Engine.create({ enableSleeping: false });
    engine.gravity.y = 1;
    buildWalls();
    for (const it of onDesk) it.body = null;
    sync();
    raf = requestAnimationFrame(loop);
    if (dropped) drop();
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (engine) M.Engine.clear(engine);
    engine = null;
    for (const it of items) it.el.style.transform = '';
  }

  // ===== SECTION: つまむ（ポインタ操作） =====
  let grab = null;
  const local = (e) => {
    const r = desk.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  list.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.obj');
    if (!el) return;
    const it = items.find((x) => x.el === el);
    if (tidy || !it.body) {
      grab = { it, t: e.timeStamp, x: e.clientX, y: e.clientY, tidy: true };
      return;
    }
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    const b = it.body;
    // つかんだ点を物体の座標系で保持し、その点を指へ引っぱる
    const off = M.Vector.rotate(M.Vector.sub(p, b.position), -b.angle);
    const c = M.Constraint.create({ pointA: p, bodyB: b, pointB: off, stiffness: 0.18, damping: 0.12, length: 0 });
    M.Composite.add(engine.world, c);
    grab = { it, c, t: e.timeStamp, x: e.clientX, y: e.clientY };
    el.style.zIndex = String(10 + (Date.now() % 1000));
  });
  list.addEventListener('pointermove', (e) => {
    if (grab?.c) grab.c.pointA = local(e);
  });
  const release = (e) => {
    if (!grab) return;
    if (grab.c && engine) M.Composite.remove(engine.world, grab.c);
    const moved = Math.hypot(e.clientX - grab.x, e.clientY - grab.y);
    if (moved < 6 && e.timeStamp - grab.t < 400) open(grab.it);
    grab = null;
  };
  list.addEventListener('pointerup', release);
  list.addEventListener('pointercancel', () => {
    if (grab?.c && engine) M.Composite.remove(engine.world, grab.c);
    grab = null;
  });

  // ===== SECTION: ゆらす・かたむける・大きさの変化 =====
  const shake = () => {
    if (!engine) return;
    for (const it of onDesk) {
      if (!it.body) continue;
      M.Body.setVelocity(it.body, { x: (Math.random() - 0.5) * 18, y: -6 - Math.random() * 12 });
      M.Body.setAngularVelocity(it.body, (Math.random() - 0.5) * 0.4);
    }
  };
  const tilt = async () => {
    try {
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', (e) => {
        if (!engine || e.gamma == null) return;
        engine.gravity.x = Math.max(-1, Math.min(1, e.gamma / 35));
        engine.gravity.y = Math.max(0.2, Math.min(1, (e.beta ?? 45) / 60));
      });
      return true;
    } catch {
      return false;
    }
  };
  new ResizeObserver(() => engine && buildWalls()).observe(desk);

  // 机が見えたら落とし始める
  new IntersectionObserver((ents, io) => {
    if (ents.some((x) => x.isIntersecting)) {
      io.disconnect();
      if (!tidy) drop();
      else dropped = true;
    }
  }, { threshold: 0.25 }).observe(desk);

  if (tidy) desk.classList.add('is-tidy');
  else start();

  return { shake, tilt, setTidy, get tidy() { return tidy; }, count: items.filter((x) => !x.decor).length };
}
