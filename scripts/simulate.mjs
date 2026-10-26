// 擬似回答者シミュレーション。潜在プロファイルから回答を生成し、診断エンジンの挙動を集計する。
// 内部整合性の検証であり、実際の恐怖反応との一致（妥当性）は示さない（指示書9.1）。
// 使い方: node scripts/simulate.mjs [--n=100000] [--seed=1] [--out=docs/validation/simulation.md]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadData, args, root } from './lib.mjs';
import { createSession } from '../src/engine/engine.js';
import { mulberry32 } from '../src/engine/rng.js';

const a = args();
const N = a.n ?? 100000;
const SEED = a.seed ?? 1;
const d = loadData();
const vars = d.dimensions.variables;
const themeIds = vars.filter((v) => v.kind === 'theme').map((v) => v.id);
const mechIds = vars.filter((v) => v.kind === 'mech').map((v) => v.id);
const qs = d.questions.questions;
const rng = mulberry32(SEED * 7919 + 13);
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

/** 回答者の類型。typeごとに潜在値tと回答規則を持つ */
function makeRespondent(i) {
  const r = rng();
  const t = Object.fromEntries(vars.map((v) => [v.id, normal() * 0.9]));
  if (r < 0.7) return { type: 'random', t };
  if (r < 0.85) {
    const focus = themeIds[i % themeIds.length];
    for (const id of themeIds) t[id] = normal() * 0.4;
    t[focus] = 2 + rng();
    return { type: 'single', focus, t };
  }
  const kinds = ['indifferent', 'acquiescent', 'contrarian', 'uniform', 'tolerant'];
  const type = kinds[Math.floor(rng() * kinds.length)];
  if (type === 'tolerant') for (const id of [...themeIds, ...mechIds]) t[id] = -1.5 + normal() * 0.3;
  if (type === 'indifferent') for (const id of Object.keys(t)) t[id] = 0;
  return { type, t };
}

function respond(p, q) {
  if (rng() < 0.03) return 'DK';
  if (p.type === 'acquiescent') return rng() < 0.6 ? 'SA' : 'A';
  if (p.type === 'contrarian') return rng() < 0.6 ? 'SD' : 'D';
  if (p.type === 'uniform') return ['SA', 'A', 'N', 'D', 'SD'][Math.floor(rng() * 5)];
  let z = 0;
  for (const [id, w] of Object.entries(q.loadings)) z += w * p.t[id];
  const sc = z * 1.1 + normal() * 0.45;
  return sc > 0.75 ? 'SA' : sc > 0.25 ? 'A' : sc > -0.25 ? 'N' : sc > -0.75 ? 'D' : 'SD';
}

const spearman = (xs, ys) => {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - mx);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - mx) ** 2;
  }
  return num / Math.sqrt(dx * dy);
};

const exposure = Object.fromEntries(qs.map((q) => [q.id, 0]));
const lengths = [];
const top1 = {};
const byType = {};
const topMech = {};
let stableStops = 0;
let maxStops = 0;
let hitTop3 = 0, hitN = 0, corrSum = 0, corrN = 0, singleHit = 0, singleN = 0;
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const p = makeRespondent(i);
  const s = createSession(d, `sim-${SEED}-${i}`);
  for (let q = s.next(); q; q = s.next()) {
    exposure[q.id]++;
    s.answer(q.id, respond(p, q));
  }
  const res = s.result();
  lengths.push(res.answered);
  if (res.stable) stableStops++;
  else maxStops++;
  top1[res.themes[0].id] = (top1[res.themes[0].id] ?? 0) + 1;
  topMech[res.mechs[0].id] = (topMech[res.mechs[0].id] ?? 0) + 1;
  const bt = (byType[p.type] ??= { n: 0, len: 0, sigma: 0 });
  bt.n++;
  bt.len += res.answered;
  bt.sigma += res.themes.reduce((x, y) => x + y.sigma, 0) / res.themes.length;
  if (p.type === 'random') {
    const trueTop3 = [...themeIds].sort((x, y) => p.t[y] - p.t[x]).slice(0, 3);
    hitN++;
    if (trueTop3.includes(res.themes[0].id)) hitTop3++;
    const est = themeIds.map((id) => res.themes.find((t) => t.id === id).mu);
    corrSum += spearman(themeIds.map((id) => p.t[id]), est);
    corrN++;
  }
  if (p.type === 'single') {
    singleN++;
    if (res.themes[0].id === p.focus) singleHit++;
  }
}

