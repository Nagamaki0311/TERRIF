// データ整合性の検証。失敗があれば終了コード1で終わる。
// 使い方: node scripts/validate.mjs
import { loadData } from './lib.mjs';

const d = loadData();
const errors = [];
const err = (m) => errors.push(m);

const vars = d.dimensions.variables;
const varIds = new Set(vars.map((v) => v.id));
const kindOf = Object.fromEntries(vars.map((v) => [v.id, v.kind]));

// --- 次元 ---
if (varIds.size !== vars.length) err('dimensions: 変数IDが重複している');
for (const v of vars) {
  if (!['theme', 'mech', 'gate', 'aux'].includes(v.kind)) err(`dimensions: ${v.id} のkindが不正`);
  for (const t of v.modulates ?? []) if (!varIds.has(t)) err(`dimensions: ${v.id}.modulates の ${t} が未定義`);
}
for (const [a, b, w] of d.coupling.pairs) {
  for (const x of [a, b]) if (!varIds.has(x)) err(`coupling: ${x} が未定義`);
  if (Math.abs(w) > 0.4) err(`coupling: ${a}-${b} の重み ${w} が上限0.4を超える`);
  if (['gate', 'aux'].includes(kindOf[a]) || ['gate', 'aux'].includes(kindOf[b])) err(`coupling: ${a}-${b} に調整因子/補助は使えない`);
}

// --- 設問 ---
const qs = d.questions.questions;
const qIds = new Set(qs.map((q) => q.id));
if (qIds.size !== qs.length) err('questions: IDが重複している');
const BANNED = ['怖', '恐', '不気味', '気味', '不安', 'ホラー', 'ゾッ', '戦慄', 'おびえ', '怯', 'パニック', 'トラウマ', '脅'];
const themeIds = vars.filter((v) => v.kind === 'theme').map((v) => v.id);
for (const q of qs) {
  for (const w of BANNED) if (q.text.includes(w)) err(`${q.id}: 設問文に恐怖語「${w}」`);
  if (q.text.length > 60) err(`${q.id}: 設問文が60字を超える（${q.text.length}字）`);
  if (/[？?]$/.test(q.text)) err(`${q.id}: 設問文は平叙文で書く`);
  if (!q.echo) err(`${q.id}: echoが空`);
  if (q.branch !== 'core' && !themeIds.includes(q.branch)) err(`${q.id}: branchが不正 ${q.branch}`);
  if (!Object.keys(q.loadings).length) err(`${q.id}: loadingsが空`);
  for (const [k, w] of Object.entries(q.loadings)) {
    if (!varIds.has(k)) err(`${q.id}: loadings の ${k} が未定義`);
    if (Math.abs(w) > 1) err(`${q.id}: ${k} の重み ${w} が範囲外`);
  }
  if (q.pair && !qIds.has(q.pair.with)) err(`${q.id}: pair.with が未定義`);
  for (const r of q.reinterpret ?? []) {
    if (r.if.q && !qIds.has(r.if.q)) err(`${q.id}: reinterpret の設問参照が未定義`);
    for (const k of Object.keys(r.scale)) if (!varIds.has(k)) err(`${q.id}: reinterpret.scale の ${k} が未定義`);
  }
  if (!q.meta?.intent || !q.meta?.alt) err(`${q.id}: meta(intent/alt)が不足`);
}

// --- カバレッジ（各変数を測る設問の数） ---
const count = {};
const neg = {};
for (const q of qs) {
  for (const [k, w] of Object.entries(q.loadings)) {
    count[k] = (count[k] ?? 0) + (Math.abs(w) >= 0.3 ? 1 : 0);
    if (w < 0) neg[k] = (neg[k] ?? 0) + 1;
  }
}
const need = { theme: 6, mech: 3, gate: 3, aux: 2 };
for (const v of vars) {
  if ((count[v.id] ?? 0) < need[v.kind]) err(`coverage: ${v.id}(${v.kind})を測る設問が${count[v.id] ?? 0}問で、必要数${need[v.kind]}に満たない`);
}
for (const t of themeIds) {
  if (!qs.some((q) => q.phase === 'screen' && q.loadings[t] > 0)) err(`coverage: ${t} の初期設問がない`);
  if (!qs.some((q) => q.branch === t)) err(`coverage: ${t} の詳細設問がない`);
  if (!(neg[t] > 0)) err(`coverage: ${t} に耐性側（負の重み）の設問がない`);
}

