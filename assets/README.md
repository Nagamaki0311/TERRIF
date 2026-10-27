# 素材（assets/）

視覚演出に使う画像を置く場所。生成用のプロンプトは `assets/prompts.html`（`node scripts/serve.mjs` を起動して開く）に、コピーボタン付きで一覧している。

## 手順

1. `prompts.html` のプロンプトをコピーし、Grok imagine などで16:9の画像を生成する。
2. 画像を、一覧に書かれた保存先（例: `assets/scenes/deep_sea_giant/deep.jpg`）に、そのファイル名で保存する。
3. `node scripts/build-assets.mjs` を実行する（`assets/manifest.json` が更新される）。
4. `?preview=deep_sea_giant&level=3` で、診断を飛ばして体験だけを再生して確認する。

## 方針

- 素材が無い層は、コード生成の代替で表示される。素材は1枚ずつ差し替えられる。
- 実在の人物、作品、キャラクター、生物名を含めない。文字と透かしを含めない。残酷な描写は含めない（docs/content_policy.md）。
- 素材を追加するときは、`data/scenes.json` の `assets` に、用途と生成プロンプトを書く。
- 生成した画像の権利と利用条件は、生成サービスの規約を利用者が確認する。