lengths.sort((x, y) => x - y);
const pct = (q) => lengths[Math.floor((lengths.length - 1) * q)];
const entropy = (obj) => {
  const tot = Object.values(obj).reduce((x, y) => x + y, 0);
  return -Object.values(obj).reduce((e, c) => e + (c / tot) * Math.log2(c / tot), 0);
};
const exp = Object.entries(exposure).sort((x, y) => x[1] - y[1]);
const never = exp.filter(([, c]) => c === 0).map(([id]) => id);
const rows = (obj) => Object.entries(obj).sort((x, y) => y[1] - x[1]).map(([k, c]) => `| ${k} | ${c} | ${((c / N) * 100).toFixed(1)}% |`);
const maxShare = Math.max(...Object.values(top1)) / N;

const md = `# 擬似回答者シミュレーション結果

生成: \`node scripts/simulate.mjs --n=${N} --seed=${SEED}\`（${((Date.now() - t0) / 1000).toFixed(1)}秒）。
内部整合性の検証であり、実際の恐怖反応との一致は示さない。

## 設問数

| 指標 | 値 |
|---|---|
| 平均 | ${(lengths.reduce((x, y) => x + y, 0) / N).toFixed(1)} |
| 5% / 50% / 95% | ${pct(0.05)} / ${pct(0.5)} / ${pct(0.95)} |
| 安定条件で終了 | ${((stableStops / N) * 100).toFixed(1)}% |
| 上限到達で終了 | ${((maxStops / N) * 100).toFixed(1)}% |

## 回答者類型ごと

| 類型 | 人数 | 平均設問数 | 次元の不確実性（平均sigma） |
|---|---|---|---|
${Object.entries(byType).map(([k, v]) => `| ${k} | ${v.n} | ${(v.len / v.n).toFixed(1)} | ${(v.sigma / v.n).toFixed(2)} |`).join('\n')}

## 推定精度（潜在プロファイルとの比較）

| 指標 | 値 |
|---|---|
| ランダム型: 推定1位が真の上位3に入る割合 | ${((hitTop3 / hitN) * 100).toFixed(1)}% |
| ランダム型: 次元の順位相関（Spearman、平均） | ${(corrSum / corrN).toFixed(3)} |
| 単一テーマ型: 推定1位が真の対象と一致する割合 | ${((singleHit / singleN) * 100).toFixed(1)}% |

## 推定1位の次元の分布（偏りの確認）

エントロピー ${entropy(top1).toFixed(2)} bit（一様なら ${Math.log2(themeIds.length).toFixed(2)}）。最大シェア ${(maxShare * 100).toFixed(1)}%。1位に一度もならない次元: ${themeIds.filter((t) => !top1[t]).join(', ') || 'なし'}。

| 次元 | 人数 | 割合 |
|---|---|---|
${rows(top1).join('\n')}

## 推定1位の仕組みの分布

| 仕組み | 人数 | 割合 |
|---|---|---|
${rows(topMech).join('\n')}

## 設問の出題回数

- 一度も出題されなかった設問: ${never.length}問${never.length ? '（' + never.join(', ') + '）' : ''}
- 最少 / 最多: ${exp[0][1]} / ${exp[exp.length - 1][1]}
- 出題回数の少ない10問: ${exp.slice(0, 10).map(([id, c]) => `${id}(${c})`).join(', ')}
- 出題回数の多い10問: ${exp.slice(-10).reverse().map(([id, c]) => `${id}(${c})`).join(', ')}
`;
if (a.out) {
  mkdirSync(dirname(join(root, a.out)), { recursive: true });
  writeFileSync(join(root, a.out), md);
}
console.log(md);
// 判定: 到達しない設問がある、または特定の次元に過度に偏る場合は失敗とする
const failures = [];
if (never.length) failures.push(`一度も出題されない設問が${never.length}問`);
if (maxShare > 0.25) failures.push(`推定1位の最大シェアが${(maxShare * 100).toFixed(1)}%で25%を超える`);
if (themeIds.some((t) => !top1[t])) failures.push('1位にならない次元がある');
if (failures.length) {
  console.error('シミュレーションの判定: 要調整\n - ' + failures.join('\n - '));
  process.exitCode = a.strict ? 1 : 0;
}
