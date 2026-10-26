// 体験の再生。段階ごとに文章・映像・音・操作演出を進める。
// 「中止して戻る」は常に表示し、押下または Esc で即座に停止する。
import { createVisual } from '../render/visual.js';
import { createAudio } from '../render/audio.js';

const TAB_TITLES = ['TERRIF 聞き取り調査', 'TERRIF 記録中', '（まだ聞こえますか）', '（戻ってください）', 'TERRIF 聞き取り調査'];

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) el.append(kid);
  return el;
};

/**
 * opts: { recipe, story, settings, reducedMotion, onEnd({reason:'finished'|'aborted'}) }
 * 戻り値: { stop() }
 */
export function runExperience({ recipe, story, settings, reducedMotion, onEnd }) {
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const stageLabel = h('span', { class: 'stage' }, '');
  const pauseBtn = h('button', { class: 'btn', type: 'button' }, '一時停止');
  const stopBtn = h('button', { class: 'btn stop', type: 'button' }, '中止して戻る');
  const inner = h('div', { class: 'inner', 'aria-live': 'polite' });
  const textBox = h('div', { class: 'exp-text' }, inner);
  const root = h(
    'div',
    { class: 'exp', role: 'dialog', 'aria-modal': 'true', 'aria-label': '体験' },
    canvas,
    h('div', { class: 'exp-bar' }, stopBtn, stageLabel, pauseBtn),
    textBox,
  );
  document.body.append(root);
  const opener = document.activeElement;
  stopBtn.focus();

  const visual = createVisual(canvas, { reducedMotion });
  visual.setScene({ theme: recipe.core.theme, seed: recipe.seed, level: recipe.level });
  visual.drawAt(0);
  visual.start();

  let audio = null;
  if (settings.audio) {
    audio = createAudio({ stinger: settings.stinger && recipe.level >= 3, seed: recipe.seed });
    audio?.start().catch(() => {});
  }
  const originalTitle = document.title;
  let trail = null;
  const onMove = (e) => {
    if (trail) trail.style.transform = `translate(${e.clientX + 18}px, ${e.clientY + 18}px)`;
  };

  let paused = false;
  let cancelled = false;
  const timers = new Set();
  const wait = (ms) =>
    new Promise((resolve, reject) => {
      const tick = (left) => {
        if (cancelled) return reject(new Error('cancelled'));
        if (paused) {
          const id = setTimeout(() => { timers.delete(id); tick(left); }, 150);
          timers.add(id);
          return;
        }
        if (left <= 0) return resolve();
        const step = Math.min(left, 150);
        const id = setTimeout(() => { timers.delete(id); tick(left - step); }, step);
        timers.add(id);
      };
      tick(ms);
    });

  function finish(reason) {
    if (cancelled) return;
    cancelled = true;
    timers.forEach(clearTimeout);
    visual.stop();
    audio?.stop();
    document.title = originalTitle;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointermove', onMove);
    trail?.remove();
    root.remove();
    opener?.focus?.();
    onEnd({ reason });
  }
  const onKey = (e) => {
    if (e.key === 'Escape') finish('aborted');
  };
  document.addEventListener('keydown', onKey);
  stopBtn.addEventListener('click', () => finish('aborted'));
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '再開' : '一時停止';
    pauseBtn.setAttribute('aria-pressed', String(paused));
  });

  const addLine = (line) => {
    for (const old of inner.querySelectorAll('.ln.show:not(.old)')) old.classList.add('old');
    const el = h('p', { class: `ln ${line.kind}` }, line.text);
    inner.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    textBox.scrollTo({ top: textBox.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    return el;
  };

  const enterStage = (i, name) => {
    stageLabel.textContent = `${i + 1} / 5　${name}`;
    visual.setStage(i);
    audio?.setStage(i);
    if (settings.effects) {
      document.title = TAB_TITLES[i];
      if (i >= 2 && !trail && recipe.form !== 'text') {
        trail = h('div', { class: 'trail', 'aria-hidden': 'true' });
        document.body.append(trail);
        document.addEventListener('pointermove', onMove);
      }
    }
  };

  const endPanel = () => {
    const done = h('button', { class: 'btn primary', type: 'button' }, '戻る');
    done.addEventListener('click', () => finish('finished'));
    inner.append(h('p', { class: 'ln frame show' }, '— 記録はここまで —'), done);
    textBox.scrollTo({ top: textBox.scrollHeight });
    done.focus();
    pauseBtn.disabled = true;
  };

  async function runTimed() {
    for (let i = 0; i < story.length; i++) {
      const st = story[i];
      enterStage(i, st.name);
      if (i === 2 && recipe.level >= 2) audio?.event('thump');
      if (i === 3) {
        if (audio && recipe.pace !== 'loop') audio.event('silence', 2.4);
        if (settings.effects && recipe.pace === 'slow') {
          // 擬似ロード: 何も起きない間を作る演出。実際の読み込みではない（開始前の説明に記載している）
          const load = h('p', { class: 'ln load show' }, '記録を読み込んでいます…', h('i'));
          inner.append(load);
          requestAnimationFrame(() => load.classList.add('go'));
          await wait(2600);
          load.remove();
        }
      }
      await wait(i === 0 ? 600 : 1400);
      for (const line of st.lines) {
        await wait(line.delay);
        addLine(line);
        if (i === 3 && line.kind === 'pace' && recipe.pace === 'sudden') {
          await wait(600);
          audio?.event('stinger');
        }
      }
    }
    await wait(1500);
    endPanel();
  }

  // 動きを減らす設定: 自動進行せず、段階ごとに静止表示して利用者が進める
  function runStatic() {
    pauseBtn.classList.add('hidden');
    let i = 0;
    const show = () => {
      inner.replaceChildren();
      const st = story[i];
      enterStage(i, st.name);
      visual.drawAt(i);
      for (const line of st.lines) addLine(line);
      const last = i === story.length - 1;
      const next = h('button', { class: 'btn primary', type: 'button' }, last ? '戻る' : '次へ');
      next.addEventListener('click', () => (last ? finish('finished') : (i++, show())));
      inner.append(next);
      next.focus();
    };
    show();
  }

  if (reducedMotion) runStatic();
  else runTimed().catch(() => {});

  return { stop: () => finish('aborted') };
}
