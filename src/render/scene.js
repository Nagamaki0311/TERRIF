// 視覚演出（シーン）の再生。素材画像（Grok等で生成して assets/scenes/ に置く）を層として重ね、
// 拡大・移動・ぼかし・不透明度の時間変化とコード生成の効果（粒子・ビネット・粒子ノイズ）で1本の映像体験にする。
// 素材が無い層は、同じ構図のコード生成の代替で描く（素材が揃う前でも動く）。閃光は使わない。
import { makeRng } from '../engine/rng.js';

/** 安全上の上限。scripts/safety.mjs が検査する */
export const SCENE_SAFETY = {
  jumpSec: 0.45, // 突発型の素早い遷移の最短時間
  maxJumps: 1, // 突発的な変化は1つの体験で1回まで（驚愕は繰り返しで馴化するため。docs/content_policy.md）
  driftSec: 7, // 画面のゆっくりした揺れの周期（点滅を避ける）
  grainAlphaMax: 0.08,
  grainShiftMs: 500,
};
const PACE_MUL = { slow: 1.25, loop: 1, sudden: 0.85 };
const PRESENCE = { 1: 0.6, 2: 0.85, 3: 1 };
const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;

// ===== SECTION: 素材が無いときの代替（コード生成） =====
const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
};
const vgrad = (g, w, h, stops) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  stops.forEach(([p, col]) => gr.addColorStop(p, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
};
const blur = (g, px) => {
  if ('filter' in g) g.filter = `blur(${px}px)`;
};
const PLACEHOLDER = {
  'deep_sea_giant/surface': (g, w, h) => {
    vgrad(g, w, h, [[0, '#4a8c8f'], [0.55, '#1d4a58'], [1, '#0a2330']]);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(200,235,230,.07)';
      g.beginPath();
      const x = w * (0.1 + i * 0.13);
      g.moveTo(x, 0);
      g.lineTo(x + w * 0.05, 0);
      g.lineTo(x + w * (0.12 - i * 0.02), h);
      g.lineTo(x - w * 0.04, h);
      g.fill();
    }
  },
  'deep_sea_giant/deep': (g, w, h) => vgrad(g, w, h, [[0, '#0d2230'], [0.4, '#06121b'], [1, '#010305']]),
  'deep_sea_giant/far': (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    blur(g, h * 0.03);
    g.fillStyle = 'rgba(90,120,140,.5)';
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.5, w * 0.34, h * 0.09, -0.05, 0, 7);
    g.fill();
    g.beginPath();
    g.moveTo(w * 0.82, h * 0.5);
    g.lineTo(w * 0.97, h * 0.38);
    g.lineTo(w * 0.95, h * 0.58);
    g.fill();
  },
  'deep_sea_giant/near': (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    blur(g, h * 0.012);
    const gr = g.createLinearGradient(0, h * 0.15, 0, h);
    gr.addColorStop(0, 'rgba(120,150,165,.6)');
    gr.addColorStop(1, 'rgba(20,40,52,.1)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.78, w * 0.7, h * 0.55, 0, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(8,20,28,.5)';
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(w * (0.05 + i * 0.11), h);
      g.quadraticCurveTo(w * (0.2 + i * 0.1), h * 0.5, w * (0.45 + i * 0.05), h * 0.3);
      g.stroke();
    }
  },
  'deep_sea_giant/eye': (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const r = h * 0.3;
    const gr = g.createRadialGradient(w / 2, h / 2, r * 0.2, w / 2, h / 2, r);
    gr.addColorStop(0, 'rgba(210,225,225,.85)');
    gr.addColorStop(0.85, 'rgba(120,150,150,.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(w / 2, h / 2, r, 0, 7);
    g.fill();
    g.fillStyle = '#020405';
    g.beginPath();
    g.ellipse(w / 2, h / 2, r * 0.3, r * 0.6, 0, 0, 7);
    g.fill();
  },
  'dark_enclosed/room': (g, w, h) => {
    vgrad(g, w, h, [[0, '#14161b'], [1, '#07080a']]);
    const m = g.createRadialGradient(w * 0.2, 0, 10, w * 0.2, 0, w * 0.6);
    m.addColorStop(0, 'rgba(150,170,200,.18)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1c21';
    g.fillRect(w * 0.36, h * 0.12, w * 0.28, h * 0.78);
    g.fillStyle = '#000';
    g.fillRect(w * 0.495, h * 0.12, w * 0.012, h * 0.78);
  },
  'dark_enclosed/gap': (g, w, h) => {
    g.fillStyle = '#020203';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#23242a';
    g.fillRect(0, 0, w * 0.43, h);
    g.fillRect(w * 0.57, 0, w * 0.43, h);
    g.fillStyle = '#3a3c44';
    g.fillRect(w * 0.425, 0, w * 0.006, h);
    g.fillRect(w * 0.569, 0, w * 0.006, h);
  },
  'dark_enclosed/shape': (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    blur(g, h * 0.01);
    g.fillStyle = 'rgba(200,205,215,.35)';
    g.beginPath();
    g.roundRect(w * 0.47, h * 0.22, w * 0.06, h * 0.62, w * 0.03);
    g.fill();
  },
  'gaze_surveillance/room': (g, w, h) => {
    vgrad(g, w, h, [[0, '#0e131b'], [1, '#05070a']]);
    g.fillStyle = '#1c2c42';
    g.fillRect(w * 0.3, h * 0.14, w * 0.4, h * 0.62);
    g.fillStyle = '#080b10';
    g.fillRect(w * 0.31, h * 0.16, w * 0.38, h * 0.58);
    g.fillStyle = '#10151d';
    g.fillRect(w * 0.18, h * 0.1, w * 0.12, h * 0.72);
    g.fillRect(w * 0.7, h * 0.1, w * 0.12, h * 0.72);
  },
  'gaze_surveillance/view': (g, w, h) => {
    vgrad(g, w, h, [[0, '#0b1018'], [1, '#04060a']]);
    const cols = 8, rows = 5;
    for (let i = 0; i < cols * rows; i++) {
      g.fillStyle = i === 21 ? '#27384f' : '#0a0e15';
      g.fillRect((i % cols) * (w / cols) + w * 0.012, Math.floor(i / cols) * (h / rows) + h * 0.02, (w / cols) * 0.76, (h / rows) * 0.7);
    }
  },
  'gaze_surveillance/figure': (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#26384f';
    g.fillRect(w * 0.4, h * 0.12, w * 0.2, h * 0.7);
    g.fillStyle = '#04060a';
    g.beginPath();
    g.arc(w * 0.5, h * 0.36, h * 0.07, 0, 7);
    g.fill();
    g.fillRect(w * 0.45, h * 0.42, w * 0.1, h * 0.4);
  },
};

const placeholder = (key, w, h) => {
  const [c, g] = mk(w, h);
  (PLACEHOLDER[key] ?? ((x, ww, hh) => vgrad(x, ww, hh, [[0, '#111'], [1, '#000']])))(g, w, h);
  return c;
};

/** 素材を読み込む。manifest（assets/manifest.json）に載っているファイルだけを取りに行き、無いものは代替にする */
export async function loadAssets(scene, manifestFiles = []) {
  const out = {};
  await Promise.all(
    scene.assets.map(async (a) => {
      if (manifestFiles.includes(a.file)) {
        try {
          const img = new Image();
          img.src = a.file;
          await img.decode();
          out[a.id] = { src: img, real: true };
          return;
        } catch { /* 読めない場合は代替にする */ }
      }
      out[a.id] = { src: placeholder(`${scene.id}/${a.id}`, 1280, 720), real: false };
    }),
  );
  return out;
}

// ===== SECTION: 再生 =====
/** 鍵列を、突発型のとき jump=true の鍵だけ素早い遷移にして返す */
function prepKeys(keys, jumpQuick) {
  if (!jumpQuick) return keys;
  const out = [];
  keys.forEach((k, i) => {
    if (k[6] && i > 0) {
      const prev = keys[i - 1];
      const t0 = Math.max(prev[0], k[0] - SCENE_SAFETY.jumpSec);
      if (t0 > prev[0]) out.push([t0, prev[1], prev[2], prev[3], prev[4], prev[5]]);
    }
    out.push(k);
  });
  return out;
}
function sample(keys, t) {
  if (t <= keys[0][0]) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const u = smooth((t - a[0]) / (b[0] - a[0] || 1));
      return [t, lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u), lerp(a[4], b[4], u), lerp(a[5], b[5], u)];
    }
  }
  return keys[keys.length - 1];
}

