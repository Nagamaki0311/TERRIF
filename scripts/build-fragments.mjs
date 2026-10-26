// data/src/fragments.txt から data/text_fragments.json を生成する。
// 使い方: node scripts/build-fragments.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib.mjs';

const STAGES = ['safe', 'unease', 'certainty', 'violation', 'afterglow'];
const out = {
  stages: STAGES,
  stageNames: ['安全', '違和感', '確信', '侵犯', '余韻'],
  themes: {},
  mechs: {},
  voices: {},
  echo: {},
  pace: {},
};
const lines = readFileSync(join(root, 'data/src/fragments.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'));
lines.forEach((line, i) => {
  const c = line.split('|');
  const fail = (m) => {
    throw new Error(`fragments.txt 行${i + 1}: ${m}`);
  };
  const kind = c[0];
  if (kind === 'T' || kind === 'M') {
    if (c.length !== 5) fail('列数が5ではない');
    const [, id, stage, lv, text] = c;
    if (!STAGES.includes(stage)) fail(`段階が不明: ${stage}`);
    if (![1, 2, 3].includes(Number(lv))) fail(`lvが不正: ${lv}`);
    const dst = (kind === 'T' ? out.themes : out.mechs);
    ((dst[id] ??= {})[stage] ??= []).push({ t: text, lv: Number(lv) });
  } else if (kind === 'V') {
    if (c.length !== 4) fail('列数が4ではない');
    ((out.voices[c[1]] ??= {})[c[2]] ??= []).push(c[3]);
  } else if (kind === 'E') {
    if (c.length !== 3) fail('列数が3ではない');
    (out.echo[c[1]] ??= []).push(c[2]);
  } else if (kind === 'P') {
    if (c.length !== 3) fail('列数が3ではない');
    (out.pace[c[1]] ??= []).push(c[2]);
  } else {
    fail(`種別が不明: ${kind}`);
  }
});
writeFileSync(join(root, 'data/text_fragments.json'), JSON.stringify(out, null, 1) + '\n');
const n = Object.values(out.themes).reduce((a, s) => a + Object.values(s).reduce((b, l) => b + l.length, 0), 0);
console.log(`text_fragments.json: 対象断片${n}、仕組み${Object.keys(out.mechs).length}種、語り口${Object.keys(out.voices).length}種`);
