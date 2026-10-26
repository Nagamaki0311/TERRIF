// 乱数の回答者1人分の診断→レシピ→文章を表示する。文章の品質確認用。
// 使い方: node scripts/preview.mjs [--who=1] [--level=2] [--effects=1]
import { loadData, args } from './lib.mjs';
import { createSession } from '../src/engine/engine.js';
import { buildRecipe } from '../src/engine/recipe.js';
import { composeStory } from '../src/render/text.js';
import { rand1 } from '../src/engine/rng.js';

const a = args();
const who = a.who ?? 1;
const d = loadData();
const vars = d.dimensions.variables;
const normal = (...p) => Math.sqrt(-2 * Math.log(1 - rand1(...p, 'u'))) * Math.cos(2 * Math.PI * rand1(...p, 'v'));
const t = Object.fromEntries(vars.map((v) => [v.id, normal(who, v.id) * 0.9]));
const s = createSession(d, `prev-${who}`);
for (let q = s.next(); q; q = s.next()) {
  let z = 0;
  for (const [id, w] of Object.entries(q.loadings)) z += w * t[id];
  const sc = z * 1.1 + normal(who, q.id) * 0.45;
  s.answer(q.id, sc > 0.75 ? 'SA' : sc > 0.25 ? 'A' : sc > -0.25 ? 'N' : sc > -0.75 ? 'D' : 'SD');
}
const r = s.result();
const recipe = buildRecipe(r, d, { levelCap: a.level ?? 3, effects: a.effects !== 0 }, `prev-${who}`, d.questions.questions);
console.log(`回答${r.answered}問 / 上位: ${r.themes.slice(0, 3).map((x) => x.id).join(', ')} | ${r.mechs.slice(0, 2).map((x) => x.id).join(', ')}`);
console.log(`コア ${recipe.core.title}（${recipe.core.id}） サポート ${recipe.supports.map((x) => x.title).join(' / ')}`);
console.log(`強度${recipe.level} ペース${recipe.pace} 形式${recipe.form} 語り口${recipe.voice} エコー${recipe.echoes.length}件\n`);
for (const st of composeStory(recipe, d.fragments, `prev-${who}`)) {
  console.log(`--- ${st.name}`);
  for (const l of st.lines) console.log(`  ${l.text}`);
}
