// 決定的な乱数。同じseedと同じ入力から同じ結果を得るために、Math.randomは使わない。

/** 文字列や数値のseedを32bit整数へ変換する（xmur3） */
export function hashSeed(input) {
  const s = String(input);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 0以上1未満の乱数列（mulberry32） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 複数の要素から導いた1回限りの乱数。呼び出し回数に依存しない */
export function rand1(...parts) {
  return mulberry32(hashSeed(parts.join('\u0001')))();
}

/** seed付き乱数列を作る */
export function makeRng(...parts) {
  return mulberry32(hashSeed(parts.join('\u0001')));
}

/** 重み付き抽選。weightsは非負 */
export function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