/**
 * opts: { level, pace, ambiguous, reducedMotion, seed }
 * 戻り値: { duration, draw(t), stageAt(t), captionAt(t) }（時刻は実時間の秒）
 */
export function createScenePlayer(canvas, scene, meta, assets, opts) {
  const g = canvas.getContext('2d');
  const mul = PACE_MUL[opts.pace] ?? 1;
  const quickJump = opts.pace === 'sudden' && !opts.reducedMotion;
  const layers = scene.layers
    .filter((l) => (l.minLevel ?? 1) <= opts.level)
    .map((l) => ({ ...l, keys: prepKeys(l.keys, quickJump && l.keys.filter((k) => k[6]).length <= SCENE_SAFETY.maxJumps) }));
  const rng = makeRng(opts.seed, 'scene');
  const snow = scene.particles ? Array.from({ length: scene.particles.count }, () => [rng(), rng(), 0.3 + rng() * 0.7]) : [];
  let grain = null, grainAt = -1e9, grainOff = [0, 0];

  const cover = (img, w, h) => {
    const iw = img.width, ih = img.height;
    const s = Math.max(w / iw, h / ih);
    return [iw * s, ih * s];
  };

  function draw(t, nowMs = 0) {
    const W = canvas.width, H = canvas.height;
    const tt = t / mul;
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const drift = opts.reducedMotion ? 0 : Math.sin((t / SCENE_SAFETY.driftSec) * Math.PI * 2);
    for (const l of layers) {
      const [, a0, s, x, y, b] = sample(l.keys, tt);
      let a = a0;
      if (l.presence) {
        a *= PRESENCE[opts.level] ?? 0.6;
        if (opts.ambiguous) a = Math.min(a, 0.5); // 曖昧さが主な結果のときは、はっきり見せない
      }
      if (a <= 0.003) continue;
      const img = assets[l.asset].src;
      const [dw, dh] = cover(img, W, H);
      g.globalCompositeOperation = l.comp ?? 'source-over';
      g.globalAlpha = Math.min(1, a);
      g.filter = b > 0.2 && 'filter' in g ? `blur(${(b * H) / 720}px)` : 'none';
      g.save();
      g.translate(W / 2 + x * W + drift * W * 0.004, H / 2 + y * H + drift * H * 0.003);
      g.scale(s, s);
      g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.globalAlpha = 1;
    if (snow.length && tt > scene.particles.from) {
      const k = Math.min(1, (tt - scene.particles.from) / 6);
      g.fillStyle = `rgba(190,215,220,${0.35 * k})`;
      for (const [px, py, sz] of snow) {
        const yy = (py + (opts.reducedMotion ? 0 : t * 0.012 * sz)) % 1;
        g.beginPath();
        g.arc(px * W, yy * H, sz * (H / 540), 0, 7);
        g.fill();
      }
    }
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    if (!opts.reducedMotion) {
      if (!grain) {
        const [c, gg] = mk(128, 128);
        const img = gg.createImageData(128, 128);
        const r = makeRng(opts.seed, 'grain2');
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = img.data[i + 1] = img.data[i + 2] = r() < 0.5 ? 0 : 255;
          img.data[i + 3] = Math.floor(r() * 255);
        }
        gg.putImageData(img, 0, 0);
        grain = g.createPattern(c, 'repeat');
      }
      if (nowMs - grainAt > SCENE_SAFETY.grainShiftMs) {
        grainAt = nowMs;
        grainOff = [Math.floor(rng() * 128), Math.floor(rng() * 128)];
      }
      g.save();
      g.globalAlpha = SCENE_SAFETY.grainAlphaMax;
      g.translate(grainOff[0], grainOff[1]);
      g.fillStyle = grain;
      g.fillRect(-128, -128, W + 256, H + 256);
      g.restore();
    }
  }

  const starts = meta.stageStarts.map((s) => s * mul);
  const caps = scene.captions.filter((c) => c.lv <= opts.level);
  return {
    duration: meta.end * mul,
    draw,
    stageStarts: starts,
    stageAt: (t) => starts.filter((s) => t >= s).length - 1,
    captionAt: (t) => {
      const c = [...caps].reverse().find((x) => t >= x.t * mul && t < x.t * mul + 7 * mul);
      return c ? c.text : '';
    },
  };
}
