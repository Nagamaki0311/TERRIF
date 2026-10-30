// 共有用画像（site/og.png、1200×630）をヒーローから撮る。デザインを変えたら実行する。
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const server = await serve(0);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await ctx.addInitScript(() => { localStorage.setItem('nk.lamp', '0'); localStorage.setItem('nk.visits', '1'); sessionStorage.setItem('nk.counted', '1'); });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '.topbar{display:none}.hero{min-height:630px}' });
await page.screenshot({ path: new URL('../site/og.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
server.close();
console.log('site/og.png');
