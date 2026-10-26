// 安全性の検証（指示書第8.1・9章）。閃光・音量・強度・内容・外部通信・中止手段を静的に確認する。
// 使い方: node scripts/safety.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, root } from './lib.mjs';
import { SAFETY, TINT, LIGHT } from '../src/render/visual.js';
import { AUDIO_SAFETY } from '../src/render/audio.js';

const errors = [];
const check = (ok, msg) => !ok && errors.push(msg);
const read = (p) => readFileSync(join(root, p), 'utf8');
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const srcFiles = walk('src').filter((f) => f.endsWith('.js') || f.endsWith('.css'));
const jsFiles = srcFiles.filter((f) => f.endsWith('.js'));

// --- 閃光（WCAG 2.3.1: 1秒に3回を超える閃光を避ける。本サイトはそれより厳しく2回以下） ---
check(SAFETY.maxFlashesPerSecond <= 2, `閃光の上限が2回/秒を超える: ${SAFETY.maxFlashesPerSecond}`);
check(1000 / SAFETY.grainShiftMs <= 2, `粒子ノイズの更新が2回/秒を超える（間隔${SAFETY.grainShiftMs}ms）`);
check(SAFETY.grainAlphaMax <= 0.1, `粒子ノイズの不透明度が0.1を超える: ${SAFETY.grainAlphaMax}`);
check(SAFETY.stageFadeMs >= 1000, `段階の遷移が1秒未満: ${SAFETY.stageFadeMs}`);
// 段階間の明るさの変化率: 遷移時間内の変化が相対輝度10%を超える急変にならないよう、1秒あたりの変化を確認する
const rate = Math.max(...LIGHT.slice(1).map((l, i) => Math.abs(l - LIGHT[i]))) / (SAFETY.stageFadeMs / 1000);
check(rate <= 25, `段階遷移の明るさの変化が1秒あたり${rate.toFixed(1)}ポイントで速すぎる（25以下）`);
// 彩度: 飽和した赤の点滅は使わない。色相が赤付近(<=20,>=340)の色は彩度を抑える
for (const [t, [hue, sat]] of Object.entries(TINT)) {
  check(sat <= 22, `${t}: 彩度${sat}%が高い`);
  check(!(hue <= 20 || hue >= 340) || sat <= 14, `${t}: 赤系の彩度が高い`);
}
const visual = read('src/render/visual.js');
check(!/hsla?\(\s*(0|35[0-9]|34\d)\s*,\s*(\d{2,3})\s*%/.test(visual) || false, '赤系の高彩度の色指定がある');

// --- 音 ---
check(AUDIO_SAFETY.masterMax <= 0.35, `マスター音量の上限が高い: ${AUDIO_SAFETY.masterMax}`);
check(AUDIO_SAFETY.stingerPeak <= 0.25, `突発音のピークが高い: ${AUDIO_SAFETY.stingerPeak}`);
check(AUDIO_SAFETY.minHz >= 40, `超低域を使っている: ${AUDIO_SAFETY.minHz}Hz`);
const audio = read('src/render/audio.js');
check(/createDynamicsCompressor/.test(audio), '音にリミッターがない');
for (const m of audio.matchAll(/frequency\.value\s*=\s*(\d+(?:\.\d+)?)/g)) check(Number(m[1]) >= 40, `40Hz未満の発振: ${m[1]}`);

// --- 動きの抑制・中止手段・既定値 ---
check(/prefers-reduced-motion:\s*reduce/.test(read('src/ui/style.css')), 'CSSに prefers-reduced-motion の対応がない');
check(!/infinite/.test(read('src/ui/style.css')), 'CSSに無限繰り返しのアニメーションがある');
const exp = read('src/ui/experience.js');
check(/中止して戻る/.test(exp) && /Escape/.test(exp), '体験に「中止して戻る」とEscの手段がない');
check(/reducedMotion/.test(exp) && /runStatic/.test(exp), '動きを減らす設定の静止表示がない');
const app = read('src/ui/app.js');
check(/audio:\s*false/.test(app) && /effects:\s*false/.test(app) && /stinger:\s*false/.test(app), '音・演出・突発音の既定がオフではない');
check(/診断ではありません/.test(app) && /専門機関/.test(app), '導入に診断ではない旨と専門機関への案内がない');
check(/disabled:\s*true/.test(app) && /consent/.test(app), '同意前に開始できてしまう');

// --- 外部通信・危険なAPI ---
for (const f of jsFiles) {
  const s = read(f);
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'Notification', 'navigator.clipboard']) {
    check(!s.includes(bad), `${f}: 使用禁止のAPI ${bad}`);
  }
  check(!/https?:\/\//.test(s.replace(/\/\/.*$/gm, '')), `${f}: 外部URLの記述`);
  if (/engine\/|render\/text/.test(f)) check(!/Math\.random|Date\.now|new Date/.test(s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${f}: 非決定的な乱数・時刻`);
}
check(!/https?:\/\//.test(read('index.html').replace(/<meta[^>]*>/g, '')), 'index.htmlに外部URL');
check(!/<script(?![^>]*type="module")[^>]*src=/.test(read('index.html')), 'index.htmlに外部/非moduleスクリプト');
check(!/@import|url\(\s*['"]?https?:/.test(read('src/ui/style.css')), 'CSSに外部読み込み');

// --- 内容の方針（docs/content_policy.md）: 本文・設問・要素に使わない語 ---
const d = loadData();
const texts = [
  ...d.questions.questions.map((q) => ['questions/' + q.id, q.text + q.echo]),
  ...d.elements.elements.map((e) => ['elements/' + e.id, e.title + e.blurb]),
  ...Object.entries(d.fragments.themes).flatMap(([t, st]) => Object.entries(st).flatMap(([s, l]) => l.map((f) => [`fragments/${t}/${s}`, f.t]))),
  ...Object.entries(d.fragments.mechs).flatMap(([t, st]) => Object.entries(st).flatMap(([s, l]) => l.map((f) => [`fragments/${t}/${s}`, f.t]))),
];
const BANNED = {
  自傷・自殺: ['自殺', '自傷', '首を吊', '飛び降り', '手首', '遺書'],
  暴力・残酷描写: ['殺す', '殺さ', '殺し', '惨殺', '内臓', '血まみれ', '流血', '切断', '肉片', '腸', '拷問'],
  性的暴力・児童: ['強姦', 'レイプ', '性的', '児童', '幼児', '少女', '少年'],
  実在への言及: ['実在の', '○○事件', '実際の事件名'],
  差別: ['障害者', '外国人', '宗教団体', '部落'],
};
for (const [id, text] of texts) {
  for (const [cat, words] of Object.entries(BANNED)) for (const w of words) check(!text.includes(w), `${id}: 方針外の語「${w}」(${cat})`);
}
// 強度: 強度3の断片は各段階の一部にとどめる（全体の3割以下）
const frag = Object.values(d.fragments.themes).flatMap((st) => Object.values(st).flat());
const share3 = frag.filter((f) => f.lv === 3).length / frag.length;
check(share3 <= 0.2, `強度3の断片が全体の${(share3 * 100).toFixed(0)}%で多い`);

if (errors.length) {
  console.error(`安全性の検証失敗: ${errors.length}件`);
  errors.forEach((e) => console.error(' - ' + e));
  process.exit(1);
}
console.log(`安全性OK: ソース${srcFiles.length}ファイル、本文${texts.length}件を検査。閃光上限${SAFETY.maxFlashesPerSecond}回/秒、音量上限${AUDIO_SAFETY.masterMax}、強度3の断片${(share3 * 100).toFixed(0)}%`);
