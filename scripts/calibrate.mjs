// 変数ごとのmuの平均と標準偏差を、擬似回答者から求めて data/calibration.json に保存する。
// 全次元が同程度に分布するという仮定に基づく暫定の標準化であり、評価データで更新する（docs/calibration.md）。
// 使い方: node scripts/calibrate.mjs [--n=20000]。収束のため2〜3回実行する。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, args, root } from './lib.mjs';
import { createSession } from '../src/engine/engine.js';
import { mulberry32 } from '../src/engine/rng.js';

const a = args();
const N = a.n ?? 20000;
const d = loadData();
const vars = d.dimensions.variables;
const rng = mulberry32(424242);
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const sum = Object.fromEntries(vars.map((v) => [v.id, [0, 0]]));

for (let i = 0; i < N; i++) {
  const t = Object.fromEntries(vars.map((v) => [v.id, normal() * 0.9]));
  const s = createSession(d, `cal-${i}`);
  for (let q = s.next(); q; q = s.next()) {
    if (rng() < 0.03) { s.answer(q.id, 'DK'); continue; }
    let z = 0;
    for (const [id, w] of Object.entries(q.loadings)) z += w * t[id];
    const sc = z * 1.1 + normal() * 0.45;
    s.answer(q.id, sc > 0.75 ? 'SA' : sc > 0.25 ? 'A' : sc > -0.25 ? 'N' : sc > -0.75 ? 'D' : 'SD');
  }
  const r = s.result();
  for (const list of [r.themes, r.mechs]) for (const v of list) { sum[v.id][0] += v.mu; sum[v.id][1] += v.mu * v.mu; }
}
const out = { _meta: `擬似回答者${N}人（全次元が同程度に分布する仮定）から算出。scripts/calibrate.mjsで再生成`, vars: {} };
for (const v of vars.filter((x) => x.kind === 'theme' || x.kind === 'mech')) {
  const m = sum[v.id][0] / N;
  out.vars[v.id] = { mean: +m.toFixed(4), sd: +Math.sqrt(Math.max(1e-6, sum[v.id][1] / N - m * m)).toFixed(4) };
}
writeFileSync(join(root, 'data/calibration.json'), JSON.stringify(out, null, 1) + '\n');
console.log(Object.entries(out.vars).map(([k, v]) => `${k}: mean ${v.mean} sd ${v.sd}`).join('\n'));
