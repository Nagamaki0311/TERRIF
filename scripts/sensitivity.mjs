// 感度分析: 1問の回答を変えたとき、最終結果（コア次元）がどれだけ変わるか。
// 後続の回答は回答者ごとに固定した規則で決まるため、変化は「その1問の回答」と、それにより変わる出題順の影響の合計になる。
// 使い方: node scripts/sensitivity.mjs [--n=2500] [--out=docs/validation/sensitivity.md]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadData, args, root } from './lib.mjs';
import { createSession } from '../src/engine/engine.js';
import { rand1 } from '../src/engine/rng.js';

const a = args();
const N = a.n ?? 2500;
const d = loadData();
const vars = d.dimensions.variables;
const themeIds = vars.filter((v) => v.kind === 'theme').map((v) => v.id);
const normalAt = (...p) => Math.sqrt(-2 * Math.log(1 - rand1(...p, 'u'))) * Math.cos(2 * Math.PI * rand1(...p, 'v'));

const trueProfile = (who) => Object.fromEntries(vars.map((v) => [v.id, normalAt(who, v.id) * 0.9]));
function respond(t, who, q) {
  let z = 0;
  for (const [id, w] of Object.entries(q.loadings)) z += w * t[id];
  const sc = z * 1.1 + normalAt(who, q.id) * 0.45;
  return sc > 0.75 ? 'SA' : sc > 0.25 ? 'A' : sc > -0.25 ? 'N' : sc > -0.75 ? 'D' : 'SD';
}
const FLIP = { SA: 'SD', A: 'D', N: 'SA', D: 'A', SD: 'SA' };

function run(seed, who, t, force) {
  const s = createSession(d, seed);
  for (let q = s.next(); q; q = s.next()) {
    const code = force && force.id === q.id ? force.code : respond(t, who, q);
    s.answer(q.id, code);
  }
  return s.result();
}

const stat = {};
for (let i = 0; i < N; i++) {
  const who = `sens-${i}`;
  const t = trueProfile(who);
  const base = run(who, who, t);
  const asked = base.answers.filter((x) => x.code !== 'DK');
  for (let k = 0; k < 6; k++) {
    const pick = asked[Math.floor(rand1(who, 'pick', k) * asked.length)];
    const alt = run(who, who, t, { id: pick.id, code: FLIP[pick.code] });
    const st = (stat[pick.id] ??= { n: 0, coreChange: 0, top3Change: 0, shift: 0 });
    st.n++;
    if (alt.themes[0].id !== base.themes[0].id) st.coreChange++;
    if (alt.themes.slice(0, 3).map((x) => x.id).sort().join() !== base.themes.slice(0, 3).map((x) => x.id).sort().join()) st.top3Change++;
    st.shift += themeIds.reduce((acc, id) => acc + Math.abs(alt.themes.find((x) => x.id === id).z - base.themes.find((x) => x.id === id).z), 0) / themeIds.length;
  }
}

const rows = Object.entries(stat)
  .filter(([, s]) => s.n >= 15)
  .map(([id, s]) => ({ id, n: s.n, core: s.coreChange / s.n, top3: s.top3Change / s.n, shift: s.shift / s.n }))
  .sort((x, y) => y.core - x.core);
const q = (id) => d.questions.questions.find((x) => x.id === id);
const mean = (k) => rows.reduce((acc, r) => acc + r[k], 0) / rows.length;
const fmt = (r) => `| ${r.id} | ${q(r.id).text.slice(0, 22)} | ${r.n} | ${(r.core * 100).toFixed(0)}% | ${(r.top3 * 100).toFixed(0)}% | ${r.shift.toFixed(2)} |`;
const header = '| 設問 | 文 | 試行 | コア次元が変わる | 上位3が変わる | 全次元の平均z変化 |\n|---|---|---|---|---|---|';
const md = `# 感度分析

生成: \`node scripts/sensitivity.mjs --n=${N}\`。1問の回答を反対側へ変えたときの影響（試行${rows.reduce((a2, r) => a2 + r.n, 0)}件、${rows.length}問）。

- コア次元が変わる割合の平均: ${(mean('core') * 100).toFixed(1)}%
- 上位3が変わる割合の平均: ${(mean('top3') * 100).toFixed(1)}%

## 敏感な設問（上位10）
${header}
${rows.slice(0, 10).map(fmt).join('\n')}

## 鈍感な設問（下位10）
${header}
${rows.slice(-10).map(fmt).join('\n')}
`;
if (a.out) {
  mkdirSync(dirname(join(root, a.out)), { recursive: true });
  writeFileSync(join(root, a.out), md);
}
console.log(md);
