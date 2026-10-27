# このリポジトリでの作業の約束

@AGENTS.md

- 仕様は `SPEC.md`（実装の正）。セッションをまたぐ引継ぎは `HANDOVER.md`。画面の文言・コメント・ドキュメントは日本語。
- GCP の構築・デプロイの前に、スキル gcp-bootstrap を読む（正本 rkanezashi12-cmd/claude-skills の skills/gcp-bootstrap/SKILL.md。
  スキル一覧に無ければ add_repo して読む）。新しく確かめたことはスキルに追記して push する
- GCP の操作は GitHub Actions のワークフロー「gcp」（`.github/workflows/gcp.yml`）から行う。手順は `docs/deploy.md`。
