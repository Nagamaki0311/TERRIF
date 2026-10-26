// 診断エンジン。変数ごとに推定値mu（対数オッズ）と不確実性sigmaを持ち、回答から更新する。
// ブラウザとNodeの両方で動く純粋なモジュール。DOM、fetch、Math.randomに依存しない。
import { rand1 } from './rng.js';

// dataから導ける不変の索引。シミュレーションで大量のセッションを作るため、dataごとに1度だけ作る
const derivedCache = new WeakMap();
function derive(data) {
  let d = derivedCache.get(data);
  if (d) return d;
  const questions = data.questions.questions ?? data.questions;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const main = new Map(
    questions.map((q) => [q.id, Object.entries(q.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0]]),
  );
  const neighbors = new Map();
  for (const [a, b, w] of data.coupling.pairs) {
    if (!w) continue;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!neighbors.has(x)) neighbors.set(x, []);
      neighbors.get(x).push([y, w]);
    }
  }
  const gatesFor = new Map();
  for (const v of data.dimensions.variables) {
    for (const t of v.modulates ?? []) {
      if (!gatesFor.has(t)) gatesFor.set(t, []);
      gatesFor.get(t).push(v.id);
    }
  }
  d = { questions, byId, main, neighbors, gatesFor };
  derivedCache.set(data, d);
  return d;
}

export const ANSWER_CODES = ['SA', 'A', 'N', 'D', 'SD', 'DK'];
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * data: { dimensions, questions, coupling } （各JSONをパースしたもの）
 * seed: 設問選択の同点崩しに使う。結果の選択は別にrecipe.jsで同じseedを使う
 */
