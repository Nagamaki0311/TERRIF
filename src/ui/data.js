// 実行時に必要なJSONを読み込む。外部ドメインへの通信は行わない（同一オリジンの静的ファイルのみ）。
const FILES = {
  dimensions: 'data/dimensions.json',
  questions: 'data/questions.json',
  coupling: 'data/coupling_matrix.json',
  calibration: 'data/calibration.json',
  elements: 'data/elements.json',
  synergy: 'data/synergy_matrix.json',
  fragments: 'data/text_fragments.json',
};

export async function loadData() {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([k, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} を読み込めませんでした（${res.status}）`);
      return [k, await res.json()];
    }),
  );
  return Object.fromEntries(entries);
}
