// 画面の遷移: 導入 → 設問 → 診断レポート → 体験（任意）→ 評価（任意）
// 回答はこの端末のブラウザ内だけで処理する。外部へは送信しない。
import { loadData } from './data.js';
import { createSession, replay } from '../engine/engine.js';
import { buildRecipe } from '../engine/recipe.js';
import { composeStory } from '../render/text.js';
import { runExperience } from './experience.js';
import { shareSection } from './share.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const STORE_KEY = 'terrif.feedback.v1';
const main = document.getElementById('main');
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'checked' || k === 'disabled') el[k] = Boolean(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) el.append(kid);
  return el;
};

const newSeed = () => {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
};

const state = {
  data: null,
  seed: params.get('seed') || newSeed(),
  settings: { levelCap: 2, audio: false, stinger: false, effects: false },
  answers: [],
  session: null,
  report: null,
  quizKeys: null,
};
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function show(screen, ...nodes) {
  if (state.quizKeys) {
    document.removeEventListener('keydown', state.quizKeys);
    state.quizKeys = null;
  }
  document.body.dataset.screen = screen;
  main.replaceChildren(...nodes);
  main.focus({ preventScroll: true });
  scrollTo(0, 0);
}

// ===== SECTION: 導入 =====
function renderIntro() {
  const s = state.settings;
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const start = h('button', { class: 'btn primary', type: 'button', disabled: true }, '調査を始める');
  consent.addEventListener('change', () => (start.disabled = !consent.checked));
  const levelDesc = h('p', { class: 'small', id: 'level-desc' });
  const descs = {
    1: '弱: 雰囲気のみ。直接的な表現も急な演出も出しません。',
    2: '中: 暗示的な不穏さまで。急な演出は出しません。',
    3: '強: 間接的な描写と、突然の演出まで。残酷な描写は含みません。',
  };
  const setDesc = () => (levelDesc.textContent = descs[s.levelCap]);
  const seg = h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': '強度の上限' },
    [1, 2, 3].map((n) => {
      const input = h('input', { type: 'radio', name: 'level', value: String(n), checked: s.levelCap === n });
      input.addEventListener('change', () => {
        s.levelCap = n;
        stinger.disabled = n < 3;
        if (n < 3) stinger.checked = s.stinger = false;
        setDesc();
      });
      return h('label', {}, input, h('span', {}, ['弱', '中', '強'][n - 1]));
    }),
  );
  const check = (id, label, small, on) => {
    const input = h('input', { type: 'checkbox', id });
    input.addEventListener('change', () => on(input.checked));
    return [h('label', { class: 'choice', for: id }, input, h('span', {}, label), small ? h('small', {}, small) : null), input];
  };
  const [audioRow] = check('audio', '音を再生する', '既定はオフです。音量には上限があり、外部の音声ファイルは使いません。', (v) => (s.audio = v));
  const [stingerRow, stinger] = check('stinger', '突発音を含める', '強度が「強」のときのみ選べます。音量上限のある短い音です。', (v) => (s.stinger = v));
  stinger.disabled = s.levelCap < 3;
  const [effectsRow] = check('effects', 'ブラウザ演出を許可する', 'タブの表示名の変更、待ち時間の演出、カーソルに遅れて付く小さな印。ページ内だけの演出で、端末の設定やファイルは操作しません。', (v) => (s.effects = v));
  setDesc();

  start.addEventListener('click', () => startQuiz());
  show(
    'intro',
    h(
      'article',
      { class: 'sheet' },
      h('header', {}, h('span', { class: 'tag' }, 'TERRIF ／ 恐怖傾向の聞き取り調査（実験版）'), h('span', { class: 'tag' }, 'No.' + state.seed.slice(0, 6))),
      h('h1', {}, '聞き取り調査'),
      h('p', {}, '質問に答えると、何がどんな形で怖さにつながりやすいかを推定し、その傾向に合わせた短い読み物（体験）を組み立てます。'),
      h(
        'div',
        { class: 'note' },
        h('strong', {}, '診断ではありません。'),
        h('span', {}, '医学的な診断やスクリーニングではなく、恐怖症の判定や助言には使えません。結果は「傾向の推定」で、当たることは保証されません。'),
      ),
      h('h2', {}, '始める前に'),
      h(
        'ul',
        {},
        h('li', {}, '質問は20〜40問です。回答はこの端末のブラウザ内だけで処理し、どこにも送信しません。'),
        h('li', {}, '体験には、暗い雰囲気の文章と映像が含まれます。選んだ強度を超える表現は出しません。'),
        h('li', {}, '閃光や点滅は使いません。音は、許可した場合のみ再生されます。'),
        h('li', {}, '体験は任意で、いつでも「中止して戻る」で止められます。気分が悪くなったときは使用をやめ、つらさが続く場合は専門機関や身近な人に相談してください。'),
      ),
      h('div', { class: 'row' }, h('div', { class: 'label' }, '強度の上限'), h('div', {}, seg, levelDesc)),
      h('div', { class: 'row' }, h('div', { class: 'label' }, '音・演出'), h('div', {}, audioRow, stingerRow, effectsRow)),
      h('div', { class: 'row' }, h('div', { class: 'label' }, '同意'), h('div', {}, h('label', { class: 'choice', for: 'consent' }, consent, h('span', {}, '上記を読み、内容を理解しました。')))),
      h('div', { class: 'actions' }, start),
    ),
  );
}

