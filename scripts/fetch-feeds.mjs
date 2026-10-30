// note と YouTube の最新投稿を RSS から取得し、site/data/feeds.json に書く（公開時に GitHub Actions が実行）。
// API キーや有料の連携は使わない。取得に失敗した項目は空のままにし、公開は止めない。
// 使い方: node scripts/fetch-feeds.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const site = JSON.parse(await readFile(join(root, 'site/data/site.json'), 'utf8'));

const decode = (s = '') =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]+)"`))?.[1];
const https = (u) => (u && /^https:\/\//.test(u) ? u : undefined);

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'nk-pr homepage feed fetcher' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

async function note() {
  const xml = await get(`https://note.com/${site.sns.note.user}/rss`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(([, it]) => ({
    title: tag(it, 'title'),
    link: https(tag(it, 'link')),
    date: new Date(tag(it, 'pubDate')).toISOString(),
    thumb: https(tag(it, 'media:thumbnail')),
  })).filter((x) => x.link);
}

async function youtube() {
  const id = site.sns.youtube.channelId;
  if (!id) return [];
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 6).map(([, it]) => ({
    title: tag(it, 'title'),
    link: https(attr(it, 'link', 'href')),
    date: new Date(tag(it, 'published')).toISOString(),
    thumb: https(attr(it, 'media:thumbnail', 'url')),
  })).filter((x) => x.link);
}

const out = { updated: new Date().toISOString(), note: [], youtube: [] };
for (const [k, fn] of [['note', note], ['youtube', youtube]]) {
  try {
    out[k] = await fn();
    console.log(`${k}: ${out[k].length}件`);
  } catch (e) {
    console.warn(`${k}: 取得失敗（${e.message}）`);
  }
}
await writeFile(join(root, 'site/data/feeds.json'), JSON.stringify(out, null, 1) + '\n');
