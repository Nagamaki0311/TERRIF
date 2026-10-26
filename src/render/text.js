// 体験の文章を組み立てる。レシピと文章断片から、5段階（安全→違和感→確信→侵犯→余韻）の行を作る。
// 同じレシピなら同じ文章になる。DOMには依存しない。
import { makeRng, weightedPick } from '../engine/rng.js';

const ANS = { SA: 'とても当てはまる', A: '当てはまる', D: '当てはまらない', SD: '全く当てはまらない' };

const hhmm = (m) => `${m < 12 * 60 ? '午前' : '午後'}${Math.floor(m / 60) % 12 || 12}時${String(m % 60).padStart(2, '0')}分`;

/**
 * 戻り値: [{ stage, name, lines: [{ text, kind, delay }] }]
 * kind: frame=語り口の枠 / body=本文 / echo=回答の引用 / pace=つなぎ。delayは表示前の間（ミリ秒）の目安
 */
export function composeStory(recipe, fragments, seed) {
  const rng = makeRng(seed, 'story');
  const level = recipe.level;
  const F = fragments;
  const base = 90 + Math.floor(rng() * 200); // 午前1時台〜4時台
  const slots = { no: String(1000 + Math.floor(rng() * 9000)) };
  const used = new Set();

  // 段階ごとの時刻。経過とともに単調に進む
  const offsets = [0, 1, 2, 3, 4].reduce((acc, i) => [...acc, (acc[i - 1] ?? 0) + (i ? 5 + Math.floor(rng() * 9) : 0)], []);
  const clock = (i) => hhmm(base + offsets[i]);
  const fill = (s, extra = {}) => s.replace(/\{(\w+)\}/g, (_, k) => ({ ...slots, ...extra })[k] ?? '');

  /** 強度の上限以下から、未使用の断片を選ぶ。段階が進むほど強度の高い断片を選びやすくする */
  const pick = (list, stageIdx) => {
    const ok = (list ?? []).filter((f) => f.lv <= level && !used.has(f.t));
    if (!ok.length) return null;
    const f = weightedPick(ok, ok.map((x) => 1 + (stageIdx >= 2 ? x.lv * 0.6 : 0)), rng);
    used.add(f.t);
    return f.t;
  };
  const choose = (list) => list[Math.floor(rng() * list.length)];

  const core = recipe.core;
  const supTheme = recipe.supports.find((s) => s.theme)?.theme;
  const supMech = recipe.supports.find((s) => s.mech)?.mech;
  const voice = F.voices[recipe.voice];
  const [e0, e1] = recipe.echoes;
  const echoLine = (e, after) => {
    if (!e) return null;
    const pool = F.echo[(after ? 'after_' : '') + (e.agree ? 'agree' : 'disagree')];
    return fill(choose(pool), { echo: e.echo, ans: ANS[e.code] });
  };
  const body = (text, delay) => (text ? { text, kind: 'body', delay } : null);
  const paceLine = (p) => ({ text: choose(F.pace[p]), kind: 'pace', delay: 1800 });

  const D = { slow: 2800, loop: 2200, sudden: 1500 }[recipe.pace]; // 行ごとの基本の間
  const stages = [];
  const header = (stage, i) => {
    const t = voice[stage]?.[0];
    return t ? { text: fill(t, { time: clock(i) }), kind: 'frame', delay: 1200 } : null;
  };
  const push = (stage, i, lines) =>
    stages.push({ stage, name: F.stageNames[i], lines: lines.filter(Boolean) });

  // 1. 安全
  push('safe', 0, [
    { text: fill(choose(voice.open)), kind: 'frame', delay: 800 },
    header('safe', 0),
    body(pick(F.themes[core.theme].safe, 0), D),
    recipe.pace === 'slow' ? body(pick(F.themes[core.theme].safe, 0), D) : null,
  ]);
  // 2. 違和感
  const unease = pick(F.themes[core.theme].unease, 1);
  push('unease', 1, [
    header('unease', 1),
    recipe.pace === 'slow' ? paceLine('slow') : null,
    body(unease, D),
    body(pick(F.mechs[core.mech]?.unease, 1), D),
    recipe.pace === 'loop' ? body(unease, D) : null,
  ]);
  // 3. 確信
  push('certainty', 2, [
    header('certainty', 2),
    recipe.pace === 'loop' ? paceLine('loop') : null,
    body(pick(F.themes[core.theme].certainty, 2), D),
    supTheme ? body(pick(F.themes[supTheme].certainty, 2), D) : null,
    supMech ? body(pick(F.mechs[supMech]?.certainty, 2), D) : null,
    e0 ? { text: echoLine(e0, false), kind: 'echo', delay: D + 400 } : null,
  ]);
  // 4. 侵犯: 突発型は直前に長い間を置く
  push('violation', 3, [
    header('violation', 3),
    recipe.pace === 'sudden' ? { ...paceLine('sudden'), delay: 4200 } : null,
    body(pick(F.themes[core.theme].violation, 3), recipe.pace === 'sudden' ? 600 : D),
    supTheme ? body(pick(F.themes[supTheme].violation, 3), D) : null,
    body(pick(F.mechs[core.mech]?.violation, 3), D),
    e1 ? { text: echoLine(e1, false), kind: 'echo', delay: D } : null,
  ]);
  // 5. 余韻: 画面を閉じた後の日常に残るものを、回答に結びつける
  push('afterglow', 4, [
    header('afterglow', 4),
    body(pick(F.themes[core.theme].afterglow, 4), D),
    e0 ? { text: echoLine(e0, true), kind: 'echo', delay: D + 600 } : null,
    { text: choose(voice.close), kind: 'frame', delay: D + 600 },
  ]);
  return stages;
}

/** 読み上げや保存用に、段階を1つの文字列にまとめる */
export const storyToText = (stages) =>
  stages.map((s) => s.lines.map((l) => l.text).join('\n')).join('\n\n');
