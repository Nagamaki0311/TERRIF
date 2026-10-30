// アクセシビリティ検査（axe-core を CDN から読み込む）。使い方: node scripts/a11y.mjs
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const s = await serve(0);
const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1' } });
for (const path of ['/', '/admin/']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, bypassCSP: true });
  const p = await ctx.newPage();
  await p.route(/platform\.twitter/, r => r.abort());
  await p.goto(`http://127.0.0.1:${s.address().port}${path}`); await p.waitForTimeout(2500);
  await p.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js' });
  const r = await p.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => `${v.impact} ${v.id}: ${v.nodes.length} — ${v.nodes.slice(0,2).map(n=>n.target.join(' ')).join(' | ')}`));
  console.log(path, r.length ? r.join('\n') : 'no violations');
  await ctx.close();
}
await b.close(); s.close();
