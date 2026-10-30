@AGENTS.md

# Claude Code設定

このファイルはClaude Code固有の設定・運用ルールのみを扱う。開発方針・設計原則・ワークフローは AGENTS.md（上記import）、レビュー方針は REVIEW.md を参照する。すべてのAIエージェント共通のルールをCLAUDE.mdへ書き足さない。

## セッション運用

- セッション開始時: SessionStart Hookで docs/tasks.md・docs/progress.md の要約が自動表示される（環境によっては発火しない場合がある。詳細・確認方法はdocs/agents.md参照）。
- 長時間セッション: 同じタスクを続ける場合に限り `/compact <残したい観点>` の形で使い、PreCompact Hookの案内に従って圧縮前にdocsへ記録する。`/compact`自体が会話全体を読む大きなリクエストのため、継続性が不要なら`/clear`（コストなし）を選ぶ。
- タスク完了後: 次のタスクに移る前にコンテキストをリセットする（`/clear` 等）。
- 修正が2回失敗したら: コンテキストをリセットして状況を整理してから再着手する。

## トークン効率化

- 不要なAgentは起動しない。巨大ファイルは全文を読まず、検索（Grep/Glob）で対象を絞る。
- `.claude/settings.json`の`outputStyle: Concise`（2026年8月公式追加）により、Managerの応答は前置き・振り返りを省き結果から述べる。詳細説明の質は落とさない。
- 調査・実装・レビューは各Agentに委任し、メインセッションには要約のみ持ち込む。同じ情報を複数箇所に保存しない。
- CLAUDE.md/AGENTS.mdは`@AGENTS.md`importにより毎セッション読み込まれるため、各行を「消すとAIが判断を誤るか」で判定し、否なら削除する（この削除テストの対象はCLAUDE.md/AGENTS.mdのみで、オンデマンドロードのREVIEW.md/docs/は対象外）。特定タスクでのみ必要な知識はdocs/へ置き参照のみ残す。README.mdも簡潔に保つが、常時ロードされないため削除テストの対象外とする。

## Skills / Capability Layer

外部ツール（Agent-Reach、Code Review Graph、Context7、`gh`等）は`.claude/bootstrap.sh`が検出して案内するだけで、Agentの振る舞いには組み込んでいない（現在Tier1なし）。検出規約・各ツールの詳細・昇格条件はdocs/capability-layer.mdを参照する。project001自体はいずれのツールにも依存せず、本リポジトリに依存を追記しない。

Claude Codeプラグインはproject scopeで既定有効化しない。例外はFrontend Design（`frontend-design@claude-plugins-official`、D-025。docs/design-workflow.md参照）のみ。

Skills（`.claude/skills/`配下のSKILL.md）は、再利用可能な具体的ワークフローが確認された時点で追加する。1行説明は全Skillぶん毎セッション常時ロードされるため、追加したSkillは関連タスクでの起動実績を`/usage`で確認して刈り込む。現在は`design-principles`（UI/UXデザイン品質判断基準、D-025）のみ。

## 進捗の可視化

サブエージェント（Planner/Researcher/Developer/Reviewer）実行中のみ、`subagentStatusLine`（`.claude/settings.json`）により、専門用語を使わない日本語でエージェントパネルに進捗を表示する。通常のチャット中は表示されず、LLM呼び出しも行わない。詳細はdocs/status-line.mdを参照。

## コマンド

README.md の「コマンド」表を参照する。UI を変えたら `node scripts/shots.mjs <出力先>` で撮影し、検査（コンソールエラー・横スクロール・投稿画面の流れ）を通す。

## デザイントークン

docs/design.md を参照する。紙 #f2ece0、墨 #1d1a17、特色インク（ピンク #ff4fa3・ブルー #0a7bd1・イエロー #ffd23f・グリーン #00a37a）。見出し Dela Gothic One、ドット DotGothic16、本文 Zen Kaku Gothic New。

## 参照ドキュメント

- REVIEW.md: レビュー方針（敵対的検証）。reviewer Agentが従う
- docs/tasks.md: 現在のタスク、優先順位、状態管理（Managerが管理）
- docs/progress.md: 作業履歴、次回開始位置（Developerが記録）
- docs/decisions.md: 設計判断、採用理由、変更履歴
- docs/agents.md: Agent構成、モデル構成、オーケストレーションルール、Hook構成
- docs/status-line.md: サブエージェント進捗の可視化（Status Line）の仕様
