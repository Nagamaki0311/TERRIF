// 決定性の検証: 同一回答＋同一seedなら、出題順・結果とも一致すること。回答列の再生で同じ状態に戻ること。
// 使い方: node scripts/determinism.mjs [--n=3000]
import { loadData, args } from './lib.mjs';
import { createSession, replay } from '../src/engine/engine.js';
import { rand1 } from '../src/engine/rng.js';

const N = args().n ?? 3000;
const d = loadData();
const CODES = ['SA', 'A', 'N', 'D', 'SD', 'DK'];
const pickCode = (who, qid) => CODES[Math.floor(rand1(who, qid) * CODES.length)];

function run(seed, who) {
  const s = createSession(d, seed);
  const seq = [];
  for (let q = s.next(); q; q = s.next()) {
    seq.push(q.id);
    s.answer(q.id, pickCode(who, q.id));
  }
  return { s, seq };
}

let bad = 0;
let differentSeedDiffers = 0;
for (let i = 0; i < N; i++) {
  const a = run(`seed-${i}`, `who-${i}`);
  const b = run(`seed-${i}`, `who-${i}`);
  const sameSeq = a.seq.join() === b.seq.join();
  const ra = a.s.result();
  const rb = b.s.result();
  const sameResult = JSON.stringify(ra) === JSON.stringify(rb);
  // 回答列の再生
  const rep = replay(d, `seed-${i}`, ra.answers);
  const sameReplay = JSON.stringify(rep.result()) === JSON.stringify(ra);
  // 途中までの再生（戻る操作）の次の設問が、元の出題順と一致する
  const k = Math.floor(a.seq.length / 2);
  const back = replay(d, `seed-${i}`, ra.answers.slice(0, k));
  const sameBack = back.next()?.id === a.seq[k];
  if (!(sameSeq && sameResult && sameReplay && sameBack)) {
    bad++;
    if (bad <= 3) console.error(`不一致 i=${i}: seq=${sameSeq} result=${sameResult} replay=${sameReplay} back=${sameBack}`);
  }
  const c = run(`other-${i}`, `who-${i}`);
  if (c.seq.join() !== a.seq.join()) differentSeedDiffers++;
}
console.log(`決定性: ${N}件中 不一致${bad}件。seedを変えると出題が変わった割合 ${((differentSeedDiffers / N) * 100).toFixed(1)}%`);
if (bad) process.exit(1);
