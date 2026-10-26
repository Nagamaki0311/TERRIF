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