// ===== SECTION: 設問 =====
const CHOICES = [
  ['SA', 'とても当てはまる'],
  ['A', '当てはまる'],
  ['N', 'どちらでもない'],
  ['D', '当てはまらない'],
  ['SD', '全く当てはまらない'],
  ['DK', 'わからない・答えたくない'],
];

function startQuiz() {
  state.answers = [];
  state.session = createSession(state.data, state.seed);
  renderQuestion();
}

function renderQuestion() {
  const sess = state.session;
  const q = sess.next();
  if (!q) return renderReport();
  const { answered, min, max } = sess.progress;
  const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' }, Array.from({ length: max }, (_, i) => h('i', { class: (i < answered ? 'on ' : '') + (i === min - 1 ? 'min' : '') })));
  const pick = (code) => {
    state.answers.push({ id: q.id, code });
    sess.answer(q.id, code);
    renderQuestion();
  };
  const list = h(
    'ul',
    { class: 'opts', role: 'radiogroup', 'aria-labelledby': 'qtext' },
    CHOICES.map(([code, label], i) => {
      const input = h('input', { type: 'radio', name: 'ans', value: code });
      input.addEventListener('change', () => setTimeout(() => pick(code), 140));
      return h('li', { class: code === 'DK' ? 'dk' : '' }, h('label', {}, input, h('span', { class: 'n' }, String(i + 1)), h('span', {}, label)));
    }),
  );
  // 矢印キーは選択せずに移動だけし、Enter/Spaceで決定する（矢印で自動的に回答が確定しないようにする）
  list.addEventListener('keydown', (e) => {
    const inputs = [...list.querySelectorAll('input')];
    const i = inputs.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      inputs[(i + (e.key === 'ArrowDown' ? 1 : inputs.length - 1)) % inputs.length].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      inputs[i].click();
    }
  });
  const back = h('button', { class: 'btn', type: 'button', disabled: state.answers.length === 0 }, 'ひとつ戻る');
  back.addEventListener('click', () => {
    state.answers.pop();
    state.session = replay(state.data, state.seed, state.answers);
    renderQuestion();
  });
  const keys = (e) => {
    const i = Number(e.key) - 1;
    if (i >= 0 && i < CHOICES.length && !e.ctrlKey && !e.metaKey && !e.altKey) list.querySelectorAll('input')[i].click();
  };
  const debug = DEBUG ? h('pre', { class: 'debug' }, debugText(sess)) : null;
  show(
    'quiz',
    h(
      'article',
      { class: 'sheet fade-in' },
      h('header', {}, h('span', { class: 'tag' }, '聞き取り調査票'), h('span', { class: 'tag' }, `${answered} / ${min}〜${max} 問`)),
      h('div', { class: 'row' }, h('div', { class: 'label' }, h('span', { class: 'q-no' }, String(answered + 1).padStart(2, '0')), ticks), h('div', {}, h('p', { class: 'q-text', id: 'qtext' }, q.text), list)),
      h('p', { class: 'small' }, '数字キー 1〜6 でも選べます。'),
      h('div', { class: 'actions' }, back),
      debug,
    ),
  );
  state.quizKeys = keys; // show()が前の設問のリスナーを外した後に登録する
  document.addEventListener('keydown', keys);
}

