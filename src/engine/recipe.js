// 結果レシピ（Fear Recipe）の選択。診断結果と設定から、コア・サポート・ペース・形式・語り口・エコーを決める。
// 同じ入力と同じseedなら同じレシピになる。DOMには依存しない。
import { makeRng, weightedPick } from './rng.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// 仕組みごとのペースの傾向。サポート要素（仕組みのみ）のペース親和に使う
const PACE_OF_MECH = {
  anticipation: 'slow', ambiguity: 'slow', control_loss: 'slow', explicitness: 'slow', disgust: 'slow',
  startle: 'sudden', time_pressure: 'sudden',
  norm_violation: 'loop', cognitive_unreliability: 'loop', safe_zone_intrusion: 'slow', self_reference: 'slow', authenticity: 'slow',
};
const VISUAL_THEMES = new Set(['gaze_surveillance', 'humanoid_face', 'dark_enclosed', 'depth_vastness', 'contamination_decay', 'bugs_animals', 'everyday_estrangement']);
const INTERACTION_MECHS = new Set(['safe_zone_intrusion', 'time_pressure', 'self_reference', 'control_loss']);

/** 刺激耐性から強度を決める。情報が足りないときは最も弱い強度にする。ユーザーの上限を超えない */
export function decideLevel(result, cap) {
  const tol = result.aux.tolerance;
  const known = tol.sigma < 0.95; // 刺激耐性の設問に最低限答えていない場合は最も弱い強度にする
  const score = tol.mu + 0.25 * result.aux.sensation_seeking.mu; // 刺激希求と恐怖の関連は研究で一貫しない(S10, S25)ため重みを下げた
  // 閾値は擬似回答者の分布の約33%・67%点（simulate/recipes で再確認する。docs/calibration.md）
  const byTolerance = !known ? 1 : score > 0.5 ? 3 : score > -0.4 ? 2 : 1;
  return Math.min(cap, byTolerance);
}

/**
 * result: engine.result()
 * data: { elements, synergy, dimensions }
 * settings: { levelCap: 1|2|3, effects: boolean }
 */
