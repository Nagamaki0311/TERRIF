// ブラウザでの通し確認（Playwright）。導入→設問→レポート→体験→中止→評価までを実行し、スクリーンショットを保存する。
// 使い方: node scripts/e2e.mjs [--shots=/tmp/terrif-shots] [--wait=14000]
// 検査: コンソールエラーなし、外部ドメインへの通信なし、横スクロールなし、中止ボタンが常に表示されている、動きを減らす設定で自動進行しない
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { args } from './lib.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const a = args();
const shots = a.shots ?? '/tmp/terrif-shots';
const waitMs = a.wait ?? 14000;
mkdirSync(shots, { recursive: true });
const server = await serve(0).then((s) => s);
const base = `http://127.0.0.1:${server.address().port}`;
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) failures.push(msg);
};

async function scenario(browser, name, viewport, { reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && external.push(r.url()));

  await page.goto(`${base}/?seed=e2e-${name}`);
  await page.waitForSelector('#consent');
  await page.screenshot({ path: `${shots}/${name}-1-intro.png`, fullPage: true });
  check(await page.locator('button:has-text("調査を始める")').isDisabled(), `${name}: 同意前は開始できない`);
  await page.check('#consent');
  await page.click('.seg label:nth-child(3)'); // 強
  await page.check('#audio');
  await page.check('#effects');
  await page.click('button:has-text("調査を始める")');

  // 設問: 回答パターンを巡回させる（1,2,2,4,5,3,2,1,6...）
  const pattern = ['1', '2', '2', '4', '5', '3', '2', '1', '2', '6'];
  let n = 0;
  for (; n < 70; n++) {
    if (await page.locator('h1:has-text("診断レポート")').count()) break;
    await page.waitForSelector('.q-text');
    if (n === 3) await page.screenshot({ path: `${shots}/${name}-2-quiz.png`, fullPage: true });
    const before = await page.textContent('.q-text');
    await page.keyboard.press(pattern[n % pattern.length]);
    await page.waitForFunction((t) => document.querySelector('h1')?.textContent === '診断レポート' || document.querySelector('.q-text')?.textContent !== t, before, { timeout: 5000 });
    if (n === 6) {
      // 「ひとつ戻る」で直前の設問に戻り、同じ設問が再出題される
      const cur = await page.textContent('.q-text');
      await page.click('button:has-text("ひとつ戻る")');
      await page.waitForFunction((t) => document.querySelector('.q-text')?.textContent !== t, cur);
      await page.keyboard.press(pattern[n % pattern.length]);
      await page.waitForFunction((t) => document.querySelector('.q-text')?.textContent === t || document.querySelector('h1')?.textContent === '診断レポート', cur);
    }
  }
  check(n >= 20 && n <= 45, `${name}: 設問数が20〜40の範囲（${n}問）`);
  await page.waitForSelector('h1:has-text("診断レポート")');
  await page.screenshot({ path: `${shots}/${name}-3-report.png`, fullPage: true });
  check((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: 横スクロールが出ない（レポート）`);
  check((await page.textContent('main')).includes('診断ではなく'), `${name}: レポートに診断ではない旨がある`);

  // 共有: 画像は1200x630で保存でき、文面に回答の引用・seedを含まない
  const card = page.locator('canvas[aria-label^="共有用の画像"]');
  check((await card.evaluate((c) => `${c.width}x${c.height}`)) === '1200x630', `${name}: 共有画像が1200x630`);
  await card.screenshot({ path: `${shots}/${name}-3b-card.png` });
  const shareP = await page.locator('main p[style*="pre-wrap"]').textContent();
  check(shareP.includes('#TERRIF') && !shareP.includes(`e2e-${name}`) && !/答え/.test(shareP), `${name}: 共有文面に回答・seedを含まない`);
  const [dl0] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("画像を保存")')]);
  check(dl0.suggestedFilename() === 'terrif.png', `${name}: 共有画像を保存できる`);
  await page.click('button:has-text("体験する")');
  await page.waitForSelector('.exp');
  const stopVisible = async () => {
    const box = await page.locator('.exp-bar .stop').boundingBox();
    return !!box && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
  };
  check(await stopVisible(), `${name}: 体験開始時に「中止して戻る」が見える`);
  if (reduced) {
    // 動きを減らす設定: 自動進行せず「次へ」で段階ごとに進む
    await page.waitForSelector('button:has-text("次へ")');
    const first = await page.textContent('.exp-text');
    await page.waitForTimeout(1500);
    check((await page.textContent('.exp-text')) === first, `${name}: 動きを減らす設定で自動進行しない`);
    for (let i = 0; i < 4; i++) {
      await page.screenshot({ path: `${shots}/${name}-4-exp-${i}.png` });
      await page.click('button:has-text("次へ")');
    }
    await page.screenshot({ path: `${shots}/${name}-4-exp-4.png` });
    check(await stopVisible(), `${name}: 最終段階でも「中止して戻る」が見える`);
    await page.click('.exp button:has-text("戻る")');
  } else {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shots}/${name}-4-exp-early.png` });
    await page.waitForTimeout(waitMs);
    await page.screenshot({ path: `${shots}/${name}-4-exp-late.png` });
    check(await stopVisible(), `${name}: 体験中も「中止して戻る」が見える`);
    check((await page.title()) !== 'TERRIF 聞き取り調査' || waitMs < 8000, `${name}: ブラウザ演出（タブ名）が働く`);
    await page.click('.exp-bar .stop');
    check((await page.title()) === 'TERRIF 聞き取り調査', `${name}: 中止後にタブ名が元に戻る`);
  }
  await page.waitForSelector('h1:has-text("中止しました"), h1:has-text("記録は以上です")');
  check((await page.locator('.exp').count()) === 0, `${name}: 体験の画面が閉じる`);
  check((await page.locator('.trail').count()) === 0, `${name}: 演出用の要素が残らない`);
  await page.screenshot({ path: `${shots}/${name}-5-feedback.png`, fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("評価を含めて書き出す")')]);
  check(dl.suggestedFilename().endsWith('.json'), `${name}: 評価をJSONで書き出せる`);
  check(errors.length === 0, `${name}: コンソールエラーなし ${errors.join(' | ')}`);
  check(external.length === 0, `${name}: 外部への通信なし ${external.join(' ')}`);
  await ctx.close();
}

// 視覚演出の確認用ページ: 診断を飛ばして体験を再生し、中止できる
async function sceneScenario(browser, id) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?preview=${id}&level=3&pace=sudden`);
  await page.waitForSelector('.exp canvas');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${shots}/scene-${id}.png` });
  const lit = await page.evaluate(() => {
    const c = document.querySelector('.exp canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4000) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  });
  check(lit > 0, `scene ${id}: 映像が描画されている`);
  check(await page.locator('.exp-bar .stop').isVisible(), `scene ${id}: 中止ボタンが見える`);
  check(errors.length === 0, `scene ${id}: コンソールエラーなし ${errors.join(' | ')}`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const id of ['deep_sea_giant', 'dark_enclosed', 'gaze_surveillance']) await sceneScenario(browser, id);
  await scenario(browser, 'mobile', { width: 390, height: 844 });
  await scenario(browser, 'desktop', { width: 1280, height: 800 });
  await scenario(browser, 'reduced', { width: 390, height: 844 }, { reduced: true });
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`\n失敗 ${failures.length}件`);
  process.exit(1);
}
console.log(`\nすべて合格。スクリーンショット: ${shots}`);
