// 検証スクリプト共通: データ読み込み。ブラウザ側のsrc/ui/data.jsと同じファイル群を読む。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const optional = (p) => (existsSync(join(root, p)) ? read(p) : null);

export function loadData() {
  return {
    dimensions: read('data/dimensions.json'),
    questions: read('data/questions.json'),
    coupling: read('data/coupling_matrix.json'),
    calibration: optional('data/calibration.json'),
    elements: optional('data/elements.json'),
    synergy: optional('data/synergy_matrix.json'),
    fragments: optional('data/text_fragments.json'),
  };
}

/** 簡易な引数解析: --key=value / --flag */
export function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : isNaN(Number(m[2])) ? m[2] : Number(m[2]);
  }
  return out;
}

// ---- 擬似回答者（recipes.mjs / safety.mjs 共通） ----
import { createSession } from '../src/engine/engine.js';
import { rand1 } from '../src/engine/rng.js';

const normalAt = (...p) => Math.sqrt(-2 * Math.log(1 - rand1(...p, 'u'))) * Math.cos(2 * Math.PI * rand1(...p, 'v'));

/** whoごとに決まる潜在プロファイルから回答させ、診断結果を返す */
export function runRespondent(d, who) {
  const t = Object.fromEntries(d.dimensions.variables.map((v) => [v.id, normalAt(who, v.id) * 0.9]));
  const s = createSession(d, `r-${who}`);
  for (let q = s.next(); q; q = s.next()) {
    if (rand1(who, q.id, 'dk') < 0.03) {
      s.answer(q.id, 'DK');
      continue;
    }
    let z = 0;
    for (const [id, w] of Object.entries(q.loadings)) z += w * t[id];
    const sc = z * 1.1 + normalAt(who, q.id) * 0.45;
    s.answer(q.id, sc > 0.75 ? 'SA' : sc > 0.25 ? 'A' : sc > -0.25 ? 'N' : sc > -0.75 ? 'D' : 'SD');
  }
  return s.result();
}