export function createSession(data, seed) {
  const P = data.dimensions.params;
  const vars = new Map(
    data.dimensions.variables.map((v) => [v.id, { ...v, mu: 0, sigma: P.sigma0 }]),
  );
  const { questions, byId, main, neighbors, gatesFor } = derive(data);

  const answers = []; // {id, code}
  const answerOf = new Map(); // id -> code
  const flags = {};
  const unlocked = new Set();
  const signatures = [];
  const mainCounts = new Map(); // 主な測定対象ごとの回答数。同じ変数ばかり問うのを避ける
  const coverage = new Map(); // 軸Aの次元ごとに、これまでの回答で積んだ証拠の重みの合計
  const log = []; // デバッグ表示用: 各回答が動かした変数
  const themeIds = [...vars.values()].filter((v) => v.kind === 'theme').map((v) => v.id);
  const mechIds = [...vars.values()].filter((v) => v.kind === 'mech').map((v) => v.id);

  // 変数ごとの標準化。設問数や重みの違いによるmuの大きさの差を除き、次元間で順位を比べられるようにする
  const calib = data.calibration?.vars;
  const zOf = (id) => {
    const v = vars.get(id);
    const c = calib?.[id];
    return c ? (v.mu - c.mean) / Math.max(0.1, c.sd) : v.mu;
  };

  const gateFactor = (id) => {
    const g = vars.get(id);
    return clamp(1 + P.gateRange * Math.tanh(g.mu), P.gateClamp[0], P.gateClamp[1]);
  };
  const gateMultiplier = (target) =>
    (gatesFor.get(target) ?? []).reduce((m, g) => m * gateFactor(g), 1);

  const answeredCount = () => answers.filter((a) => a.code !== 'DK').length;

  /** 結果レシピの上位要素。コア（1位の次元）、サポート（2〜3位、順不同）、仕組み上位2つ（順不同）が直近の回答で変わらなければ終了できる */
  const signature = () => {
    const top = (ids, n) =>
      [...ids].sort((a, b) => zOf(b) - zOf(a) || (a < b ? -1 : 1)).slice(0, n);
    const t = top(themeIds, 3);
    return `${t[0]}|${[t[1], t[2]].sort()}|${top(mechIds, 2).sort()}`;
  };

  const condHolds = (cond) => {
    if (cond.flag !== undefined) return (flags[cond.flag] ?? null) === cond.is;
    if (cond.q !== undefined) {
      const c = answerOf.get(cond.q);
      return c !== undefined && cond.in.includes(c);
    }
    return false;
  };

  function applyEvidence(id, raw, w, a, entry) {
    const v = vars.get(id);
    if (!v) throw new Error(`未定義の変数: ${id}`);
    const gm = v.kind === 'theme' || v.kind === 'mech' ? gateMultiplier(id) : 1;
    const lr = P.learningRate * (0.6 + 0.4 * v.sigma);
    const delta = raw * lr * gm;
    const before = { mu: v.mu, sigma: v.sigma };
    v.mu = P.saturation * Math.tanh((v.mu + delta) / P.saturation);
    v.sigma = Math.max(P.sigmaMin, v.sigma * (1 - Math.abs(w) * (0.03 + 0.11 * Math.abs(a))));
    entry.changes[id] = { dMu: v.mu - before.mu, dSigma: v.sigma - before.sigma, gate: gm };
    return v.mu - before.mu;
  }

  function checkPair(q, a, entry) {
    if (!q.pair) return;
    const other = answerOf.get(q.pair.with);
    if (other === undefined || other === 'DK') return;
    const p = a * P.answerValues[other];
    const violated = q.pair.rel === 'opposite' ? p >= 0.25 : p <= -0.25;
    if (!violated) return;
    const partner = byId.get(q.pair.with);
    const ids = new Set(
      [...Object.entries(q.loadings), ...Object.entries(partner.loadings)]
        .filter(([, w]) => Math.abs(w) >= 0.3)
        .map(([k]) => k),
    );
    for (const id of ids) {
      const v = vars.get(id);
      v.sigma = Math.min(P.sigmaCap, v.sigma * P.contradictionSigma);
    }
    entry.notes.push(`矛盾: ${q.pair.with}との組が食い違い、${[...ids].join(',')}の不確実性を上げた`);
  }

  function updateUnlocked() {
    for (const id of themeIds) {
      if (zOf(id) > (calib ? P.branchUnlockZ : P.branchUnlockMu)) unlocked.add(id);
    }
  }

  function answer(qid, code) {
    const q = byId.get(qid);
    if (!q) throw new Error(`未定義の設問: ${qid}`);
    if (answerOf.has(qid)) throw new Error(`回答済みの設問: ${qid}`);
    if (!ANSWER_CODES.includes(code)) throw new Error(`回答コードが不正: ${code}`);
    answers.push({ id: qid, code });
    answerOf.set(qid, code);
    const entry = { qid, code, changes: {}, notes: [] };
    log.push(entry);
    if (code !== 'DK') {
      const a = P.answerValues[code];
      if (q.flags && a !== 0) {
        for (const [k, val] of Object.entries(q.flags[a > 0 ? 'agree' : 'disagree'] ?? {})) flags[k] = val;
      }
      const scale = {};
      for (const r of q.reinterpret ?? []) {
        if (!condHolds(r.if)) continue;
        for (const [k, f] of Object.entries(r.scale)) scale[k] = (scale[k] ?? 1) * f;
        entry.notes.push(`再解釈: ${Object.keys(r.scale).join(',')}の重みを変更`);
      }
      const m0 = main.get(qid);
      mainCounts.set(m0, (mainCounts.get(m0) ?? 0) + 1);
      const direct = {};
      for (const [id, w0] of Object.entries(q.loadings)) {
        const w = w0 * (scale[id] ?? 1);
        if (vars.get(id).kind === 'theme') coverage.set(id, (coverage.get(id) ?? 0) + Math.abs(w));
        direct[id] = applyEvidence(id, a * w, w, a, entry);
      }
      // 1ホップの伝播。直接の証拠だけを元にし、合計に上限を設ける
      const spread = {};
      for (const [id, d] of Object.entries(direct)) {
        for (const [j, c] of neighbors.get(id) ?? []) {
          if (j in direct) continue;
          spread[j] = clamp((spread[j] ?? 0) + c * d * P.coupling, -P.couplingCap, P.couplingCap);
        }
      }
      for (const [j, add] of Object.entries(spread)) {
        const v = vars.get(j);
        const before = v.mu;
        v.mu = P.saturation * Math.tanh((v.mu + add) / P.saturation);
        entry.changes[j] = { dMu: v.mu - before, dSigma: 0, via: 'coupling' };
      }
      checkPair(q, a, entry);
      updateUnlocked();
    }
    signatures.push(signature());
  }

  // 上位3次元のうち活性なものは、詳細設問を一定数聞くまで終了しない（尽きている場合は除く）。ここで不足している枝を返す
  const needDeepening = () => {
    const top = [...themeIds].sort((a, b) => zOf(b) - zOf(a) || (a < b ? -1 : 1)).slice(0, 3);
    return top.filter((t) => {
      if (!unlocked.has(t)) return false;
      const done = answers.filter((a) => byId.get(a.id).branch === t && a.code !== 'DK').length;
      return done < P.detailMin && questions.some((q) => q.branch === t && !answerOf.has(q.id));
    });
  };
  const deepened = () => needDeepening().length === 0;

  const isDone = () => {
    const n = answeredCount();
    if (n >= P.maxQuestions || answers.length >= P.maxQuestions + 20) return true;
    if (n >= P.minQuestions && signatures.length >= P.stableWindow && deepened()) {
      const last = signatures.slice(-P.stableWindow);
      if (last.every((s) => s === last[0])) return true;
    }
    return false;
  };

  // 同点崩しの揺らぎ。設問ごとの基準値をセッション内で1度だけ作り、回答数で位相をずらす（決定的で安価）
  const jitterBase = new Map();
  const jitter = (q) => {
    let r = jitterBase.get(q.id);
    if (r === undefined) jitterBase.set(q.id, (r = rand1(seed, q.id)));
    return (r * 997 + answers.length * 0.6180339887) % 1;
  };

  function score(q, rankOf, prev) {
    // 最も情報が多い変数を主とし、残りは割り引く。複数の変数に載る設問が単純な合計で有利にならないようにする
    let best = 0;
    let rest = 0;
    for (const id in q.loadings) {
      const v = vars.get(id);
      let pri = 1;
      if (v.kind === 'theme') pri = 1 + 1.2 * (1 - rankOf.get(id) / (themeIds.length - 1));
      else if (v.kind === 'mech') pri = P.mechPriority;
      else if (id === 'tolerance') pri = 1.3;
      const term = Math.abs(q.loadings[id]) * (v.sigma - P.sigmaMin + 0.1) * pri;
      if (term > best) {
        rest += best;
        best = term;
      } else {
        rest += term;
      }
    }
    let s = best + P.secondaryWeight * rest;
    if (prev) {
      let overlap = 0;
      for (const t of q.tags) if (prev.tags.includes(t)) overlap++;
      s *= Math.max(0.6, 1 - 0.15 * overlap);
      if (main.get(q.id) === main.get(prev.id)) s *= 0.6;
    }
    s /= 1 + P.repeatPenalty * (mainCounts.get(main.get(q.id)) ?? 0);
    return s * (1 + P.jitter * jitter(q));
  }

  function next() {
    if (isDone()) return null;
    const open = questions.filter((q) => !answerOf.has(q.id));
    if (P.profileSlots.includes(answers.length)) {
      const prof = open.find((q) => q.phase === 'profile');
      if (prof) return prof;
    }
    // 初期の広域設問: すべての次元に最低限の証拠が付くまで、証拠が最も少ない次元の設問を出す
    if (answeredCount() < P.screenMax) {
      const bare = themeIds
        .filter((t) => (coverage.get(t) ?? 0) < P.screenCoverage)
        .sort((x, y) => (coverage.get(x) ?? 0) - (coverage.get(y) ?? 0) || jitter({ id: x }) - jitter({ id: y }));
      for (const t of bare) {
        const cand = open
          .filter((q) => q.phase === 'screen' && q.loadings[t] !== undefined)
          .sort((x, y) => Math.abs(y.loadings[t]) * (1 + P.jitter * jitter(y)) - Math.abs(x.loadings[t]) * (1 + P.jitter * jitter(x)));
        if (cand.length) return cand[0];
      }
    }
    // 詳細設問が足りない間は、1問おきに上位次元の詳細設問へ寄せる（残りの回は仕組み・調整因子の設問に使う）
    const need = needDeepening();
    if (need.length && answers.length % 2 === 0) {
      const detail = open.filter((q) => need.includes(q.branch));
      if (detail.length) return pickFrom(detail);
    }
    const eligible = open.filter(
      (q) => q.phase !== 'profile' && (q.branch === 'core' || unlocked.has(q.branch)),
    );
    const pool = eligible.length ? eligible : open.filter((q) => q.phase !== 'profile');
    if (!pool.length) return null;
    return pickFrom(pool);
  }

  // 上位候補から、スコアの2乗に比例して抽選する。同じ回答なら同じ設問になる（seedと回答数だけに依存）
  function pickFrom(pool) {
    const byZ = [...themeIds].sort((x, y) => zOf(y) - zOf(x) || (x < y ? -1 : 1));
    const rankOf = new Map(byZ.map((id, i) => [id, i]));
    const prev = answers.length ? byId.get(answers[answers.length - 1].id) : null;
    const top = pool
      .map((q) => [q, score(q, rankOf, prev)])
      .sort((x, y) => y[1] - x[1] || (x[0].id < y[0].id ? -1 : 1))
      .slice(0, P.pickTop);
    let r = rand1(seed, 'pick', answers.length) * top.reduce((acc, [, sc]) => acc + sc * sc, 0);
    for (const [q, sc] of top) {
      r -= sc * sc;
      if (r <= 0) return q;
    }
    return top[top.length - 1][0];
  }

  function result() {
    const pack = (ids) =>
      ids
        .map((id) => {
          const v = vars.get(id);
          return { id, name: v.name, mu: v.mu, z: zOf(id), sigma: v.sigma, p: sigmoid(v.mu) };
        })
        .sort((a, b) => b.z - a.z || (a.id < b.id ? -1 : 1));
    const gateIds = [...vars.values()].filter((v) => v.kind === 'gate').map((v) => v.id);
    const auxIds = [...vars.values()].filter((v) => v.kind === 'aux').map((v) => v.id);
    return {
      themes: pack(themeIds),
      mechs: pack(mechIds),
      gates: Object.fromEntries(gateIds.map((id) => [id, { mu: vars.get(id).mu, sigma: vars.get(id).sigma, factor: gateFactor(id) }])),
      aux: Object.fromEntries(auxIds.map((id) => [id, { mu: vars.get(id).mu, sigma: vars.get(id).sigma }])),
      flags: { ...flags },
      answers: answers.map((a) => ({ ...a })),
      answered: answeredCount(),
      // 「当てはまる」側に偏った回答は推定の信頼度を下げる。UIで注意書きに使う
      agreeRatio: answeredCount() ? answers.filter((a) => a.code === 'A' || a.code === 'SA').length / answeredCount() : 0,
      signature: signature(),
      stable: signatures.length >= P.stableWindow && signatures.slice(-P.stableWindow).every((s) => s === signatures[signatures.length - 1]),
    };
  }

  return {
    seed,
    next,
    answer,
    isDone,
    result,
    get log() { return log; },
    get answers() { return answers; },
    get progress() { return { answered: answeredCount(), min: P.minQuestions, max: P.maxQuestions }; },
    question: (id) => byId.get(id),
  };
}

/** 回答列から同じ状態を再現する（「戻る」と決定性の検証で使う） */
export function replay(data, seed, answers) {
  const s = createSession(data, seed);
  for (const a of answers) s.answer(a.id, a.code);
  return s;
}