// --- 結果要素（Phase 5 以降に存在する場合） ---
if (d.elements) {
  const E = d.elements;
  const ids = new Set();
  for (const e of E.elements) {
    if (ids.has(e.id)) err(`elements: ${e.id} が重複`);
    ids.add(e.id);
    if (!['core', 'support'].includes(e.kind)) err(`elements: ${e.id} のkindが不正`);
    if (e.kind === 'core' && !(e.theme && e.mech)) err(`elements: ${e.id} はcoreなのに対象と仕組みの両方がない`);
    if (e.theme && !themeIds.includes(e.theme)) err(`elements: ${e.id} のthemeが未定義`);
    if (e.mech && !vars.some((v) => v.id === e.mech && v.kind === 'mech')) err(`elements: ${e.id} のmechが未定義`);
    if (![1, 2, 3].includes(e.minLevel)) err(`elements: ${e.id} のminLevelが不正`);
    if (!e.refs?.length) err(`elements: ${e.id} に研究参照(refs)がない（出典なしの要素）`);
  }
  const mechIds = vars.filter((v) => v.kind === 'mech').map((v) => v.id);
  for (const [kind, list, pool] of [['mech', d.synergy?.mech ?? [], mechIds], ['theme', d.synergy?.theme ?? [], themeIds]]) {
    for (const [x, y, w] of list) {
      if (!pool.includes(x) || !pool.includes(y)) err(`synergy(${kind}): ${x}-${y} が未定義`);
      if (Math.abs(w) > 1) err(`synergy(${kind}): ${x}-${y} の重みが範囲外`);
    }
  }
  for (const m of mechIds) {
    if (!E.elements.some((e) => e.kind === 'core' && e.mech === m) && !E.elements.some((e) => e.kind === 'support' && e.mech === m)) err(`elements: 仕組み${m}を使う要素がない`);
  }
  for (const t of themeIds) {
    if (!E.elements.some((e) => e.theme === t && e.kind === 'core')) err(`elements: ${t} のcore要素がない`);
  }
  if (d.fragments) {
    const F = d.fragments;
    const SLOTS = new Set(['time', 'no', 'echo', 'ans']);
    const lintText = (where, text) => {
      for (const m of text.matchAll(/\{(\w+)\}/g)) if (!SLOTS.has(m[1])) err(`fragments: ${where} に未定義のスロット {${m[1]}}`);
      if (/[\u0000-\u001f]/.test(text)) err(`fragments: ${where} に制御文字`);
    };
    for (const t of themeIds) {
      for (const s of F.stages) {
        const list = F.themes[t]?.[s] ?? [];
        if (list.length < 3) err(`fragments: ${t}/${s} の断片が${list.length}件（3件以上が必要）`);
        if (list.filter((f) => f.lv === 1).length < 2) err(`fragments: ${t}/${s} の強度1の断片が2件未満（弱設定の変化が出ない）`);
        for (const f of list) {
          if (![1, 2, 3].includes(f.lv)) err(`fragments: ${t}/${s} にlv不正`);
          lintText(`${t}/${s}`, f.t);
        }
      }
    }
    for (const m of mechIds) {
      for (const s of ['unease', 'certainty', 'violation']) {
        const list = F.mechs[m]?.[s] ?? [];
        if (list.length < 2) err(`fragments: 仕組み${m}/${s} の補助行が${list.length}件（2件以上が必要）`);
        if (!list.some((f) => f.lv === 1)) err(`fragments: 仕組み${m}/${s} に強度1の行がない`);
        for (const f of list) lintText(`${m}/${s}`, f.t);
      }
    }
    for (const v of ['record', 'second', 'kaidan']) {
      for (const k of ['open', 'close', ...F.stages]) if (!F.voices[v]?.[k]?.length) err(`fragments: 語り口${v}/${k} がない`);
    }
    for (const k of ['agree', 'disagree', 'after_agree', 'after_disagree']) if (!F.echo[k]?.length) err(`fragments: echo/${k} がない`);
    for (const k of ['slow', 'sudden', 'loop']) if (!F.pace[k]?.length) err(`fragments: pace/${k} がない`);
    for (const [k, list] of Object.entries({ ...F.echo, ...F.pace })) for (const x of list) lintText(`echo,pace/${k}`, x);
  }
}

if (errors.length) {
  console.error(`検証失敗: ${errors.length}件`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`検証OK: 変数${vars.length}、結合${d.coupling.pairs.length}、設問${qs.length}` + (d.elements ? `、要素${d.elements.elements.length}` : ''));