function debugText(sess) {
  const r = sess.result();
  const lines = [`seed=${sess.seed} answered=${r.answered} signature=${r.signature} stable=${r.stable}`, ''];
  lines.push('上位テーマ(z/sigma): ' + r.themes.slice(0, 5).map((t) => `${t.id} ${t.z.toFixed(2)}/${t.sigma.toFixed(2)}`).join(', '));
  lines.push('上位仕組み: ' + r.mechs.slice(0, 3).map((t) => `${t.id} ${t.z.toFixed(2)}`).join(', '), '');
  for (const e of sess.log.slice(-6)) {
    lines.push(`${e.qid} [${e.code}] ${e.notes.join(' / ')}`);
    for (const [k, c] of Object.entries(e.changes)) lines.push(`    ${k}: dMu ${c.dMu.toFixed(3)} dSigma ${c.dSigma.toFixed(3)}${c.via ? ' (' + c.via + ')' : ''}${c.gate && c.gate !== 1 ? ' gate×' + c.gate.toFixed(2) : ''}`);
  }
  return lines.join('\n');
}

// ===== SECTION: 診断レポート =====
const PACE = { slow: 'じわじわ型（間を長く取る）', sudden: '突発型（静けさの後に急に変わる）', loop: '反復型（同じ場面が少しずつ変わる）' };
const FORM = { text: '文章が中心', visual: '映像が中心', interaction: '操作演出が中心' };
const LEVEL = { 1: '弱（雰囲気のみ）', 2: '中（暗示的な不穏さ）', 3: '強（間接的な描写・突然の演出まで）' };
const GATE_LABEL = {
  startle_sens: ['突然の刺激への反応が大きい', '突然の刺激への反応は小さめ'],
  imagination: ['描かれていないものを想像で補いやすい', '描かれたものをそのまま受け取りやすい'],
  uncertainty_intol: ['正体や結末が不明な状態が負担になりやすい', '不明なままでも保留しやすい'],
  control_need: ['状況を自分で操作したい気持ちが強い', '状況を預けることに抵抗が小さい'],
  isolation_sens: ['他者の気配がないことの影響が大きい', '一人でいることの影響は小さい'],
  reality_demand: ['作り物と分かるものには反応しにくい', '作り物でも没入しやすい'],
};
const certainty = (sigma) => {
  const gain = 1 - sigma;
  return gain >= 0.3 ? '確からしさ: 高め' : gain >= 0.15 ? '確からしさ: 中程度' : '確からしさ: 低め';
};

