// data/src/elements.txt と研究データから data/elements.json を生成する。
// 使い方: node scripts/build-elements.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib.mjs';

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const dims = read('data/dimensions.json').variables;
const techniques = read('data/research/techniques.json').techniques;
const fearObjects = read('data/research/fear_objects.json').fear_objects;
const byId = Object.fromEntries(dims.map((v) => [v.id, v]));
const MEDIA = { t: 'text', v: 'visual', i: 'interaction' };
// 強度が高いほど内容の具体性が上がる仕組みは、弱い設定では使わない
const MIN_LEVEL_MECH = { startle: 2, explicitness: 2, disgust: 2 };

const techRefs = (mechResearch) =>
  techniques.filter((t) => t.status !== '採用しない' && t.mechanisms.includes(mechResearch)).map((t) => t.id);

const lines = readFileSync(join(root, 'data/src/elements.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'));

const elements = [];
lines.forEach((line, i) => {
  const c = line.split('|');
  if (c.length !== 7) throw new Error(`elements.txt 行${i + 1}: 列数が${c.length}（7が必要）`);
  const [theme, mech, title, blurb, minLevel, pace, media] = c;
  if (byId[theme]?.kind !== 'theme') throw new Error(`elements.txt 行${i + 1}: 対象が不明 ${theme}`);
  if (byId[mech]?.kind !== 'mech') throw new Error(`elements.txt 行${i + 1}: 仕組みが不明 ${mech}`);
  const [slow, sudden, loop] = pace.split(',').map(Number);
  elements.push({
    id: `core.${theme}.${mech}`,
    kind: 'core',
    theme,
    mech,
    title,
    blurb,
    minLevel: Math.max(Number(minLevel), MIN_LEVEL_MECH[mech] ?? 1),
    pace: { slow, sudden, loop },
    media: media.split(',').map((m) => MEDIA[m]),
    refs: [byId[mech].research, ...techRefs(byId[mech].research)],
  });
});

for (const v of dims.filter((x) => x.kind === 'mech')) {
  elements.push({
    id: `sup.m.${v.id}`,
    kind: 'support',
    theme: null,
    mech: v.id,
    title: `${v.name}の補強`,
    blurb: v.desc,
    minLevel: MIN_LEVEL_MECH[v.id] ?? 1,
    refs: [v.research, ...techRefs(v.research)],
  });
}
for (const v of dims.filter((x) => x.kind === 'theme')) {
  elements.push({
    id: `sup.t.${v.id}`,
    kind: 'support',
    theme: v.id,
    mech: null,
    title: `${v.name}の気配`,
    blurb: v.desc,
    minLevel: 1,
    refs: fearObjects.filter((f) => f.axis_a === v.id).map((f) => f.id),
  });
}

writeFileSync(
  join(root, 'data/elements.json'),
  JSON.stringify({ paces: ['slow', 'sudden', 'loop'], forms: ['text', 'visual', 'interaction'], elements }, null, 1) + '\n',
);
console.log(`elements.json: コア${elements.filter((e) => e.kind === 'core').length}、サポート${elements.filter((e) => e.kind === 'support').length}`);
