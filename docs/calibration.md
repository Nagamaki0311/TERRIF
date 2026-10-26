# 校正と評価データの運用

シミュレーション（`scripts/simulate.mjs`）は内部整合性を確認するもので、推定が実際の恐怖反応と合っているかは示さない。合っているかは、利用者の評価データで確かめる。

## 評価データの取得

- 体験の後、利用者が任意で「最も強く感じたもの」と「感じた強さ（1〜5）」を答える。
- データはこの端末のブラウザ内だけで扱う。JSONの書き出し（ダウンロード）と、同意した場合のみ localStorage（キー `terrif.feedback.v1`）への保存がある。サーバーへの送信は実装していない。
- 書き出したJSONに含まれるもの: seed、設定、回答（設問IDと選択肢）、次元ごとのz値、レシピ（要素ID、ペース、形式、語り口、強度、引用した設問ID）、評価。氏名などの個人情報は含まない。回答の内容自体は含まれるため、共有する場合は利用者の同意を得る。

## 集めた後の手順

1. 書き出されたJSONを1つのディレクトリに集める。
2. 次を集計する。コアの要素ごとの「最も強く感じた」の割合（`strongest = core`）、強度の分布、中止の割合、「どれも感じなかった」の割合。
3. 次の判断基準で見直す。

| 観察 | 見直す対象 |
|---|---|
| コアが「最も強く感じた」に選ばれる割合が、サポートやペースと同程度かそれ以下 | `data/synergy_matrix.json` と `src/engine/recipe.js` の重み、`data/elements.txt` の組合せ |
| 特定の対象で「どれも感じなかった」が多い | その対象の設問（`data/src/questions.txt`）の重み、文章断片 |
| 強度「強」で中止が多い | `decideLevel` の閾値、強度3の断片 |
| 引用（エコー）が選ばれない | エコーの文面（`E|` 行）、引用の選び方 |

4. 変更したら、データを再生成し、校正と検証をやり直す。

```
node scripts/build-questions.mjs && node scripts/build-elements.mjs && node scripts/build-fragments.mjs
node scripts/validate.mjs
node scripts/calibrate.mjs   # 2〜3回
node scripts/simulate.mjs --n=100000 --out=docs/validation/simulation.md --strict
node scripts/recipes.mjs --n=30000 --out=docs/validation/recipes.md --strict
node scripts/safety.mjs
```

## 暫定値の一覧

評価データが集まるまでは、次の値が仮置きである。

| 値 | 場所 | 根拠 |
|---|---|---|
| 変数ごとの平均・標準偏差 | `data/calibration.json` | 擬似回答者（全次元が同程度に分布する仮定） |
| 結合の重み | `data/coupling_matrix.json` | 研究の方向性のみ。大きさは仮置き |
| 相乗・競合の重み | `data/synergy_matrix.json` | 同上 |
| 強度の閾値（0.5、-0.4） | `src/engine/recipe.js` の `decideLevel` | 擬似回答者の約33%・67%点 |
| 技法の確度 | `data/research/techniques.json` | 確度「中」は10件、残りは「低」。効果量を示した資料は未取得 |

## 限界

- 設問と推定対象の対応は未検証。間接的な設問ほど対応が弱い（data/research/analysis.md）。
- 公開時は「実験的な診断」と明記する。
- 評価データは自己選択の偏りを持つ（体験した人、評価に答えた人のみ）。中止した人のデータも保持する。