function renderReport() {
  const d = state.data;
  const result = state.session.result();
  const recipe = buildRecipe(result, d, state.settings, state.seed, d.questions.questions);
  const story = composeStory(recipe, d.fragments, state.seed);
  state.report = { result, recipe, story };

  const bars = (list, n) =>
    h('ul', { class: 'bars' }, list.slice(0, n).map((t) => h('li', {}, h('div', { class: 'head' }, h('span', {}, t.name), h('span', { class: 'mono' }, certainty(t.sigma))), h('div', { class: 'track', role: 'img', 'aria-label': `${t.name}の強さ` }, h('div', { class: 'fill', style: `width:${Math.round(sigmoid(1.2 * t.z) * 100)}%` })))));
  const traits = Object.entries(result.gates)
    .filter(([, g]) => Math.abs(g.factor - 1) >= 0.12)
    .map(([id, g]) => h('li', {}, GATE_LABEL[id][g.factor > 1 ? 0 : 1]));
  const biased = result.agreeRatio > 0.85 || result.agreeRatio < 0.08;
  const echoNote = recipe.echoes.length ? '回答の一部を、文章に引用します。' : '';

  const start = h('button', { class: 'btn primary', type: 'button' }, '体験する（任意）');
  start.addEventListener('click', () => startExperience());
  const again = h('button', { class: 'btn', type: 'button' }, '最初からやり直す');
  again.addEventListener('click', () => {
    state.seed = newSeed();
    renderIntro();
  });
  const exp = h('button', { class: 'btn', type: 'button' }, '回答と結果を書き出す');
  exp.addEventListener('click', () => download(exportData(null)));

  show(
    'report',
    h(
      'article',
      { class: 'sheet fade-in' },
      h('header', {}, h('span', { class: 'tag' }, '所見書（傾向の推定）'), h('span', { class: 'tag' }, `No.${state.seed.slice(0, 6)} ／ ${result.answered}問`)),
      h('h1', {}, '診断レポート'),
      h('div', { class: 'note' }, h('span', {}, 'これは診断ではなく、回答から推定した傾向です。実験的なもので、当たることは保証されません。')),
      biased ? h('div', { class: 'note' }, h('span', {}, `回答が「${result.agreeRatio > 0.5 ? '当てはまる' : '当てはまらない'}」側に偏っていました。推定の確からしさは低めです。`)) : null,
      h('h2', {}, '反応しやすいと推定された対象'),
      bars(result.themes, 4),
      h('h2', {}, '強く出やすいと推定された提示のされ方'),
      bars(result.mechs, 3),
      traits.length ? h('div', {}, h('h2', {}, '回答から見えた特徴'), h('ul', {}, traits)) : null,
      h('h2', {}, '体験の内容（事前の要約）'),
      h(
        'div',
        { class: 'recipe' },
        h('strong', {}, recipe.core.title),
        h('p', { class: 'small' }, recipe.core.blurb),
        h(
          'dl',
          {},
          h('dt', {}, '補強'), h('dd', {}, recipe.supports.map((s) => s.title).join('、')),
          h('dt', {}, '時間の流れ'), h('dd', {}, `安全 → 違和感 → 確信 → 侵犯 → 余韻。${PACE[recipe.pace]}`),
          h('dt', {}, '形式'), h('dd', {}, FORM[recipe.form]),
          h('dt', {}, '強度'), h('dd', {}, `${LEVEL[recipe.level]}。あなたの上限（${['弱', '中', '強'][state.settings.levelCap - 1]}）を超えません。`),
          h('dt', {}, '音・演出'), h('dd', {}, `音: ${state.settings.audio ? 'あり' : 'なし'} ／ ブラウザ演出: ${state.settings.effects ? 'あり' : 'なし'}。${echoNote}`),
        ),
      ),
      shareSection(h, state.report),
      h('p', { class: 'small' }, '体験は任意です。始めると全画面の読み物になり、画面上部の「中止して戻る」またはEscキーでいつでも止められます。閃光や点滅は使いません。不安が強いときは、体験せずにここで終えても構いません。'),
      h('div', { class: 'actions' }, start, exp, again),
      DEBUG ? h('pre', { class: 'debug' }, debugText(state.session) + '\n\n' + JSON.stringify({ recipe: { core: recipe.core.id, supports: recipe.supports.map((s) => s.id), pace: recipe.pace, form: recipe.form, voice: recipe.voice, level: recipe.level, alternatives: recipe.alternatives, scores: recipe.scores } }, null, 1)) : null,
    ),
  );
}

// ===== SECTION: 体験 =====
function startExperience() {
  const { recipe, story } = state.report;
  runExperience({
    recipe,
    story,
    settings: state.settings,
    reducedMotion: reducedMotion(),
    onEnd: ({ reason }) => renderFeedback(reason),
  });
}

// ===== SECTION: 評価データ（任意・端末内のみ） =====
function exportData(feedback) {
  const { result, recipe } = state.report;
  return {
    version: 1,
    note: 'この端末内で作成されたデータです。送信先はありません。',
    seed: state.seed,
    settings: state.settings,
    answers: result.answers,
    result: { themes: result.themes.map((t) => ({ id: t.id, z: +t.z.toFixed(3) })), mechs: result.mechs.map((t) => ({ id: t.id, z: +t.z.toFixed(3) })) },
    recipe: { core: recipe.core.id, supports: recipe.supports.map((s) => s.id), pace: recipe.pace, form: recipe.form, voice: recipe.voice, level: recipe.level, echoes: recipe.echoes.map((e) => e.qid) },
    feedback,
  };
}

