# 公開と投稿の準備（管理者向け）

## 1. GitHub Pages を有効にする（1回だけ）

1. リポジトリの Settings → Pages を開く。
2. 「Build and deployment」の Source を「GitHub Actions」にする。
3. Actions タブで「Pages」ワークフローを手動実行（Run workflow）するか、`main` に変更が入るのを待つ。

公開元を GitHub Actions にすると `site/` がそのままトップ（`https://nagamaki0311.github.io/TERRIF/`）になり、note・YouTube の1時間ごとの更新と共有用画像の絶対URL化も働く。2026-10-31 に設定済み。

## 2. 独自ドメイン（nk-pr.com のサブドメイン）

1. サブドメイン名を決める（例: `home.nk-pr.com`）。
2. nk-pr.com の DNS 設定で、そのサブドメインに CNAME レコードを追加し、値を `nagamaki0311.github.io` にする。
3. Settings → Pages の Custom domain にサブドメインを入れて保存し、「Enforce HTTPS」をオンにする（証明書の発行まで時間がかかることがある）。

## 3. 投稿用トークンを作る（1回だけ）

1. GitHub の Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. Repository access で「Only select repositories」を選び、このリポジトリだけを選ぶ。
3. Permissions の Repository permissions で「Contents」を「Read and write」にする。ほかは付けない。
4. 有効期限は1年程度にし、期限が来たら作り直す。
5. スマホで `https://（公開URL）/admin/` を開き、トークンを貼り付けて「登録する」。

トークンはその端末のブラウザにだけ保存される。端末を手放すときは、投稿画面の「この端末からトークンを消す」と、GitHub でのトークンの削除を行う。

## 4. 投稿する

1. `/admin/` を開く（ホーム画面に追加しておくと、アプリのように開ける）。
2. 言葉を入力し、「置く」を押す。約1分でサイトの机の上に落ちてくる。
3. 下の一覧から、投稿を消せる。

## 5. YouTube の最新動画を表示する

YouTube Studio の設定 → チャンネル → 詳細設定で、チャンネルID（UC で始まる文字列）を確認し、`site/data/site.json` の `sns.youtube.channelId` に入れる。2026-10-31 に設定済み（`UC8gDEJUJCMZRd7_iQvEudiw`）。
