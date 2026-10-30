// 画面の撮影と簡易検査（Playwright）。使い方: node scripts/shots.mjs <出力先>
// 検査: コンソールエラーなし、横スクロールなし、投稿の物体が机の中に落ちる
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] ?? '/tmp/nk-shots';
mkdirSync(out, { recursive: true });
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}`;
const fails = [];
const check = (ok, m) => { console.log(`${ok ? 'OK' : 'NG'} ${m}`); if (!ok) fails.push(m); };
const browser = await chromium.launch();
for (const [name, vp, opt] of [['pc', { width: 1440, height: 900 }, {}], ['sp', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }], ['reduced', { width: 390, height: 844 }, { reducedMotion: 'reduce' }]]) {
  const ctx = await browser.newContext({ viewport: vp, ...opt });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/platform\.twitter|x\.com|twimg|syndication|ERR_FAILED/.test(m.text()) && errs.push(m.text()));
  await page.route(/platform\.twitter\.com|fonts\.g/, (r) => (/fonts\.g/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(base + '/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-1-top.png` });
  await page.locator('#now').scrollIntoViewIfNeeded();
  await page.waitForTimeout(5500);
  await page.screenshot({ path: `${out}/${name}-2-desk.png` });
  const inside = await page.evaluate(() => {
    const d = document.querySelector('[data-desk]').getBoundingClientRect();
    return [...document.querySelectorAll('.obj:not([hidden])')].every((o) => {
      const r = o.getBoundingClientRect();
      return r.left >= d.left - 30 && r.right <= d.right + 30 && r.bottom <= d.bottom + 30;
    });
  });
  check(inside, `${name}: 投稿の物体が机の中にある`);
  // 画面に入ったときの表示を発火させるため、最後まで少しずつスクロールしてから全体を撮る
  for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 500) {
    await page.evaluate((v) => scrollTo(0, v), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-3-full.png`, fullPage: true });
  check((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${name}: 横スクロールなし`);
  check(errs.length === 0, `${name}: コンソールエラーなし ${errs.join(' | ')}`);
  await ctx.close();
}
// 投稿画面: GitHub API を模して、登録→投稿→一覧への反映を確認する
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let stored = [{ id: 'p-1', at: '2026-10-31T03:20:00+09:00', text: 'テスト' }];
  let puts = 0;
  await page.route('https://api.github.com/**', async (r) => {
    const req = r.request();
    if (req.headers().authorization !== 'Bearer github_pat_test') return r.fulfill({ status: 401, body: '{}' });
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      stored = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      puts++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'x', content: Buffer.from(JSON.stringify(stored)).toString('base64') }) });
  });
  await page.goto(base + '/admin/');
  await page.fill('[data-token]', 'github_pat_wrong');
  await page.click('[data-save]');
  await page.waitForTimeout(300);
  check(/無効/.test(await page.textContent('[data-setup-msg]')), 'admin: 誤ったトークンは拒否される');
  await page.fill('[data-token]', 'github_pat_test');
  await page.click('[data-save]');
  await page.waitForSelector('[data-text]:visible');
  await page.fill('[data-text]', 'はじめての投稿。日本語と絵文字✨も大丈夫？');
  await page.click('[data-post]');
  await page.waitForFunction(() => /置きました/.test(document.querySelector('[data-msg]').textContent));
  check(puts === 1 && stored[0].text.includes('はじめての投稿') && /\+09:00$/.test(stored[0].at), 'admin: 投稿が先頭に日本時間で保存される');
  check((await page.locator('[data-list] li').count()) === 2, 'admin: 一覧に反映される');
  await page.screenshot({ path: `${out}/admin.png`, fullPage: true });
  check(errs.length === 0, `admin: エラーなし ${errs.join(' | ')}`);
  await ctx.close();
}
await browser.close();
server.close();
if (fails.length) process.exit(1);
