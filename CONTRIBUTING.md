# Contributing to Difftale

**English** · [繁體中文](CONTRIBUTING.zh-TW.md)

Contributions are welcome for new screen/service flows, verified brand assets, interaction improvements, tests, and documentation.

## Pull request workflow

1. Fork the repository on GitHub.
2. Clone your fork and add the original repository as `upstream`.
3. Create a small, focused branch from the latest `upstream/main`.
4. Run `npm install` and `npm run check`.
5. For renderer, interaction, or layout changes, also run:

   ```bash
   npm run board:qa -- --port auto --flow after --final-step --full --screenshot outputs/pr-board.jpg
   ```

6. Commit and push to your fork, then open a pull request against the original repository's `main`.
7. Describe the behavior change, Before/After result, test evidence, and any visible UI evidence.

GitHub documents the full [project contribution workflow](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project?tool=cli) and [pull requests from forks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork).

## Behavior contracts

- Before and After must share one canvas.
- App/web/mobile captures are local `screen` nodes, not hotlinks or service-card attachments.
- One edge means one direction; requests and responses never share an edge.
- Edges, arrowheads, and labels are visible before playback.
- Explain behavior, cause, and user outcome rather than commits or code diffs.
- Preserve official logo colors and proportions, and document the source and usage terms.
- A successful skill run launches and opens the localhost Board.
- Use immutable screen filenames so semantic diff can identify changed screens.

## Logo contributions

Follow the [Logo MCP workflow](skills/difftale/references/logo-mcp.md). Prefer the exact product logo, then official brand sources or trustworthy registries. If no reliable brand asset exists, use a matching `categoryIcon`; do not generate or guess a brand logo.

Document the source URL, variant, license or usage terms, and trademark owner. Do not submit recolored, unattributed, or misleading marks.

## Review scope

- Keep each pull request focused on one clearly described problem.
- Do not mix repository-wide formatting with a functional change.
- Attach a Before/After capture or short recording for UI changes.
- Reviewers prioritize behavior contracts, edge direction, readability, tests, and third-party asset provenance.
