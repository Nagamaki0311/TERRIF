// data/src/questions.txt から data/questions.json を生成する。
// 使い方: node scripts/build-questions.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dims = JSON.parse(readFileSync(join(root, 'data/dimensions.json'), 'utf8'));
const themeIds = new Set(dims.variables.filter((v) => v.kind === 'theme').map((v) => v.id));
const PHASE = { S: 'screen', M: 'mix', P: 'profile' };

const rows = readFileSync(join(root, 'data/src/questions.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'));

const fail = (n, msg) => {
  throw new Error(`questions.txt 行${n}: ${msg}`);
};

const questions = rows.map((line, i) => {
  const c = line.split('|');
  if (c.length < 7 || c.length > 8) fail(i + 1, `列数が${c.length}（7か8が必要）`);
  const [kind, text, echo, tags, loads, intent, alt, extraRaw] = c;
  const branch = PHASE[kind] ? 'core' : kind;
  if (!PHASE[kind] && !themeIds.has(kind)) fail(i + 1, `区分が不明: ${kind}`);
  const loadings = {};
  for (const kv of loads.split(',')) {
    const [k, v] = kv.split(':');
    if (!Number.isFinite(Number(v))) fail(i + 1, `loadingsの値が不正: ${kv}`);
    loadings[k] = Number(v);
  }
  let extra = {};
  if (extraRaw) {
    try {
      extra = JSON.parse(extraRaw);
    } catch (e) {
      fail(i + 1, `extraのJSONが不正: ${e.message}`);
    }
  }
  return {
    id: `q${String(i + 1).padStart(3, '0')}`,
    branch,
    phase: PHASE[kind] ?? 'detail',
    text,
    echo,
    tags: tags.split(','),
    loadings,
    ...(extra.flags && { flags: extra.flags }),
    ...(extra.reinterpret && { reinterpret: extra.reinterpret }),
    ...(extra.pair && { pair: extra.pair }),
    meta: { intent, alt },
    _label: extra.label,
  };
});

// label か、設問文・echo に含まれる一意の部分文字列で設問を解決する
const resolve = (ref, n) => {
  const byLabel = questions.filter((q) => q._label === ref);
  const hit = byLabel.length ? byLabel : questions.filter((q) => q.text.includes(ref) || q.echo.includes(ref));
  if (hit.length !== 1) throw new Error(`${questions[n].id}: 参照「${ref}」が${hit.length}件に一致`);
  return hit[0].id;
};
questions.forEach((q, n) => {
  if (q.pair) q.pair.with = resolve(q.pair.with, n);
  q.reinterpret?.forEach((r) => {
    if (r.if.q) r.if.q = resolve(r.if.q, n);
  });
});
questions.forEach((q) => delete q._label);

writeFileSync(join(root, 'data/questions.json'), JSON.stringify({ questions }, null, 1) + '\n');
console.log(`questions.json: ${questions.length}問`);