export function buildRecipe(result, data, settings, seed, questions) {
  const rng = makeRng(seed, 'recipe');
  const level = decideLevel(result, settings.levelCap);
  const themeP = Object.fromEntries(result.themes.map((t) => [t.id, sigmoid(1.2 * t.z)]));
  const mechP = Object.fromEntries(result.mechs.map((m) => [m.id, sigmoid(1.2 * m.z)]));
  const gateOf = {};
  for (const v of data.dimensions.variables) for (const t of v.modulates ?? []) (gateOf[t] ??= []).push(v.id);
  const gateBoost = (mech) => Math.sqrt((gateOf[mech] ?? []).reduce((acc, g) => acc * result.gates[g].factor, 1));

  const syn = new Map();
  for (const [a, b, w] of data.synergy.mech) syn.set(`m:${key(a, b)}`, w);
  for (const [a, b, w] of data.synergy.theme) syn.set(`t:${key(a, b)}`, w);
  const pairScore = (x, y) => {
    let s = 0;
    if (x.mech && y.mech) s += x.mech === y.mech ? -0.35 : (syn.get(`m:${key(x.mech, y.mech)}`) ?? 0);
    if (x.theme && y.theme) s += x.theme === y.theme ? -0.5 : (syn.get(`t:${key(x.theme, y.theme)}`) ?? 0);
    return s;
  };

  const affinity = (e) => {
    const pT = e.theme ? themeP[e.theme] : null;
    const pM = e.mech ? Math.min(1, mechP[e.mech] * gateBoost(e.mech)) : null;
    const a = pT !== null && pM !== null ? Math.sqrt(pT * pM) : (pT ?? pM);
    return a * (0.85 + 0.2 * e.evidence); // 根拠が弱い要素は重みをわずかに下げる
  };

  const usable = data.elements.elements.filter((e) => e.minLevel <= level);
  const cores = usable.filter((e) => e.kind === 'core').map((e) => ({ e, a: affinity(e) })).sort((x, y) => y.a - x.a).slice(0, 8);
  const mechSup = usable.filter((e) => e.kind === 'support' && e.mech).map((e) => ({ e, a: affinity(e) }));
  const themeSup = usable.filter((e) => e.kind === 'support' && e.theme).map((e) => ({ e, a: affinity(e) }));

  // 上位のコアに、仕組みのサポートと対象のサポートを1つずつ足した全組合せを評価する（別軸の要素を必ず含める）
  const combos = [];
  for (const c of cores) {
    for (const m of mechSup) {
      if (m.e.mech === c.e.mech) continue;
      for (const t of themeSup) {
        if (t.e.theme === c.e.theme) continue;
        const score =
          c.a + 0.6 * (m.a + t.a) + 0.5 * (pairScore(c.e, m.e) + pairScore(c.e, t.e) + pairScore(m.e, t.e));
        combos.push({ core: c.e, supports: [m.e, t.e], score });
      }
    }
  }
  combos.sort((x, y) => y.score - x.score || (x.core.id + x.supports[0].id + x.supports[1].id < y.core.id + y.supports[0].id + y.supports[1].id ? -1 : 1));
  const top = combos.slice(0, 3);
  const best = top[0].score;
  const chosen = weightedPick(top, top.map((c) => Math.exp(4 * (c.score - best))), rng);

  const picked = [chosen.core, ...chosen.supports];
  const paceScore = { slow: 0, sudden: 0, loop: 0 };
  paceScore.slow += chosen.core.pace.slow;
  paceScore.sudden += chosen.core.pace.sudden;
  paceScore.loop += chosen.core.pace.loop;
  for (const s of chosen.supports) if (s.mech) paceScore[PACE_OF_MECH[s.mech]] += 1;
  paceScore.sudden += 1.5 * (result.gates.startle_sens.factor - 1);
  paceScore.slow += 1.5 * (result.gates.imagination.factor - 1) + 1.5 * (result.gates.uncertainty_intol.factor - 1);
  if (level < 2) paceScore.sudden = -Infinity; // 突発型は強度2以上のみ
  const paces = Object.keys(paceScore);
  const paceW = paces.map((p) => (paceScore[p] === -Infinity ? 0 : Math.exp(0.8 * paceScore[p])));
  const pace = weightedPick(paces, paceW, rng);

  const formScore = { text: 1, visual: 0, interaction: 0 };
  for (const e of picked) {
    if (e.media?.includes('visual')) formScore.visual += 1;
    if (e.media?.includes('interaction')) formScore.interaction += 1;
    if (e.theme && VISUAL_THEMES.has(e.theme)) formScore.visual += 0.5;
    if (e.mech && INTERACTION_MECHS.has(e.mech)) formScore.interaction += 0.5;
  }
  formScore.text += 0.5 * (result.gates.imagination.factor - 1) * 3;
  if (!settings.effects) formScore.interaction = -Infinity;
  const forms = Object.keys(formScore);
  const form = forms.reduce((a, b) => (formScore[b] > formScore[a] ? b : a));

  const voiceScore = {
    record: mechP.authenticity * result.gates.reality_demand.factor + (chosen.core.mech === 'authenticity' ? 0.6 : 0),
    second: mechP.self_reference + (chosen.core.mech === 'self_reference' ? 0.6 : 0),
    kaidan: 0.55,
  };
  const voices = Object.keys(voiceScore);
  const voice = weightedPick(voices, voices.map((v) => Math.exp(5 * voiceScore[v])), rng);

  return {
    seed: String(seed),
    level,
    core: chosen.core,
    supports: chosen.supports,
    pace,
    form,
    voice,
    echoes: pickEchoes(result, questions, chosen, data),
    alternatives: top.map((c) => ({ core: c.core.id, supports: c.supports.map((s) => s.id), score: +c.score.toFixed(3) })),
    scores: { pace: paceScore, form: formScore, voice: voiceScore },
  };
}

/** 回答のエコー。コアの対象・仕組みに強く関わる回答を1〜2件選ぶ。当てはまる側を優先し、無ければ反対側も使う */
function pickEchoes(result, questions, chosen, data) {
  const values = data.dimensions.params.answerValues;
  const targets = [chosen.core.theme, chosen.core.mech, ...chosen.supports.map((s) => s.theme ?? s.mech)];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const cands = result.answers
    .filter((a) => a.code !== 'DK' && a.code !== 'N')
    .map((a) => {
      const q = byId.get(a.id);
      const w = targets.reduce((acc, t, i) => acc + Math.abs(q.loadings[t] ?? 0) * (i === 0 ? 1.5 : i === 1 ? 1.2 : 0.8), 0);
      return { q, code: a.code, w: w * Math.abs(values[a.code]) * (values[a.code] > 0 ? 1.15 : 1) };
    })
    .filter((c) => c.w > 0.25)
    .sort((x, y) => y.w - x.w || (x.q.id < y.q.id ? -1 : 1));
  return cands.slice(0, 2).map((c) => ({ qid: c.q.id, echo: c.q.echo, code: c.code, agree: values[c.code] > 0 }));
}
