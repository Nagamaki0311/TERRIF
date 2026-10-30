# nk-pr ホームページ

nαgαiki の個人ホームページ。平成の個人サイトとリソグラフ印刷の質感を、物理演算で遊べる「机の上」として組み立てる。スマホの投稿画面から一言を置くと、約1分でサイトに反映される。nk-pr.com のサブドメインで公開予定。

- サイト本体: `site/`（静的な HTML/CSS/JS。Matter.js を同梱）
- 公開: GitHub Pages（`.github/workflows/pages.yml`）。準備と投稿の手順は docs/admin.md
- デザインと調査: docs/design.md

## コマンド

| 目的 | コマンド |
|---|---|
| 手元で表示 | `node scripts/serve.mjs`（http://127.0.0.1:8080/） |
| 画面の撮影と検査（Playwright） | `node scripts/shots.mjs <出力先>` |
| note・YouTube の取得 | `node scripts/fetch-feeds.mjs` |

以下は、このリポジトリの元になった開発テンプレート（project001）の説明。


## セットアップ

1. `git clone`等でこのリポジトリを取得する。
2. （任意）`bash .claude/bootstrap.sh`を実行し、Optional Dependency（Agent-Reach/Code Review Graph/Context7/GitHub CLI等）の導入状況を確認する。インストールは行わず案内のみを表示するため、実行しなくてもproject001は完全に動作する。
3. AGENTS.mdの開発フロー（User → Manager → Planner → Developer → Reviewer → Manager → Complete）に従って進める。

## 使い方

新規アプリを開発する場合、このリポジトリをコピーして雛形として使う。個別アプリの仕様・実装コードはproject001自体には追加しない。以降はAGENTS.mdの開発フローに従って進める。

## 構成

- AGENTS.md
  - 開発方針・設計原則・ワークフロー（全AIエージェント共通、最優先で読む）

- REVIEW.md
  - レビュー方針（敵対的検証 / Adversarial Review）。reviewer Agentが従う

- CLAUDE.md
  - Claude Code固有の設定・運用ルール（AGENTS.mdをimportする）

- .claude/agents
  - planner / designer / researcher / developer / reviewer

- .claude/skills/design-principles
  - UI/UXデザインの品質判断基準（designer/developer/reviewerが使用）

- .claude/settings.json
  - SessionStart / PreCompact / PostToolUse / SubagentStop / SessionEnd Hook（セッション継続性・ドキュメント品質の補助）、subagentStatusLine（サブエージェント進捗の可視化）、enabledPlugins（Frontend Designをproject scopeで有効化）。詳細はdocs/agents.md・docs/design-workflow.md

- .claude/bootstrap.sh
  - Optional Dependency（Capability Layer）の導入状況を案内のみで表示する検出スクリプト。インストールは行わない

- .claude/commands/init-project.md
  - `/init-project`コマンド。新規プロジェクトでの初期化手順（本READMEの該当節）を実行する

- docs
  - tasks.md: タスクと状態管理
  - progress.md: 作業履歴
  - decisions.md: 設計判断の記録
  - agents.md: Agent構成・モデル構成・Hook/Status Line構成の詳細
  - agent-reach.md: [Agent-Reach](https://github.com/Panniantong/Agent-Reach) 対応（Optional Dependency、検出・フォールバック方針）
  - code-review-graph.md: [Code Review Graph](https://github.com/tirth8205/code-review-graph) 対応（Optional Dependency、影響範囲解析）
  - context7.md: [Context7](https://github.com/upstash/context7) 対応（Optional Dependency、ライブラリドキュメント確認）
  - capability-layer.md: 外部ツール検出の共通規約（Capability Layer）
  - research-workflow.md: 外部調査ワークフロー
  - design-workflow.md: デザインワークフロー（Designer/Claude Design/Frontend Designプラグインの連携）
  - status-line.md: サブエージェント進捗の可視化（Status Line）の仕様

## 開発フロー

User → Manager → Planner → Developer → Reviewer → Manager → Complete
（外部調査が必要な場合のみResearcherが、UI/UX実装を伴う場合のみDesignerが加わる）

詳細は AGENTS.md・REVIEW.md・docs/agents.md・docs/design-workflow.md を参照。
