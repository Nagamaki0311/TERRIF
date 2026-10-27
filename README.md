# TERRIF

質問に答えると、何がどんな形で怖さにつながりやすいかを推定し、その傾向に合わせた短い読み物（体験）を組み立てる、実験的な診断サイト。静的なHTML/CSS/JS（ES Modules）で、回答は端末内でのみ処理し、外部へは送信しない。診断や医療行為ではない。

- 公開: GitHub Pagesの「Deploy from a branch」（ルート）で公開できる。ビルド工程はない。
- 起動: `node scripts/serve.mjs` を実行し、表示されたURLを開く。`?debug=1` で回答ごとの更新量を表示し、`?seed=文字列` で結果を再現できる。
- 仕様: 診断エンジンは docs/engine.md、方針は docs/content_policy.md、校正は docs/calibration.md、研究は data/research/、デザインは design/decision.md。

## コマンド

| 目的 | コマンド |
|---|---|
| データの再生成 | `node scripts/build-questions.mjs && node scripts/build-elements.mjs && node scripts/build-fragments.mjs` |
| データ整合性 | `node scripts/validate.mjs` |
| 決定性 | `node scripts/determinism.mjs` |
| シミュレーション | `node scripts/simulate.mjs --n=100000 --out=docs/validation/simulation.md --strict` |
| レシピ・安全性 | `node scripts/recipes.mjs --strict` / `node scripts/safety.mjs` |
| 感度分析 | `node scripts/sensitivity.mjs --out=docs/validation/sensitivity.md` |
| ブラウザでの通し確認 | `node scripts/e2e.mjs`（Playwrightが必要） |
| 文章の確認 | `node scripts/preview.mjs --who=3 --level=3` |
| 素材の取り込み | `node scripts/build-assets.mjs`（生成プロンプトは `assets/prompts.html`、確認は `/?preview=deep_sea_giant&level=3`） |

以下は、このリポジトリの元になった開発テンプレート（project001）の説明。

# project001

Claude CodeによるAI開発OS。新規アプリ開発に共通する開発方針・タスク管理・レビュー手順をテンプレートとして提供する。

## セットアップ

1. `git clone`等でこのリポジトリを取得する。
2. （任意）`bash .claude/bootstrap.sh`を実行し、Optional Dependency（Agent-Reach/Code Review Graph/Context7/GitHub CLI等）の導入状況を確認する。インストールは行わず案内のみを表示するため、実行しなくてもproject001は完全に動作する。
3. AGENTS.mdの開発フロー（User → Manager → Planner → Developer → Reviewer → Manager → Complete）に従って進める。

## 使い方

新規アプリを開発する場合、このリポジトリをコピーして雛形として使う。個別アプリの仕様・実装コードはproject001自体には追加しない。以降はAGENTS.mdの開発フローに従って進める。

### 新規プロジェクトでの初期化

`/init-project`コマンド（`.claude/commands/init-project.md`）を実行するか、以下の手順を直接行う。コピー直後にこの手順を行わないと、新規プロジェクトのSessionStart Hookがproject001自身の構築履歴を表示し続けてしまう。docs/のうちtasks.md/progress.md/decisions.mdの3つのみをリセットする。

- `docs/tasks.md`: 「## タスク一覧」表のヘッダ行と区切り行は残し、`T-xxx`の行をすべて削除する。「## バックログ」の既存項目もすべて削除する。列構成は変えない（SessionStart Hookが状態列の値でフィルタするため）。
- `docs/progress.md`: 「## 記録フォーマット」直後の`---`（この行を含む）より下をすべて削除する。
- `docs/decisions.md`: 同様に`---`（この行を含む）より下のD-xxxをすべて削除する。
- 型付き言語を使う場合は、docs/capability-layer.md「派生プロジェクトでの推奨プラグイン」に従ってCode intelligenceプラグインの有効化を検討する（使用言語が未定なら、決まった時点で行う）。
- （任意）PR作成からマージまでの自動化を使う場合は、docs/agents.md「PR作成からマージまでの自動化」の雛形を、派生プロジェクトのCLAUDE.mdまたは個人設定に追記する。
- `CLAUDE.md`: project001自身の運用を説明する記述（「Skills / Capability Layer」節など）を派生側の実態に合わせて書き換え、次の2節を追加する。`## コマンド`（ビルド・テスト・lint・起動の実コマンド）と、UIがある場合の`## デザイントークン`（配色・タイポグラフィ・余白。docs/design-workflow.md「デザイントークンの往復」の記録先）。
- `README.md`: プロジェクト名・概要を書き換える。本節「### 新規プロジェクトでの初期化」自体は削除してよい。

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