function download(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `terrif-${state.seed.slice(0, 6)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}

function renderFeedback(reason) {
  const { recipe } = state.report;
  const opts = [
    ['core', `中心の要素（${recipe.core.title}）`],
    ['support0', `補強（${recipe.supports[0].title}）`],
    ['support1', `補強（${recipe.supports[1].title}）`],
    ['pace', '時間の流れ（間や展開の速さ）'],
    ['echo', '自分の回答が引用された部分'],
    ['none', '特にどれも感じなかった'],
  ];
  const strongest = h('fieldset', {}, h('legend', { class: 'label' }, '最も強く感じたもの'), opts.map(([v, label], i) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'strongest', value: v, checked: i === 0 }), h('span', {}, label))));
  const level = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '感じた強さ' }, [1, 2, 3, 4, 5].map((n) => h('label', {}, h('input', { type: 'radio', name: 'level', value: String(n), checked: n === 3 }), h('span', {}, String(n)))));
  const save = h('input', { type: 'checkbox', id: 'save' });
  const collect = () => ({
    aborted: reason === 'aborted',
    strongest: main.querySelector('input[name=strongest]:checked')?.value,
    intensity: Number(main.querySelector('input[name=level]:checked')?.value),
  });
  const exportBtn = h('button', { class: 'btn primary', type: 'button' }, '評価を含めて書き出す');
  exportBtn.addEventListener('click', () => {
    const data = exportData(collect());
    if (save.checked) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify([...readStore(), data]));
      } catch { /* 保存できない環境でも書き出しは続ける */ }
    }
    download(data);
  });
  const clear = h('button', { class: 'btn', type: 'button' }, '保存した評価を削除');
  clear.addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* 何もしない */ }
    clear.textContent = '削除しました';
    clear.disabled = true;
  });
  const back = h('button', { class: 'btn', type: 'button' }, 'レポートへ戻る');
  back.addEventListener('click', () => renderReport());
  show(
    'feedback',
    h(
      'article',
      { class: 'sheet fade-in' },
      h('header', {}, h('span', { class: 'tag' }, '事後の確認（任意）'), h('span', { class: 'tag' }, reason === 'aborted' ? '途中で中止' : '最後まで体験')),
      h('h1', {}, reason === 'aborted' ? '中止しました' : '記録は以上です'),
      h('p', {}, reason === 'aborted' ? '体験を止めました。気分が悪い場合は休んでください。続けて使う必要はありません。' : '体験はここまでです。気分が悪い場合は休んでください。つらさが続く場合は、専門機関や身近な人に相談してください。'),
      h('p', { class: 'small' }, '次の評価は任意です。推定が実際の感じ方と合っていたかを確かめるために、あなたの端末の中だけで使います。'),
      h('div', { class: 'row' }, h('div', { class: 'label' }, '評価'), h('div', {}, strongest, h('p', { class: 'small' }, '感じた強さ（1=ほとんど感じない 〜 5=とても強い）'), level)),
      h('div', { class: 'row' }, h('div', { class: 'label' }, '保存'), h('div', {}, h('label', { class: 'choice', for: 'save' }, save, h('span', {}, 'この端末のブラウザ内にも保存する'), h('small', {}, '送信はされません。いつでも下のボタンで削除できます。')))),
      h('div', { class: 'actions' }, exportBtn, back, clear),
    ),
  );
}

// ===== SECTION: 起動 =====
async function boot() {
  try {
    state.data = await loadData();
  } catch (e) {
    show('error', h('p', { class: 'note stamp' }, `データを読み込めませんでした。ページを再読み込みしてください。ファイルを直接開いている場合は、ターミナルで node scripts/serve.mjs を実行して表示されたURLを開いてください。（${e.message}）`));
    return;
  }
  renderIntro();
}
boot();
