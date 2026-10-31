# Contributing to Agent Dashboard

Thanks for helping. The dashboard is a thin, local UI over three open-source
CLIs, so most changes are small: a parser, a view model, a screen.

## Ground rules

- **Never invent data.** Every value on screen comes from real CLI output
  (`scan.json`, SARIF, `SKILL.md`, `forge check`, `probe.*.json`,
  `network_policies.draft.yaml`) or from the dashboard's own run history. If the
  design shows a field no pinned CLI produces, render
  `<Unavailable what="…" />` and open an issue on the CLI's repo.
- **Don't change the CLIs from here.** `agent-reliability-analyzer` and
  `agent-network-access-probe` are separate projects; open an issue or PR
  there and record the gap here.
- **Every action maps to a real command** and offers "Copy CLI" with it.
- **Local only.** No login, no users or orgs, no network calls except the
  pinned-CLI download and the LLM endpoint the person configures for Probe.
  The server binds `127.0.0.1`.
- **No secrets.** Never commit keys, `.env*` files, internal hostnames or
  customer data. CI runs gitleaks over the whole history (`make secrets`).

## Setup

```sh
make run          # one-command start (installs deps + pinned CLIs, builds, serves)
make dev          # hot reload
```

Requirements: macOS, Linux or WSL2 with `git`, `curl`, `tar`, `make`;
Node.js ≥ 22.13 (`make run` installs a private copy if missing). Docker is
needed for Probe runs and the Probe end-to-end / parity tests.

## Tests

| Command | What |
| --- | --- |
| `make check` | eslint + `tsc --noEmit` + Vitest unit tests (`tests/unit`) |
| `make e2e` | Playwright against a real build, real pinned CLIs and the fixture repos (`tests/fixtures/repos`); Probe cases are skipped when Docker is down |
| `make parity` | Artifact parity: each tool run through the dashboard, then its recorded Copy CLI command in a plain shell; artifacts must match with timestamps masked |
| `make secrets` | gitleaks (needs the `gitleaks` binary) |

Parsers are tested against **recorded real CLI output** in
`tests/fixtures/cli/`, and page components against view models recorded from
the dashboard's own API in `tests/fixtures/views/`. When you bump a pinned CLI
version, re-record those files (see the README in each folder) instead of
editing them by hand.

Offline? Put the release archives in a folder and set
`TRUSTABL_TOOLS_ARCHIVE_DIR`; `scripts/fetch-tools.mjs` verifies them against
the same SHA-256 in `tools.lock.json`.

## Bumping a pinned CLI

1. Update `version` and every `sha256` in `tools.lock.json` (from the
   release's checksums file).
2. Re-record `tests/fixtures/cli/` and `tests/fixtures/views/`.
3. Run `make check e2e parity`; fix parsers for any output change.
4. Replace `<Unavailable />` with the real value for any field the new CLI version now reports.

## Code layout

- `src/lib/*.ts` — pure parsers and derivations (unit-tested, no I/O)
- `src/lib/server/` — DB, run engine, CLI wrappers (`actions/`), view models (`queries/views.ts`)
- `src/app/api/` — route handlers (no auth)
- `src/app/(console)/` — the four pages + repo detail
- `src/components/ui/` — design-system components (Apache-2.0)
- `src/components/console/` — dashboard building blocks (tables, pills, run dialog, Copy CLI)

## Licenses

The dashboard is Apache-2.0. Before vendoring anything, check its license is
compatible and note it next to the copy (as `src/components/ui/*` and
`tests/fixtures/README.md` do). Fonts come from npm under OFL-1.1.

## Commits and PRs

Small commits, one step each, with a message that says what changed and why.
CI (secrets, checks, e2e + parity, one-command start on Linux and macOS) must
be green before merge.
