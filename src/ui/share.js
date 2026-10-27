// 結果の共有。共有するのは「対象・提示のされ方・体験の題名」の名前だけで、回答・引用・seedは含めない。
// 送信は利用者が押したときだけ行う（Web Share、Xの投稿画面を開く、画像の保存、文面のコピー）。
import { createVisual } from '../render/visual.js';

const W = 1200;
const H = 630;
const SERIF = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Noto Serif CJK JP",serif';
const MONO = 'ui-monospace,Menlo,Consolas,"Noto Sans Mono CJK JP",monospace';

export function shareText({ result, recipe }) {
  const t = result.themes[0].name;
  const m = result.mechs[0].name;
  return `TERRIFの聞き取り調査で、「${recipe.core.title}」の傾向と推定されました。\n反応しやすい対象: ${t}／強く出やすい提示: ${m}\n（診断ではなく、実験的な傾向の推定です）\n#TERRIF`;
}

/** 共有用の画像（1200x630）。背景は結果の対象から手続き生成した映像 */
export function makeCard({ result, recipe }) {
  const canvas = document.createElement('canvas');
  const v = createVisual(canvas, { reducedMotion: true, fixedSize: [W, H] });
  v.setScene({ theme: recipe.core.theme, seed: recipe.seed, level: 1 });
  v.drawAt(1.6);
  const g = canvas.getContext('2d');
  const fade = g.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(18,17,15,.94)');
  fade.addColorStop(0.62, 'rgba(18,17,15,.8)');
  fade.addColorStop(1, 'rgba(18,17,15,.25)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#b9b5a8';
  g.font = `26px ${MONO}`;
  g.fillText('TERRIF ／ 聞き取り調査', 64, 84);
  g.fillStyle = '#e6e2d6';
  g.font = `600 64px ${SERIF}`;
  wrap(g, recipe.core.title, 64, 220, 660, 84);
  g.font = `30px ${SERIF}`;
  g.fillStyle = '#c9c5b8';
  g.fillText(`反応しやすい対象　${result.themes[0].name}`, 64, 440);
  g.fillText(`強く出やすい提示　${result.mechs[0].name}`, 64, 490);
  g.fillStyle = '#e08a7a';
  g.fillRect(64, 530, 56, 3);
  g.fillStyle = '#b9b5a8';
  g.font = `22px ${MONO}`;
  g.fillText('診断ではなく、実験的な傾向の推定です', 64, 575);
  return canvas;
}

function wrap(g, text, x, y, maxW, lh) {
  let line = '';
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW) {
      g.fillText(line, x, y);
      y += lh;
      line = ch;
    } else {
      line += ch;
    }
  }
  g.fillText(line, x, y);
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));

/** 共有欄のDOMを作る。h は app.js のDOM生成関数 */
export function shareSection(h, report) {
  const text = shareText(report);
  const canvas = makeCard(report);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `共有用の画像: ${report.recipe.core.title}`);
  canvas.style.cssText = 'width:100%;height:auto;display:block;border:1px solid var(--rule)';
  const status = h('p', { class: 'small', role: 'status' }, '');
  const say = (m) => (status.textContent = m);
  const file = async () => new File([await toBlob(canvas)], 'terrif.png', { type: 'image/png' });
  const btn = (label, fn, cls = 'btn') => {
    const b = h('button', { class: cls, type: 'button' }, label);
    b.addEventListener('click', () => fn().catch(() => say('この操作は完了しませんでした。画像の保存と文面のコピーをお試しください。')));
    return b;
  };
  const save = btn('画像を保存', async () => {
    const a = h('a', { href: URL.createObjectURL(await toBlob(canvas)), download: 'terrif.png' });
    document.body.append(a);
    a.click();
    a.remove();
    say('画像を保存しました。');
  });
  const copy = btn('文面をコピー', async () => {
    await navigator.clipboard.writeText(text);
    say('文面をコピーしました。');
  });
  const x = btn('Xの投稿画面を開く', async () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    say('文面のみを渡します。画像は保存して添付してください。');
  });
  const buttons = [save, copy, x];
  if (navigator.canShare && navigator.share) {
    buttons.unshift(
      btn('共有する', async () => {
        const f = await file();
        if (navigator.canShare({ files: [f] })) await navigator.share({ text, files: [f] });
        else await navigator.share({ text });
      }, 'btn primary'),
    );
  }
  return h(
    'div',
    {},
    h('h2', {}, '結果を共有する'),
    h('p', { class: 'small' }, '共有されるのは、下の画像と文面だけです。回答の内容や引用は含まれません。ボタンを押すまで何も送られません。'),
    canvas,
    h('p', { class: 'small', style: 'white-space:pre-wrap' }, text),
    h('div', { class: 'actions' }, buttons),
    status,
  );
}
