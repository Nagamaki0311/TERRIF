# 診断エンジンの仕様

`src/engine/engine.js` の挙動と、`data/` の各ファイルの書式をまとめる。判断の経緯は decisions.md の D-035 と D-036、研究根拠は data/research/ を参照する。

## 状態

変数ごとに推定値 `mu`（対数オッズ）と不確実性 `sigma` を持つ。変数は4種類で、定義は `data/dimensions.json`。

| kind | 内容 | 結果での使い方 |
|---|---|---|
| theme | 軸A: 何が対象か（15次元） | コアとサポートの対象を選ぶ |
| mech | 軸B: どう提示されると強いか（12次元） | コアとサポートの仕組みを選ぶ |
| gate | 調整因子（6） | `modulates` に挙げた変数の証拠の重みを乗算で増減する（係数は0.6〜1.4） |
| aux | 補助（刺激耐性、刺激希求、明示の選好） | 強度の上限と演出の方向を決める |

順位づけには `data/calibration.json` による標準化（z値）を使う。設問数や重みの違いで `mu` の大きさが変数ごとに異なるため。calibration は擬似回答者から求めた暫定値で、全次元が同程度に分布する仮定に基づく。評価データが集まったら更新する（docs/calibration.md）。

## 回答の効果

回答は `SA(+1) / A(+0.5) / N(0) / D(-0.5) / SD(-1)` の値 `a` になり、設問の `loadings`（変数ごとの重み `w`）との積が証拠になる。

- 更新量は `a × w × 学習率 × (0.6 + 0.4 × sigma) × 調整因子の積`。`mu` は `tanh` で飽和する（有限の重み）。
- `N` は `mu` をほぼ動かさず、`sigma` だけをわずかに下げる（情報量が小さい回答として扱う）。
- `DK`（わからない）は何も動かさず、同じ次元を測る別の設問が選ばれやすくなる。
- 結合（`coupling_matrix.json`）: 直接証拠を受けた変数から、1ホップ先へ係数を掛けて伝播する。1回答あたりの合計に上限がある。
- 再解釈（`reinterpret`）: 既出の回答やフラグに応じて、その設問の特定変数の重みを倍率で変える。
- フラグ（`flags`）: 「当てはまる側」「当てはまらない側」の回答で状態を立てる。再解釈の条件に使う。
- 矛盾（`pair`）: 言い換えや反転項目の組で回答が食い違った場合、証拠は捨てずに関連変数の `sigma` を上げる。上がった `sigma` は後続の出題で優先される。

指示書5.2の op との対応は次のとおり。

| 指示書の op | 実装 |
|---|---|
| evidence | `loadings`（変数ごとの証拠） |
| scale_gate | 調整因子も `loadings` の変数として扱い、`mu` を動かして係数を変える |
| scale_evidence | `reinterpret` |
| set_flag / clear_flag | `flags` |
| unlock / lock | 軸Aの次元の `z` が閾値を超えたとき、その次元の詳細設問の枝を開く（閉じない） |
| suppress | `reinterpret` の倍率で代替 |
| require_check | `pair` による `sigma` の引き上げで代替 |
| 競合仮説（5.3の6） | 未実装。`reinterpret` で個別に表現する。Phase 7の残課題 |

## 設問の選び方

1. プロフィール設問（`P`）を3問目と8問目に出す。
2. 広域設問（`S`）を、軸Aの全次元に最低限の証拠が付くまで出す（`screenCoverage`、`screenMax`）。
3. その後は、上位3次元の詳細設問が各2問に満たない間、1問おきに詳細設問を出す。残りの回は仕組み・調整因子の設問に使う。
4. 候補のスコアは「最も情報の多い変数の項 ＋ 残りの項 × 0.4」。項は `|w| × (sigma - sigmaMin + 0.1) × 重要度`。直前と同じタグ・同じ主変数は減点し、同じ主変数を既に聞いた数だけ割り引く。
5. スコア上位 `pickTop` 件から、スコアの2乗に比例して抽選する。抽選は seed と回答数だけで決まる（同じ回答なら同じ設問）。

終了条件は「最小20問以上で、コア・サポート・仕組み上位が直近5回の回答で変わらず、上位次元の詳細設問が揃った」または最大40問。

## データファイル

| ファイル | 内容 |
|---|---|
| `data/dimensions.json` | 変数、調整因子の対象、パラメータ |
| `data/coupling_matrix.json` | 変数間の結合（対称） |
| `data/src/questions.txt` | 設問の作成元（行区切り）。書式は先頭のコメントを参照 |
| `data/questions.json` | `scripts/build-questions.mjs` が生成。直接編集しない |
| `data/calibration.json` | `scripts/calibrate.mjs` が生成 |

設問を追加・変更したら次を実行する。

```
node scripts/build-questions.mjs
node scripts/validate.mjs
node scripts/calibrate.mjs   # 2〜3回繰り返して収束させる
node scripts/simulate.mjs --n=100000 --out=docs/validation/simulation.md
```

## デバッグ表示

URL に `?debug=1` を付けると、各回答がどの変数をどれだけ動かしたかを表示する（`session.log`）。
