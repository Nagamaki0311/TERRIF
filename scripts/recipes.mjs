// 結果レシピの検証: 到達性（全要素が選ばれうるか）、分布の偏り、結果どうしの類似度、設定（強度・演出）の遵守。
// 使い方: node scripts/recipes.mjs [--n=30000] [--out=docs/validation/recipes.md]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadData, args, root, runRespondent } from './lib.mjs';
import { buildRecipe } from '../src/engine/recipe.js';
import { composeStory } from '../src/render/text.js';
import { rand1 } from '../src/engine/rng.js';

const a = args();
const N = a.n ?? 30000;
const d = loadData();
const qs = d.questions.questions;
const count = (o, k) => (o[k] = (o[k] ?? 0) + 1);
const cores = {}, sups = {}, pace = {}, form = {}, voice = {}, lvl = {};
const violations = [];
const bodies = [];
const recipesKey = [];

for (let i = 0; i < N; i++) {
  const res = runRespondent(d, `rc${i}`);
  const settings = { levelCap: 1 + Math.floor(rand1('cap', i) * 3), effects: rand1('fx', i) < 0.5 };
  const recipe = buildRecipe(res, d, settings, `seed${i}`, qs);
  count(cores, recipe.core.id);
  recipe.supports.forEach((s) => count(sups, s.id));
  count(pace, recipe.pace); count(form, recipe.form); count(voice, recipe.voice); count(lvl, `${settings.levelCap}→${recipe.level}`);
  if (recipe.level > settings.levelCap) violations.push(`強度が上限を超えた i=${i}`);
  if (!settings.effects && recipe.form === 'interaction') violations.push(`演出なしなのに操作演出形式 i=${i}`);
  if (recipe.level < 2 && recipe.pace === 'sudden') violations.push(`強度1で突発型 i=${i}`);
  if ([recipe.core, ...recipe.supports].some((e) => e.minLevel > recipe.level)) violations.push(`minLevelを超える要素 i=${i}`);
  if (i < 4000) {
    const story = composeStory(recipe, d.fragments, `seed${i}`);
    const lines = story.flatMap((s) => s.lines.filter((l) => l.kind === 'body').map((l) => l.text));
    bodies.push(new Set(lines));
    recipesKey.push(`${recipe.core.id}|${recipe.supports.map((s) => s.id).join()}`);
    // 強度の上限を超える断片が混ざっていないか
    const lvOf = new Map();
    for (const th of Object.values(d.fragments.themes)) for (const list of Object.values(th)) for (const f of list) lvOf.set(f.t.replace(/\{\w+\}/g, ''), f.lv);
    for (const l of lines) if ((lvOf.get(l.replace(/午前\d+時\d+分|午後\d+時\d+分/, '')) ?? 1) > recipe.level) violations.push(`上限超えの断片 i=${i}: ${l}`);
  }
}
// 類似度: 無作為な組の本文行の重なり（Jaccard）と、同一レシピの割合
let sim = 0, high = 0, pairs = 3000, same = 0;
for (let k = 0; k < pairs; k++) {
  const x = Math.floor(rand1('px', k) * bodies.length), y = Math.floor(rand1('py', k) * bodies.length);
  if (x === y) continue;
  const inter = [...bodies[x]].filter((l) => bodies[y].has(l)).length;
  const j = inter / (bodies[x].size + bodies[y].size - inter || 1);
  sim += j; if (j > 0.5) high++;
  if (recipesKey[x] === recipesKey[y]) same++;
}
const all = d.elements.elements;
const neverCore = all.filter((e) => e.kind === 'core' && !cores[e.id]);
const neverSup = all.filter((e) => e.kind === 'support' && !sups[e.id]);
const table = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, c]) => `| ${k} | ${c} | ${((c / N) * 100).toFixed(1)}% |`).join('\n');
const maxCore = Math.max(...Object.values(cores)) / N;
const md = `# レシピ検証結果

生成: \`node scripts/recipes.mjs --n=${N}\`。回答者は擬似回答者、設定（強度の上限・演出の許可）は無作為。

## 到達性

- コア要素: ${all.filter((e) => e.kind === 'core').length - neverCore.length} / ${all.filter((e) => e.kind === 'core').length} が選ばれた。選ばれなかった要素: ${neverCore.map((e) => e.id).join(', ') || 'なし'}
- サポート要素: ${all.filter((e) => e.kind === 'support').length - neverSup.length} / ${all.filter((e) => e.kind === 'support').length} が選ばれた。選ばれなかった要素: ${neverSup.map((e) => e.id).join(', ') || 'なし'}
- 最も多く選ばれたコアのシェア: ${(maxCore * 100).toFixed(1)}%

## 類似度（文章${bodies.length}件から無作為に${pairs}組）

- 本文行の重なり（Jaccard）の平均: ${(sim / pairs).toFixed(3)}
- 重なりが0.5を超える組: ${((high / pairs) * 100).toFixed(1)}%
- コアとサポートが完全に同じ組: ${((same / pairs) * 100).toFixed(1)}%

## 設定の遵守

- 違反: ${violations.length}件${violations.length ? '\n' + violations.slice(0, 10).map((v) => '  - ' + v).join('\n') : ''}

## 強度（上限→決定された強度）

| 上限→強度 | 件数 | 割合 |
|---|---|---|
${table(lvl)}

## ペース

| ペース | 件数 | 割合 |
|---|---|---|
${table(pace)}

## 形式

| 形式 | 件数 | 割合 |
|---|---|---|
${table(form)}

## 語り口

| 語り口 | 件数 | 割合 |
|---|---|---|
${table(voice)}

## コア要素の選択回数（上位15）

| 要素 | 件数 | 割合 |
|---|---|---|
${Object.entries(cores).sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, c]) => `| ${k} | ${c} | ${((c / N) * 100).toFixed(1)}% |`).join('\n')}
`;
if (a.out) {
  mkdirSync(dirname(join(root, a.out)), { recursive: true });
  writeFileSync(join(root, a.out), md);
}
console.log(md);
const fails = [];
if (violations.length) fails.push(`設定違反${violations.length}件`);
if (neverCore.length) fails.push(`選ばれないコア要素${neverCore.length}件`);
if (maxCore > 0.12) fails.push(`コアの偏り（最大${(maxCore * 100).toFixed(1)}%）`);
if (fails.length) {
  console.error('レシピ検証: 要調整\n - ' + fails.join('\n - '));
  process.exitCode = a.strict ? 1 : 0;
}
