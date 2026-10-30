// 投稿画面。GitHub の Contents API で site/data/posts.json を更新する。
// トークンはこの端末の localStorage にだけ保存し、api.github.com 以外へは送らない（CSPでも制限）。
import { fmtTime } from '../assets/js/util.js';

const $ = (s) => document.querySelector(s);
const KEY = 'nk.admin.token';
const MAX = 280;
let site, token;

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

/** 日本時間の ISO 文字列（+09:00） */
function nowJST() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().replace(/\.\d{3}Z$/, '+09:00');
}
const newId = (at) => `p-${at.slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const why = { 401: 'トークンが無効か、期限切れです。', 403: 'このトークンには書き込みの権限がありません。', 404: 'リポジトリかファイルが見つかりません（トークンの対象リポジトリを確認してください）。', 409: 'ほかの更新と重なりました。', 422: '保存できませんでした（内容の形式）。' }[res.status];
    const e = new Error(why ?? `GitHubとの通信に失敗しました（${res.status}）`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

const contentsPath = () => `/repos/${site.repo.owner}/${site.repo.name}/contents/${site.repo.postsPath}`;

async function readPosts() {
  const r = await api(`${contentsPath()}?ref=${encodeURIComponent(site.repo.branch)}`, { cache: 'no-store' });
  return { sha: r.sha, posts: JSON.parse(b64decode(r.content)) };
}

/** posts.json を読み、change を適用して書き戻す。他の更新と重なったら1回だけやり直す */
async function update(change, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, posts } = await readPosts();
    const next = change(posts);
    try {
      await api(contentsPath(), {
        method: 'PUT',
        body: JSON.stringify({ message, content: b64encode(JSON.stringify(next, null, 2) + '\n'), sha, branch: site.repo.branch }),
      });
      return next;
    } catch (e) {
      if (e.status !== 409 || attempt) throw e;
    }
  }
}

function say(el, text, ok) {
  el.textContent = text;
  el.className = `adm__msg ${ok === undefined ? '' : ok ? 'is-ok' : 'is-ng'}`;
}

function renderList(posts) {
  const list = $('[data-list]');
  list.replaceChildren(
    ...posts
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 12)
      .map((p) => {
        const li = document.createElement('li');
        const t = Object.assign(document.createElement('p'), { textContent: p.text });
        const time = Object.assign(document.createElement('p'), { className: 'stamp-time mono', textContent: fmtTime(p.at) });
        const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '消す' });
        del.addEventListener('click', async () => {
          if (!confirm(`この投稿を消しますか？\n\n${p.text.slice(0, 60)}`)) return;
          del.disabled = true;
          try {
            const next = await update((ps) => ps.filter((x) => x.id !== p.id), `delete: ${p.id}`);
            renderList(next);
            say($('[data-msg]'), '消しました。1分ほどでサイトに反映されます。', true);
          } catch (e) {
            say($('[data-msg]'), e.message, false);
            del.disabled = false;
          }
        });
        li.append(t, time, del);
        return li;
      }),
  );
}

async function showCompose() {
  $('[data-setup]').hidden = true;
  $('[data-compose]').hidden = false;
  const text = $('[data-text]');
  const btn = $('[data-post]');
  const len = $('[data-len]');
  const msg = $('[data-msg]');
  const sync = () => {
    const n = [...text.value.trim()].length;
    len.textContent = `${n} / ${MAX}`;
    btn.disabled = n === 0 || n > MAX;
  };
  text.addEventListener('input', sync);
  const post = async () => {
    const value = text.value.trim();
    if (!value || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '置いています…';
    say(msg, '');
    try {
      const at = nowJST();
      const next = await update((ps) => [{ id: newId(at), at, text: value }, ...ps], `post: ${value.slice(0, 30)}`);
      text.value = '';
      sync();
      renderList(next);
      say(msg, `置きました（${fmtTime(at)}）。1分ほどでサイトに反映されます。`, true);
    } catch (e) {
      say(msg, e.message, false);
      btn.disabled = false;
    } finally {
      btn.textContent = '置く';
    }
  };
  btn.addEventListener('click', post);
  text.addEventListener('keydown', (e) => (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) && post());
  text.focus();
  try {
    renderList((await readPosts()).posts);
  } catch (e) {
    say(msg, e.message, false);
    if (e.status === 401) showSetup();
  }
}

function showSetup() {
  $('[data-compose]').hidden = true;
  $('[data-setup]').hidden = false;
  $('[data-repo]').textContent = `${site.repo.owner}/${site.repo.name}（${site.repo.branch}）/${site.repo.postsPath}`;
  $('[data-save]').onclick = async () => {
    const v = $('[data-token]').value.trim();
    const m = $('[data-setup-msg]');
    if (!v) return say(m, 'トークンを貼り付けてください。', false);
    token = v;
    try {
      await readPosts();
      localStorage.setItem(KEY, v);
      showCompose();
    } catch (e) {
      say(m, e.message, false);
    }
  };
}

async function boot() {
  site = await (await fetch('../data/site.json', { cache: 'no-cache' })).json();
  token = localStorage.getItem(KEY);
  $('[data-logout]').addEventListener('click', () => {
    if (!confirm('この端末からトークンを消しますか？')) return;
    localStorage.removeItem(KEY);
    location.reload();
  });
  if (token) showCompose();
  else showSetup();
}
boot();
