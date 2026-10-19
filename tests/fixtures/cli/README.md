# Recorded CLI output

Real output of the pinned CLIs (trustabl 0.1.14, autofix 0.2.2) on the fixture
repos, copied to `/tmp/trustabl-fixtures/` first. Unit tests parse these files so
parsers are tested against what the tools actually print, not against
hand-written guesses.

| File | Command |
| --- | --- |
| `scan.json`, `trustabl.sarif`, `scan.stdout.txt`, `scan.stderr.txt` | `trustabl scan /tmp/trustabl-fixtures/acme-support --json-out scan.json --sarif-out trustabl.sarif --no-color` |
| `scan.research.json` | `trustabl scan /tmp/trustabl-fixtures/research-tools --json-out …` |
| `SKILL.md` | `trustabl forge /tmp/trustabl-fixtures/acme-support -o SKILL.md` |
| `forge-check.pass.txt` | `trustabl forge check SKILL.md` (exit 0) |
| `forge-check.stale-*.txt` | `trustabl forge check` on SKILL.md with its stamp's `rules:` / `template:` edited (exit 1) |
| `forge-check.unstamped.txt`, `forge-check.missing.txt` | `trustabl forge check` on a file without a stamp / a missing path (exit 1) |
| `forge.nosdk.stderr.txt` | `trustabl forge .` in `research-tools` (no SDK manifest, exit 1) |
| `probe-research/` | `autofix fix --class class.yaml --sandbox --runner docker --output-dir out --no-sign --allow-list allow.txt --deny-list deny.txt …` (allow list contains the broad `*.com`) |
| `probe-strict/` | same, allow list `api.perplexity.ai` only (Stripe flagged `egress.not_in_org_allow`) |
