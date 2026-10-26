// 手続き生成の映像。Canvas 2D だけで、対象ごとの場面を描く。素材ファイルは使わない。
// seedと段階が同じなら同じ絵になる。閃光は使わない（SAFETYの値は scripts/safety.mjs が検査する）。
import { makeRng } from '../engine/rng.js';

/** 安全上の上限。変更する場合は docs/content_policy.md と scripts/safety.mjs も確認する */
export const SAFETY = {
  maxFlashesPerSecond: 2, // 実際には閃光を使わないので0。上限だけを宣言する
  grainAlphaMax: 0.1, // 粒子ノイズの最大不透明度（全面に重ねても輝度変化が10%未満）
  grainShiftMs: 500, // 粒子ノイズを動かす最短の間隔
  stageFadeMs: 1600, // 段階が変わるときの色の遷移時間（急な全画面の変化を避ける）
  redShare: 0.8, // 飽和した赤の点滅は使わない。R/(R+G+B)がこの値以上の色は使わない
};

const MOTIF = {
  dark_enclosed: ['corridor', 'dark'],
  depth_vastness: ['horizon', 'water'],
  humanoid_face: ['face', 'single'],
  gaze_surveillance: ['window', 'pane'],
  medical_invasive: ['corridor', 'clinic'],
  contamination_decay: ['blotches', 'stain'],
  bugs_animals: ['blotches', 'swarm'],
  supernatural: ['window', 'door'],
  death_loss: ['room', 'table'],
  malice_social: ['horizon', 'figures'],
  self_dissolution: ['face', 'double'],
  tech_digital: ['screen', 'log'],
  everyday_estrangement: ['corridor', 'plain'],
  isolation_abandonment: ['window', 'lone'],
  chaos_cult_ritual: ['radial', 'ring'],
};
// 色相(度)と彩度(%)。彩度は低く抑え、紫やネオン系を避ける
export const TINT = {
  dark_enclosed: [35, 8], depth_vastness: [200, 14], humanoid_face: [30, 10], gaze_surveillance: [210, 8],
  medical_invasive: [150, 12], contamination_decay: [75, 16], bugs_animals: [60, 10], supernatural: [190, 7],
  death_loss: [38, 12], malice_social: [25, 8], self_dissolution: [215, 6], tech_digital: [170, 10],
  everyday_estrangement: [45, 10], isolation_abandonment: [220, 10], chaos_cult_ritual: [20, 12],
};
// 段階ごとの明るさ(%)。侵犯で最も暗くなり、余韻で少し戻る
export const LIGHT = [66, 56, 44, 28, 40];

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${Math.max(0, Math.min(100, l))}%,${a})`;
const lerp = (a, b, t) => a + (b - a) * t;

function noiseTile(seed) {
  const r = makeRng(seed, 'grain');
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.floor(r() * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ===== SECTION: モチーフ =====
// 各関数は (ctx, W, H, p) を受け取る。p: { r(乱数), st(段階の連続値0〜4), hue, sat, L(明るさ), t(秒), kind }
function corridor(ctx, W, H, p) {
  const cx = W * (0.5 + (p.r() - 0.5) * 0.06);
  const cy = H * 0.46;
  const vw = W * (p.kind === 'dark' ? 0.06 : 0.1);
  const vh = H * (p.kind === 'dark' ? 0.08 : 0.14);
  const wall = hsl(p.hue, p.sat, p.L * 0.8);
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.55);
  ctx.fillRect(0, 0, W, H);
  // 壁・天井・床
  const poly = (pts, col) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  };
  poly([[0, 0], [W, 0], [cx + vw, cy - vh], [cx - vw, cy - vh]], hsl(p.hue, p.sat, p.L * 0.65));
  poly([[0, H], [W, H], [cx + vw, cy + vh], [cx - vw, cy + vh]], hsl(p.hue, p.sat, p.L * 0.5));
  poly([[0, 0], [cx - vw, cy - vh], [cx - vw, cy + vh], [0, H]], wall);
  poly([[W, 0], [cx + vw, cy - vh], [cx + vw, cy + vh], [W, H]], hsl(p.hue, p.sat, p.L * 0.74));
  // 等間隔に並ぶ照明と扉。段階が進むと間隔が不揃いになり、数が合わなくなる
  const n = p.kind === 'long' || p.kind === 'plain' ? 9 : 6;
  const jitter = 0.04 * p.st;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) / (n + 1);
    const z = Math.pow(k, 1.7) + (p.r() - 0.5) * jitter;
    const y0 = lerp(cy - vh, 0, z);
    const x0 = lerp(cx - vw, 0, z);
    const x1 = lerp(cx + vw, W, z);
    const lit = p.kind === 'dark' ? i < 2 : p.r() > 0.12 * p.st;
    if (lit) {
      ctx.fillStyle = hsl(p.hue, p.sat + 6, Math.min(92, p.L + 34), p.kind === 'dark' ? 0.5 : 0.8);
      ctx.fillRect(lerp(cx, W / 2, z) - (x1 - x0) * 0.06, y0, (x1 - x0) * 0.12, 4 + 10 * z);
    }
    if (p.kind !== 'dark') {
      const dh = lerp(vh * 1.6, H * 0.5, z);
      ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.5);
      ctx.fillRect(x0 + (x1 - x0) * 0.02, cy + vh - dh * 0.5 - (1 - z) * 4, 6 + 40 * z, dh * 0.5);
    }
  }
  if (p.kind === 'dark') {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, H * 0.5);
    g.addColorStop(0, hsl(p.hue, 10, 70, 0.5));
    g.addColorStop(1, hsl(p.hue, 10, 10, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return [cx, cy + vh * 0.2];
}

function windowScene(ctx, W, H, p) {
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.45);
  ctx.fillRect(0, 0, W, H);
  const cols = 7;
  const rows = 5;
  const cw = W / cols;
  const rh = H / rows;
  const lone = p.kind === 'lone' ? Math.floor(p.r() * cols * rows) : -1;
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * cw + cw * 0.15;
    const y = Math.floor(i / cols) * rh + rh * 0.15;
    const lit = p.kind === 'lone' ? i === lone : p.r() > 0.82;
    ctx.fillStyle = lit ? hsl(45, 40, 70, 0.85) : hsl(p.hue, p.sat, p.L * 0.3);
    ctx.fillRect(x, y, cw * 0.7, rh * 0.7);
  }
  if (p.kind === 'pane' || p.kind === 'door') {
    // 近景: 窓枠（または半開きの扉）と、その向こうの淡い人影
    const fx = W * 0.26, fy = H * 0.12, fw = W * 0.48, fh = H * 0.78;
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.18);
    ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.32);
    ctx.fillRect(fx + fw * 0.06, fy + fh * 0.05, fw * 0.88, fh * 0.9);
    const a = Math.min(1, p.st / 3);
    if (p.kind === 'pane') {
      ctx.fillStyle = hsl(p.hue, p.sat, p.L + 30, 0.12 + 0.3 * a);
      const px = fx + fw * (0.3 + 0.4 * p.r());
      ctx.beginPath();
      ctx.arc(px, fy + fh * 0.4, fw * 0.07, 0, 7);
      ctx.fill();
      ctx.fillRect(px - fw * 0.07, fy + fh * 0.4 + fw * 0.07, fw * 0.14, fh * 0.35);
      ctx.fillStyle = hsl(50, 30, 85, 0.25 + 0.5 * a);
      ctx.fillRect(px - fw * 0.035, fy + fh * 0.37, fw * 0.02, fw * 0.012);
      ctx.fillRect(px + fw * 0.015, fy + fh * 0.37, fw * 0.02, fw * 0.012);
    } else {
      ctx.fillStyle = hsl(p.hue, 6, 86, 0.1 + 0.35 * a);
      ctx.fillRect(fx + fw * 0.46, fy + fh * 0.05, fw * (0.02 + 0.03 * p.st), fh * 0.9);
    }
  }
  return [W * 0.5, H * 0.5];
}

function face(ctx, W, H, p) {
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.42);
  ctx.fillRect(0, 0, W, H);
  const draw = (ox, oy, alpha, off) => {
    const cx = W / 2 + ox, cy = H * 0.5 + oy;
    const rw = W * 0.2, rh = H * 0.34;
    ctx.fillStyle = hsl(p.hue, p.sat + 4, p.L + 22, alpha);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw, rh, 0, 0, 7);
    ctx.fill();
    // 目と口。段階が進むほど位置と大きさが合わなくなる
    const m = 1 + off * p.st * 0.5;
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.25, alpha);
    ctx.beginPath();
    ctx.ellipse(cx - rw * 0.4, cy - rh * 0.15, rw * 0.12 * m, rw * 0.07, 0, 0, 7);
    ctx.ellipse(cx + rw * 0.42, cy - rh * (0.15 - 0.1 * off * p.st), rw * 0.1, rw * 0.1 * m, 0, 0, 7);
    ctx.fill();
    if (p.st < 3) ctx.fillRect(cx - rw * 0.25, cy + rh * 0.4, rw * 0.5 * (1 + off), 3);
  };
  const base = (p.r() - 0.5) * 6;
  draw(base, 0, 0.9, p.r() * 0.6);
  if (p.kind === 'double') draw(base + W * 0.03 * (0.4 + p.st), H * 0.012 * p.st, 0.38, 0);
  return [W / 2 + W * 0.22, H * 0.4];
}

function horizon(ctx, W, H, p) {
  const hy = H * (p.kind === 'water' ? 0.52 : 0.58);
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, hsl(p.hue, p.sat, p.L * 0.8));
  sky.addColorStop(1, hsl(p.hue, p.sat, p.L * 1.05));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hy);
  const sea = ctx.createLinearGradient(0, hy, 0, H);
  sea.addColorStop(0, hsl(p.hue, p.sat + 4, p.L * 0.55));
  sea.addColorStop(1, hsl(p.hue, p.sat + 4, p.L * 0.12));
  ctx.fillStyle = sea;
  ctx.fillRect(0, hy, W, H - hy);
  if (p.kind === 'water') {
    // 足元から広がる輪。ゆっくり広がる
    for (let i = 0; i < 6; i++) {
      const k = ((i / 6) + p.t * 0.02) % 1;
      ctx.strokeStyle = hsl(p.hue, p.sat, p.L + 20, 0.22 * (1 - k));
      ctx.beginPath();
      ctx.ellipse(W / 2, H * 0.84, W * 0.55 * k, H * 0.1 * k, 0, 0, 7);
      ctx.stroke();
    }
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.08, 0.7);
    ctx.fillRect(0, H * 0.94, W, H * 0.06);
    return [W * (0.3 + 0.4 * p.r()), hy + (H - hy) * 0.5];
  }
  // 人影の列。段階が進むと1人だけこちらに近く、向きが違う
  const n = 9;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (W / n) + (p.r() - 0.5) * 6;
    const near = i === Math.floor(n * 0.62) ? Math.min(1, p.st / 3) : 0;
    const s = 1 + near * 1.6;
    const by = hy + 4 + near * H * 0.12;
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.14, 0.9);
    ctx.fillRect(x - 5 * s, by - 34 * s, 10 * s, 34 * s);
    ctx.beginPath();
    ctx.arc(x, by - 38 * s, 5.5 * s, 0, 7);
    ctx.fill();
  }
  return [W * 0.62, hy - 10];
}

function blotches(ctx, W, H, p) {
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.78);
  ctx.fillRect(0, 0, W, H);
  if (p.kind === 'stain') {
    const n = 5 + Math.floor(p.st * 4);
    for (let i = 0; i < n; i++) {
      const x = p.r() * W, y = p.r() * H, rad = (0.05 + p.r() * 0.12) * W * (0.6 + p.st * 0.3);
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad);
      g.addColorStop(0, hsl(p.hue - 10, p.sat + 10, p.L * 0.28, 0.55));
      g.addColorStop(1, hsl(p.hue, p.sat, p.L * 0.5, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  } else {
    const n = 40 + Math.floor(p.st * 70);
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.12, 0.85);
    for (let i = 0; i < n; i++) {
      // 床の目地に沿って一方向へ進む点の群れ
      const lane = Math.floor(p.r() * 6);
      const phase = p.r();
      const k = (phase + p.t * 0.015) % 1;
      const x = lane * (W / 6) + W / 12 + (p.r() - 0.5) * 10;
      ctx.beginPath();
      ctx.arc(x, k * H, 1.6 + p.r() * 1.8, 0, 7);
      ctx.fill();
    }
  }
  return [W * 0.5, H * 0.5];
}

function room(ctx, W, H, p) {
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.7);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.45);
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  // 窓の光
  const g = ctx.createLinearGradient(W * 0.1, 0, W * 0.5, H);
  g.addColorStop(0, hsl(45, 30, 80, 0.35 * (1 - p.st / 5)));
  g.addColorStop(1, hsl(45, 30, 80, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 机、椅子、湯呑み
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.3);
  ctx.fillRect(W * 0.3, H * 0.55, W * 0.4, H * 0.05);
  ctx.fillRect(W * 0.33, H * 0.6, W * 0.025, H * 0.2);
  ctx.fillRect(W * 0.645, H * 0.6, W * 0.025, H * 0.2);
  const pull = Math.min(1, p.st / 3) * W * 0.05; // 椅子が少しずつ引かれている
  ctx.fillRect(W * 0.46 + pull, H * 0.62, W * 0.1, H * 0.04);
  ctx.fillRect(W * 0.46 + pull, H * 0.46, W * 0.015, H * 0.2);
  ctx.fillRect(W * 0.5 + pull + W * 0.02, H * 0.66, W * 0.015, H * 0.14);
  ctx.fillStyle = hsl(p.hue, p.sat, p.L + 15, 0.9);
  ctx.fillRect(W * 0.55, H * 0.5, W * 0.03, H * 0.05);
  return [W * 0.52 + pull, H * 0.6];
}

function screen(ctx, W, H, p) {
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.3);
  ctx.fillRect(0, 0, W, H);
  const sx = W * 0.14, sy = H * 0.14, sw = W * 0.72, sh = H * 0.6;
  ctx.fillStyle = hsl(p.hue, p.sat + 6, p.L * 0.5);
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = hsl(p.hue, p.sat, p.L + 28, 0.55);
  const rows = 11;
  for (let i = 0; i < rows; i++) {
    const w = sw * (0.25 + 0.6 * p.r());
    ctx.fillRect(sx + sw * 0.05, sy + sh * 0.08 + i * (sh * 0.08), p.st > 2 && i === rows - 2 ? sw * 0.9 : w, 3);
  }
  ctx.fillRect(sx + sw * 0.05, sy + sh * 0.08 + (rows - 1) * (sh * 0.08), 7, 11); // 静止したカーソル
  // 走査線（静止）
  ctx.fillStyle = hsl(p.hue, p.sat, 5, 0.12);
  for (let y = sy; y < sy + sh; y += 4) ctx.fillRect(sx, y, sw, 1);
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.2);
  ctx.fillRect(W * 0.4, sy + sh, W * 0.2, H * 0.1);
  return [sx + sw * 0.8, sy + sh * 0.3];
}

function radial(ctx, W, H, p) {
  ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.6);
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.52, R = Math.min(W, H) * 0.34;
  ctx.strokeStyle = hsl(p.hue, p.sat, p.L * 0.18, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 7);
  ctx.stroke();
  const n = 12 + Math.floor(p.st * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + p.t * 0.002;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    ctx.fillStyle = hsl(p.hue, p.sat, p.L * 0.14, 0.9);
    ctx.fillRect(x - 3, y - 12, 6, 16);
    ctx.beginPath();
    ctx.arc(x, y - 16, 4, 0, 7);
    ctx.fill();
  }
  return [cx, cy];
}
const DRAW = { corridor, window: windowScene, face, horizon, blotches, room, screen, radial };

/** 段階が進むと現れる小さな異物。位置はseedで決まる。段階が戻る余韻でも1つ残る */
function anomaly(ctx, anchor, p, W, H) {
  const a = Math.min(1, Math.max(0, (p.st - 0.6) / 2.4));
  if (a <= 0) return;
  const [x, y] = anchor;
  ctx.fillStyle = hsl(p.hue, 8, 90, 0.5 * a);
  ctx.fillRect(x - 2, y - 14 * a, 4, 14 * a);
  ctx.beginPath();
  ctx.arc(x, y - 18 * a, 3.5 * a, 0, 7);
  ctx.fill();
}

/**
 * 映像を描画するオブジェクトを作る。
 * opts: { reducedMotion: boolean }。reducedMotionのときは段階が変わるたびに1回だけ描く
 */
export function createVisual(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  let scene = null;
  let stFrom = 0, stTo = 0, tChange = 0;
  let raf = 0, last = 0, grain = null, grainOffset = [0, 0], grainAt = 0;

  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  function frame(now) {
    if (!scene) return;
    size();
    const t = now / 1000;
    const fade = opts.reducedMotion ? 1 : Math.min(1, (now - tChange) / SAFETY.stageFadeMs);
    const st = lerp(stFrom, stTo, fade * fade * (3 - 2 * fade));
    const [motif, kind] = MOTIF[scene.theme];
    const lowRes = 1 - 0.1 * Math.min(4, Math.max(0, st - 1)); // 段階が進むと解像度が劣化する
    off.width = Math.max(64, Math.floor(canvas.width * lowRes));
    off.height = Math.max(64, Math.floor(canvas.height * lowRes));
    const [hue, sat] = TINT[scene.theme];
    const lt = LIGHT[Math.floor(st)] ?? LIGHT[4];
    const lt2 = LIGHT[Math.min(4, Math.floor(st) + 1)];
    const L = lerp(lt, lt2, st - Math.floor(st));
    const r = makeRng(scene.seed, 'visual', scene.theme);
    const p = { r, st, hue, sat, L, t: opts.reducedMotion ? 0 : t, kind };
    const anchor = DRAW[motif](octx, off.width, off.height, p);
    anomaly(octx, anchor, p, off.width, off.height);
    // 合成: 劣化した解像度を引き伸ばす → ビネット → 粒子ノイズ
    ctx.imageSmoothingEnabled = st < 2.5;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    const v = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.25, canvas.width / 2, canvas.height / 2, canvas.height * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.25 + 0.12 * st})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!opts.reducedMotion) {
      if (!grain) grain = ctx.createPattern(noiseTile(scene.seed), 'repeat');
      if (now - grainAt > SAFETY.grainShiftMs) {
        grainAt = now;
        grainOffset = [Math.floor(r() * 128), Math.floor(r() * 128)];
      }
      ctx.save();
      ctx.globalAlpha = Math.min(SAFETY.grainAlphaMax, 0.035 + 0.015 * st);
      ctx.translate(grainOffset[0], grainOffset[1]);
      ctx.fillStyle = grain;
      ctx.fillRect(-128, -128, canvas.width + 256, canvas.height + 256);
      ctx.restore();
    }
  }

  const loop = (now) => {
    if (now - last > 66) { // 約15fps。動きは緩やかなので十分
      last = now;
      frame(now);
    }
    raf = requestAnimationFrame(loop);
  };

  return {
    /** scene: { theme, seed, level } */
    setScene(s) {
      scene = s;
      grain = null;
    },
    /** 段階(0〜4)を切り替える。遷移はSAFETY.stageFadeMsをかけて行う */
    setStage(st) {
      const now = performance.now();
      const cur = opts.reducedMotion ? stTo : lerp(stFrom, stTo, Math.min(1, (now - tChange) / SAFETY.stageFadeMs));
      stFrom = cur;
      stTo = st;
      tChange = now;
      if (opts.reducedMotion || !raf) frame(now);
    },
    start() {
      if (opts.reducedMotion) return frame(performance.now());
      if (!raf) raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    /** テストと静止表示用: 指定の段階で即座に1枚描く */
    drawAt(st) {
      stFrom = stTo = st;
      tChange = -1e9;
      frame(performance.now());
    },
  };
}
