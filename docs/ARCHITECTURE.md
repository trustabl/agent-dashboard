# Agent Dashboard — System Architecture

This document is the authoritative reference for the architecture of Agent
Dashboard, the open-source, local edition. It describes the current
implementation: what each component is, how the components connect, and the
conventions engineers and AI coding agents must follow.

When facts in this file conflict with other docs, this file wins: update the
others to match. When facts conflict with the code, the code wins, and this
file must be updated in the same commit.

---

## 1. Purpose

Agent Dashboard is a single-user web UI that runs on the developer's own
machine. It wraps two pinned open-source CLIs so that one developer can run
**Forge** (`trustabl forge`, `trustabl forge check`), **Analyzer**
(`trustabl scan`) and **Probe** (`autofix fix`) on local repositories from one
app, without installing or configuring either tool. The Console starts the
CLIs as subprocesses, keeps their artifacts and a run history on disk, and
shows only values that the CLI output or its own run history contain. It has
no login and no user or org model, and it listens on `127.0.0.1` only.

---

## 2. Repo Layout

```
agent-dashboard/
├── Makefile                  ← run | dev | tools | test | e2e | parity | lint | typecheck | check | secrets | audit | wipe
├── tools.lock.json           ← pinned CLI versions + per-platform SHA-256
├── scripts/
│   ├── run.sh                ← `make run`: Node bootstrap, npm ci, fetch CLIs, build-if-changed, serve
│   ├── fetch-tools.mjs       ← download + SHA-256-verify the pinned CLIs
│   ├── source-sum.mjs        ← hash of build inputs (run.sh rebuilds only when it changes)
│   └── wipe.sh               ← `make wipe`: delete all Console state
├── src/
│   ├── proxy.ts              ← Next.js request proxy: localhost Host + same-origin checks
│   ├── instrumentation.ts    ← server start hook → boot()
│   ├── app/
│   │   ├── layout.tsx        ← root: fonts, theme bootstrap, Theme + Toast providers
│   │   ├── (console)/        ← app shell + the four pages and repo detail
│   │   └── api/              ← route handlers (no auth)
│   ├── lib/
│   │   ├── *.ts              ← pure parsers and derivations, no I/O (findings, forge, probe, shell, text, time, types)
│   │   ├── client/api.ts     ← browser fetch helpers + SWR hook
│   │   └── server/           ← DB, paths, run engine, CLI wrappers (actions/), view models (queries/)
│   └── components/
│       ├── ui/               ← design-system components (Apache-2.0)
│       ├── patterns/         ← AppShell, BrandMark, EmptyState
│       └── console/          ← RunDialog, RunLog, RunHistory, CopyCli, ArtifactViewer, SkillReview, tables, cells
├── tests/
│   ├── unit/                 ← Vitest + Testing Library (lib/ and components/)
│   ├── e2e/                  ← Playwright, incl. axe, keyboard and reflow specs
│   ├── parity/               ← Console artifacts == CLI artifacts
│   └── fixtures/             ← fixture repos, recorded CLI output, recorded view models
├── docs/                     ← this file
└── .github/workflows/ci.yml  ← GitHub Actions
```

### What is NOT part of the architecture

These paths exist in a working copy but are generated, local-only or
reference material. Never treat them as part of the system:

| Path | What it is |
|------|------------|
| `.data/` | Owner's local scratch (build logs, offline CLI archives in `.data/dl/`, sync bundles). Git-ignored. |
| `.next/`, `node_modules/`, `*.tsbuildinfo`, `next-env.d.ts` | Build and dependency output. |
| `test-results/`, `playwright-report/`, `tests/.tmp/` | Test output and the throwaway e2e Console home. |

---

## 3. High-Level Topology

Everything runs on one machine, in one Node.js process. That process starts
the CLIs as subprocesses.

```
                     Developer's browser
                            │ HTTP (127.0.0.1 only)
                            ▼
          ┌───────────────────────────────────────┐
          │  src/proxy.ts                         │
          │  Host must be localhost / 127.0.0.1;  │
          │  non-GET must be same-origin          │
          └──────────────────┬────────────────────┘
                             ▼
          ┌───────────────────────────────────────┐
          │  Next.js 16 server  (next start)      │
          │  127.0.0.1:4317                       │
          │                                       │
          │  pages: (console)/  ── SWR ──┐        │
          │                              ▼        │
          │  api/* route handlers ──► lib/server  │
          │    views (queries/)    actions/       │
          │    runner.ts (run engine)             │
          └──┬──────────────┬──────────────┬──────┘
             │              │              │ spawn (argv array, detached)
             ▼              ▼              ▼
   ┌───────────────┐ ┌─────────────┐ ┌──────────────────────────────┐
   │ SQLite        │ │ Run folders │ │ Pinned CLIs (~/.agent-       │
   │ console.db    │ │ runs/<id>/  │ │ dashboard/bin/)              │
   │ (node:sqlite) │ │ logs +      │ │  trustabl 0.1.15  scan/forge │
   └───────────────┘ │ artifacts   │ │  autofix  0.2.2   fix        │
                     └─────────────┘ └──────┬───────────────┬───────┘
                                            │               │
                         reads local repos ◄┘               ▼
                         (git rev-parse via         ┌───────────────────┐
                          execCapture)              │ Docker / OpenShell│
                                                    │ sandbox (Probe)   │
                                                    └─────────┬─────────┘
                                                              ▼
                                                  LLM endpoint the user
                                                  configured (Probe only)
```

Outbound network traffic is limited to these destinations:

- **GitHub release downloads** of the pinned CLIs (`scripts/fetch-tools.mjs`).
  There is no download when `TRUSTABL_TOOLS_ARCHIVE_DIR` is set.
- **nodejs.org**, only when `make run` has to bootstrap Node.
- The CLIs' own **rules fetch** from the trustabl rules repository.
- **Probe's LLM endpoint** (`--model` / `--llm-url`).
- **Destinations reached by the tool under test**, from inside Probe's sandbox.

Sigstore signing is always off (`--no-sign`).

---

## 4. Components

### 4.1 Request Proxy — `src/proxy.ts`

This file is the Next.js 16 "proxy" (formerly middleware) and matches every
path. It is the only access control, because the Console runs commands on the
machine and has no login:

1. If the `Host` header is not `localhost`, `127.0.0.1` or `[::1]`, it answers
   **403**. This defeats DNS rebinding.
2. For any method other than GET or HEAD, the `Origin` header, when present,
   must be a local host with the same `host:port`. Without an `Origin`,
   `Sec-Fetch-Site` must be `same-origin` or `none`. Otherwise it answers
   **403**. This stops a web page you visit from posting to the Console.

The bind address (`-H 127.0.0.1`) is the other half of this protection. It is
set in `package.json`, the Makefile and `scripts/run.sh`.

### 4.2 Boot — `src/lib/server/boot.ts`, `src/instrumentation.ts`

`boot()` runs once per process. Its promise is memoized on `globalThis`, so a
dev-server reload does not repeat it. It is called from `instrumentation.ts`
at server start and again at the top of every route handler (`handler()` in
`src/lib/server/api.ts`). Boot does four things:

1. Opens the database and applies migrations (§7.2).
2. Calls `reapOrphans()`, which marks every `running` row with no live process
   as `interrupted` and kills what is left of its process group.
3. Calls `ensureRulesStatus()`, which refreshes the current rules SHA if it is
   older than 6 h. Setting `AGENT_DASHBOARD_NO_AUTORULES=1` skips this
   step; the parity test does.
4. Imports `actions/analyzer` and `actions/probe` for their side effect of
   registering run finalizers. Forge's finalizers are registered when boot
   imports `actions/forge`.

### 4.3 Web App — Next.js App Router (`src/app/`)

| Route | Page | Client component |
|-------|------|------------------|
| `/` | Overview | `(console)/OverviewClient.tsx` |
| `/forge` | Forge | `(console)/forge/ForgeClient.tsx` |
| `/analyzer` | Analyzer (+ SARIF import) | `(console)/analyzer/AnalyzerClient.tsx`, `ImportSarif.tsx` |
| `/probe` | Probe | `(console)/probe/ProbeClient.tsx` |
| `/repos/[id]` | Repo detail | `(console)/repos/[id]/RepoDetailClient.tsx` |

- `(console)/layout.tsx` wraps every page in `AppShell`
  (`src/components/patterns/AppShell.tsx`). The shell has the sidebar with
  exactly four nav items and the header with the repo count and rules SHA.
- The `page.tsx` files are thin server components. The work happens in the
  `*Client.tsx` client components. They read JSON from `/api/*` through
  `useApi()` (`src/lib/client/api.ts`), which is SWR with a 4 s refresh by
  default. Components override it per use: 0 to turn it off, 3 s, or 60 s for
  the runner status.
- `src/app/layout.tsx` loads Inter and Geist Mono from npm packages, never from
  Google Fonts. An inline script applies the stored theme, or else the
  OS preference, before first paint.
- A `?repo=<id>` query parameter on a tool page expands and outlines that
  repo's row.

### 4.4 API Route Handlers (`src/app/api/`)

Every handler except the SSE stream is wrapped in `handler()`
(`src/lib/server/api.ts`). `handler()` boots the server, then maps a thrown
error with a `status` field to that status, and anything else to a 500 with
the message.

| Method | Path | Handler → server code | Returns |
|--------|------|------------------------|---------|
| GET | `/api/status` | `tools.toolInfo`, `currentRules`, `listRepos`, `listRuns` | Console home, both CLIs (pinned, path, installed, reported version), rules SHA, repo count, running runs |
| GET | `/api/overview` | `queries/views.overviewView` | Overview tiles, filter counts, one row per repo |
| GET | `/api/repositories` | `repos.listRepos` or `views.reposWithFlags` (`?with=flags`) | Repos (+ has skill, Analyzer tool-file count) |
| POST | `/api/repositories` | `repos.addRepo` | 201, the new repo (`{path, create}`) |
| GET | `/api/repositories/[id]` | `views.repoDetail` | Overview row + projected readiness + full run list |
| DELETE | `/api/repositories/[id]` | `repos.removeRepo` | Removes the repo's DB rows only, never files |
| GET | `/api/runs` | `runner.listRuns` | Runs filtered by `repo_id`, `tool`, `status`, `limit` |
| POST | `/api/runs` | `actions.startToolRun` | 202, the new run (`RunRequest`) |
| POST | `/api/runs/preview` | `actions.previewCommand` | Command a Start would run (Copy CLI before a run) |
| GET | `/api/runs/[id]` | `runner.getRun`, `listArtifacts` | Run row + artifact kinds, sizes, SHA-256 |
| GET | `/api/runs/[id]/stream` | inline (SSE) | `log` events, then a final `status` event (§6.4) |
| GET | `/api/runs/[id]/log` | reads `output.log` | Whole log as plain text, ANSI stripped |
| POST | `/api/runs/[id]/cancel` | `runner.cancelRun` | 409 if not running or not owned by this process |
| GET | `/api/export` | `runner.listArtifacts` | Artifact bytes as written (`?run_id&kind`, `&inline=1`), `X-Artifact-SHA256` |
| GET | `/api/scans` | `views.analyzerView` | Analyzer tiles and per-repo scans (`?include_tests=1`) |
| POST | `/api/scans/import` | `actions/analyzer.importSarif` | 201, run ID of the recorded import (multipart: `file`, `repo_id` or `path`) |
| GET | `/api/findings` | `views.allFindings` | Findings with status (`?status=open\|resolved\|introduced\|all`) |
| GET | `/api/forge` | `views.forgeView` | Per-repo skill, stamp, OTel in skill, forge check |
| GET | `/api/forge/categories` | `actions/forge.policyCategories` | `--policy` categories parsed from `trustabl scan --help` |
| POST | `/api/forge/check-all` | `actions/forge.recheckAllSkills` | 202, number of checks started |
| GET | `/api/forge/skill` | `actions/forge.skillPath` | The repo's on-disk `SKILL.md` (`?repo_id`, `&download=1`) |
| GET | `/api/forge/runs/[id]` | `actions/forge.skillCandidate` | Generated vs on-disk skill, diff, Copy CLI |
| POST | `/api/forge/runs/[id]` | `actions/forge.applySkill` | Writes the skill into the repo, then runs `forge check` |
| DELETE | `/api/forge/runs/[id]` | `actions/forge.discardSkill` | Marks the candidate discarded |
| GET | `/api/probe` | `views.probeView` | Per-repo grant set, last run, egress, draft, flags |
| GET | `/api/preflight` | `actions/probe.checkRunner`, `llmKeyEnv` | Runner reachable + fix, names of the LLM key variables that are set |
| GET | `/api/rules` | `actions/forge.currentRules` | Current rules SHA setting |
| POST | `/api/rules` | `ensureRulesStatus(0)` | 202. Re-resolves the SHA now. A change re-runs `forge check` everywhere. |

`/api/rules` refreshes the current rules SHA. It is not a rule catalog: the
open-source CLI has no catalog API.

### 4.5 Actions — CLI Wrappers (`src/lib/server/actions/`)

There is one module per tool. Each exports:

- a `*Run(repo, options)` function that returns a `StartRunInput`: tool,
  action, repo, binary, options to store, and a `build({id, dir})` callback
  that writes input files into the run folder and returns the argv;
- a `*Preview()` function that returns the same command without side effects,
  for Copy CLI;
- a finalizer, registered with `registerFinalizer(action, fn)`, that reads the
  artifacts after the process exits.

`actions/index.ts` is the single entry point for routes. `startToolRun()`
resolves the repo, or registers a new local path. For Probe it validates the
inputs and checks the runner before starting. `previewCommand()`
builds the same command without registering anything.

| Module | Actions | Finalizer writes |
|--------|---------|------------------|
| `analyzer.ts` | `scan`; `importSarif()` (no subprocess) | `findings` rows, artifacts `scan.json` + `trustabl.sarif`, summary (open, severity, introduced, resolved, readiness, OTel, SDKs…), `rules_sha` ← `scan.rules_version` |
| `forge.ts` | `generate`, `check`, `rules-status` | `generate`: artifact `SKILL.md`, stamp, pending flag. `check`: upsert `skills`. `rules-status`: `settings['rules.current']`, and if the SHA changed, `recheckAllSkills('rules-update')` |
| `probe.ts` | `probe`; `checkRunner()`; `llmKeyEnv()` | Artifacts `probe.profile.json`, `probe.findings.json`, `network_policies.draft.yaml`, `autofix-attestation.json` (if present); summary (egress, flags, draft state, cache, runner, skipped write tools) |

### 4.6 Run Engine — `src/lib/server/runner.ts`

The run engine owns every CLI process. The browser never does.

- **Start** (`startRun`):
  1. Refuses with **409** (`ConflictError`) when the same repo and tool already
     has a `running` row.
  2. Checks that the pinned binary is installed.
  3. Creates `runs/<id>/` (ID format `YYYYMMDDTHHMMSS-xxxxxxxx`) and calls the
     action's `build`.
  4. Records `git rev-parse HEAD` as `commit_sha`.
  5. Inserts the row with status `running`.
  6. Writes `command.sh`.
  7. Spawns the process **detached in its own process group**, with
     `XDG_CACHE_HOME=<home>/cache` and `NO_COLOR=1`.
- **Logging**: stdout and stderr are appended to `stdout.log` and `stderr.log`.
  Both are also appended to `output.log` in arrival order. `stdin` gets the
  action's text (Probe: `q\n`) and is then closed.
- **Finish**: on `close`, the engine runs the action's finalizer, or uses
  exit 0 → `succeeded`. A cancelled run becomes `cancelled`, and a spawn error
  becomes `failed`. A failed run with no error text gets the last 15 lines of
  stderr (else stdout) via `failureText()`. Then it updates `status`,
  `exit_code`, `error`, `summary`, `rules_sha` and `finished_at`, and calls the
  `onRunFinished` hooks. Nothing registers such a hook yet.
- **Cancel** (`cancelRun`): SIGTERM to the process group, then SIGKILL after
  5 s. This works only for runs this process started; the live map is held in
  memory.
- **Restart**: on boot, `reapOrphans()` marks every remaining `running` row
  `interrupted`, with the reproducing command.
- **Recorded runs**: `recordRun` and `finishRecordedRun` create and close a run
  row that has no subprocess. SARIF import uses them.

The finalizer, live-process and hook maps are kept on `globalThis` so they
survive Next.js module reloads in `make dev`.

### 4.7 Short Commands — `src/lib/server/exec.ts`, `git.ts`, `tools.ts`

`execCapture()` runs a short command and captures its output, with a 30 s
default timeout and SIGKILL when it expires. It is used for:

- `git rev-parse HEAD`, `git status --porcelain` and
  `git remote get-url origin` (`git.ts`);
- `<tool> version` (`tools.ts`);
- `docker info` and `openshell sandbox list` (`actions/probe.checkRunner`);
- `trustabl scan --help` (`actions/forge.policyCategories`).

`tools.ts` resolves the pinned binary path from `tools.lock.json`. It caches
the reported version per binary path. `TRUSTABL_BIN` / `AUTOFIX_BIN` override
the path, for development only.

### 4.8 View Models — `src/lib/server/queries/`

- `scans.ts` provides Analyzer run history (`scansForRepo`, successful `scan`
  and `import` runs, oldest first), previous-scan findings, and artifact
  readers. JSON artifacts are cached by file `mtime`.
- `views.ts` builds the page payloads: `overviewView`, `analyzerView`,
  `allFindings`, `forgeView`, `probeView`, `repoDetail` and `reposWithFlags`.
  Each one combines DB rows, artifacts read from run folders, the on-disk
  `SKILL.md`, and the pure derivations in `src/lib/*.ts`. Nothing here is
  stored. Finding status, OTel state, draft state and staleness are recomputed
  on every request.

### 4.9 Pure Libraries — `src/lib/*.ts`

These modules have no I/O, so the unit tests can cover them against recorded
real CLI output.

| File | Responsibility |
|------|----------------|
| `findings.ts` | Severity order and ranking, open counts (info/META and test-path excluded), readiness, OTel state, scan diff → open / introduced / resolved, rulebook URL, "Copy for Cursor" text |
| `forge.ts` | Parse the SKILL.md stamp, outline the skill (OTel encoded / partial / none), parse `forge check` output, detect "no SDK" |
| `probe.ts` | Flags from evidence `source` and stderr, unique egress, cache state, draft parsing, guard deny list, forbidden draft entries, list evaluation, draft state incl. "withheld" |
| `shell.ts` | POSIX quoting and `formatCommand()`, which produces every Copy CLI string |
| `text.ts`, `time.ts` | ANSI stripping, tails, short SHAs, plurals; relative and absolute times |
| `types.ts` | Run rows and the shapes of `scan.json`, `probe.profile.json` and `probe.findings.json` |

### 4.10 Components (`src/components/`)

- `ui/` holds the design-system components and their `globals.css` tokens.
  The contrast and focus overrides at the end of `globals.css` bring both
  themes to WCAG 2.1 AA.
- `patterns/` holds the `AppShell` (sidebar + header), `BrandMark` and
  `EmptyState`.
- `console/` holds the Console's own building blocks:
  - `RunDialog`, the single "Run a local tool" dialog, with a focus trap;
  - `RunLog`, the live log through `EventSource`;
  - `RunHistory`, `CopyCli` and `ArtifactViewer`;
  - `SkillReview`, which shows the diff and asks to confirm before Forge writes;
  - table, cell, form and primitive helpers.

---

## 5. Scanning Engines — Sidecar Integration

### 5.1 Why CLI Subprocess (Sidecar Pattern)

The engines are separate open-source projects written in Go. The Console is a
Node app, and the brief forbids modifying the CLIs. So the Console runs the
**released binaries as subprocesses**, through `child_process.spawn` with an
argv array, never through a shell. The contract with each CLI is:

- **Input**: flags, a working directory, files the Console writes into the run
  folder, and environment variables.
- **Output**: artifact files written to paths the Console passes, plus the exit
  code. stdout and stderr are logged for people to read. Code parses them only
  where the CLI writes no file:
  - `forge check` verdicts;
  - forge's "no SDK" message;
  - Probe's "Broad allow-list entries detected" warning.
- **Reproducibility**: every run stores the exact command (`runs.command`,
  `command.sh`), with the pinned binary's absolute path. The parity
  test re-runs that command in a plain shell and expects the same artifacts.

### 5.2 Analyzer and Forge Engine (`trustabl` binary)

**Source**: `github.com/trustabl/agent-reliability-analyzer` (open source, do not modify)
**Pinned**: 0.1.15 (`tools.lock.json`)

| Action | Invocation (cwd = repo unless noted) |
|--------|--------------------------------------|
| Scan | `trustabl scan <repo> --json-out <run>/scan.json --sarif-out <run>/trustabl.sarif --no-color` |
| Generate skill | `trustabl forge <repo> [--policy a,b] [--lang python,typescript,go] [--rules-ref <ref>] -o <run>/SKILL.md` |
| Write skill (confirmed) | No CLI call: the Console copies `<run>/SKILL.md` to `<repo>/.claude/skills/trustabl-pre-coding/SKILL.md`, then runs a check |
| forge check | `trustabl forge check <repo>/.claude/skills/trustabl-pre-coding/SKILL.md [--rules-ref <ref>]` |
| Rules SHA | `trustabl forge --policy claude_skill -o <run>/rules-probe.SKILL.md`, cwd = `<run>/empty` |
| Version | `trustabl version` |
| Policy categories | `trustabl scan --help` (the `--detectors` line) |

- **Exit codes, scan**: 0 is clean and 1 means findings of medium or higher.
  Both count as a successful scan. Any other code fails the run
  (`finalizeScan`).
- **Exit codes, forge check**: pass, stale, unstamped, missing or error,
  parsed by `parseForgeCheck` in `src/lib/forge.ts`.
- **Rules cache**: the CLI keeps its rules cache under `XDG_CACHE_HOME`, which
  is `<home>/cache` on Linux and WSL. macOS ignores XDG and uses
  `~/Library/Caches/trustabl`. `make wipe` removes both.
- **Rules SHA mismatch**: `scan` may report a signed bundle digest in
  `rules_version` instead of a git SHA, so each run keeps its own SHA. The
  header shows the SHA forge would stamp now.

### 5.3 Probe Engine (`autofix` binary)

**Source**: `github.com/trustabl/agent-network-access-probe` (open source, do not modify)
**Pinned**: 0.2.2 (`tools.lock.json`)

Every Probe run is a class run inside a sandbox. That way the user's repo is
never written to:

```bash
printf '%s\n' q | autofix fix \
  --class <run>/class.yaml --sandbox --runner <docker|openshell> \
  --output-dir <run>/out --no-sign --model <model> [--llm-url <url>] \
  [--allow-list <run>/allow-list.txt] [--platform-allow-list <run>/platform-allow-list.txt] \
  --deny-list <run>/deny-list.txt [--env-fixtures <run>/env-fixtures.env] \
  [--allow-write-tools] [--no-cache] [--sandbox-args '<args>']
```

| Input the Console writes | Why |
|--------------------------|-----|
| `class.yaml` | Analyzer grant set: one member per file holding a tool in the latest `scan.json` `tools[]`. Draft agent: the repo root, entrypoints auto-detected. Class name = slug of the repo folder. |
| `deny-list.txt` | The user's entries + `0.0.0.0` and `::`, the guard |
| `out/` | autofix does not create `--output-dir` itself |
| `env-fixtures.env` | Written with mode 0600. Its contents are never stored in the DB (`options.envFixtures = '(provided)'`). |
| stdin `q` | Quits the interactive fix review without applying anything |

The Console enforces these rules:

- **`--no-sign`** is always passed.
- **`--allow-write-tools`** is refused unless the person confirmed the
  production-keys warning (`confirmWriteTools`).
- **`--sandbox-args`** may not contain shell metacharacters.
- **The runner** is checked before every Start (`docker info` /
  `openshell sandbox list`). If it is unreachable, the refusal includes the
  fix.
- **LLM keys** are passed only through the environment the Console was started
  in (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_API_KEY`). They are never
  stored. Only the variable names are shown.
- **Drafts**: after the run, the draft is re-checked. It is withheld if it
  lists metadata, link-local or any-address destinations, or a CIDR of /8 or
  wider. It is also withheld when the allow list was broad.

**Copy CLI before a run**: `standaloneCommand()` emits one paste-able
command. It writes the same files into `mktemp -d` and then runs the identical
argv. Fixture values come from `$ENV_FIXTURES`, and a missing model comes from
`$PROBE_MODEL`.

### 5.4 Engine Binary Management

- **`tools.lock.json`** pins each tool's version, release repo, archive name
  template and the SHA-256 of every `darwin` / `linux` × `amd64` / `arm64`
  archive. Version and hashes are bumped together (CONTRIBUTING.md, "Bumping a
  pinned CLI").
- **`scripts/fetch-tools.mjs`**:
  - downloads
    `https://github.com/<repo>/releases/download/v<version>/<archive>`, using
    curl when present, else `fetch`;
  - **refuses any archive whose SHA-256 differs**;
  - extracts only the binary into `<home>/bin/<tool>-<version>/` and writes a
    `SHA256` file next to it.

  `--force` re-downloads. Windows is not supported.
- **Offline**: `TRUSTABL_TOOLS_ARCHIVE_DIR=<folder>` copies the archives from
  that folder instead of downloading them. The same hashes are checked.
- **Version check**: `/api/status` reports both the pinned version and the
  version the binary itself reports. Each run row stores the reported version
  (`tool_version`).

---

## 6. Request Flows

### 6.1 One-Command Start (`make run` → `scripts/run.sh`)

```
1. AGENT_DASHBOARD_HOME (default ~/.agent-dashboard), mkdir + chmod 700
2. Node >= 22.13 on PATH?  no → download Node 22.22.0 + SHASUMS256.txt from
   nodejs.org, verify, unpack into <home>/node/
3. npm ci when sha256(package-lock.json)+platform differs from node_modules/.lock-sum
4. node scripts/fetch-tools.mjs            (§5.4)
5. next build when scripts/source-sum.mjs differs from .next/.src-sum
6. exec next start -H 127.0.0.1 -p ${AGENT_DASHBOARD_PORT:-4317}
7. instrumentation.ts → boot()             (§4.2)
```

### 6.2 Add a Repo / Start Any Run

```
1. Browser: RunDialog → POST /api/runs/preview  { tool, action?, repoId | path, options }
            → Copy CLI text (no side effects)
2. Browser: Start → POST /api/runs  (same body)
3. proxy.ts: Host + Origin checks
4. actions.startToolRun:
     path given → repos.addRepo (normalize ~, must be absolute; create only
                  when `create` is set; name = origin owner/name or folder)
     probe      → validate options, checkRunner → 400 with the fix if unreachable
5. runner.startRun → 409 if the same repo+tool is running; spawn (§4.6)
6. 202 { run }  — the browser opens RunLog on /api/runs/<id>/stream
```

### 6.3 Analyzer Scan and SARIF Import

```
Scan:
  argv: trustabl scan <repo> --json-out … --sarif-out … --no-color
  finalizeScan:
    exit ∉ {0,1}            → failed (error = log tail)
    no scan.json            → failed
    record artifacts scan.json, trustabl.sarif (path, bytes, sha256)
    insert one findings row per finding, fingerprint = sha256(rule_id|file_path|tool_name)
    summary: diff against previous successful scan/import of the repo
             (introduced / resolved; first scan has no "introduced")
    rules_sha ← scan.rules_version

SARIF import (POST /api/scans/import, multipart, ≤ 50 MB):
  recordRun(action 'import', status running, command = the equivalent
            `trustabl scan <repo> --format sarif -o <file>`)
  parseTrustablSarif: SARIF 2.1.0, driver.name must be "trustabl";
    fingerprint taken from partialFingerprints.primaryLocationLineHash
  same insertFindings + summary → finishRecordedRun(succeeded | failed)
```

### 6.4 Live Progress (SSE)

```
GET /api/runs/<id>/stream            (text/event-stream)
  loop every 300 ms, up to 2 h:
    read output.log from the last offset → event: log  {text}  (ANSI stripped)
    run no longer 'running'              → final drain, event: status <RunRow>, close
    else                                 → ": ping" comment
Browser: RunLog.tsx EventSource; on 'status' it refreshes all SWR data.
```

The stream always replays the log from offset 0, so any tab can re-attach. A
disconnect ends only the stream, never the run.

### 6.5 Forge: Generate → Confirm → Check

```
1. POST /api/runs {tool:'forge', action:'generate', options:{policy, lang, rulesRef}}
   options sanitized: policy ∈ [a-z_]+, lang ∈ python|typescript|go, rulesRef ∈ [\w./-]+
2. finalizeGenerate:
     no SKILL.md + "no SDK" on stderr → failed, summary.needsPolicy + categories
     else artifact SKILL.md, stamp, pending = (differs from the on-disk skill)
3. GET  /api/forge/runs/<id>  → candidate, existing, unified diff (SkillReview)
4. POST /api/forge/runs/<id>  → copy into <repo>/.claude/skills/trustabl-pre-coding/SKILL.md
                               → start forge check (trigger 'after-write')
   DELETE                     → discard (nothing written)
5. finalizeCheck: upsert skills(repo_id) with pass|stale|unstamped|missing|error
```

### 6.6 Rules SHA Refresh

```
boot (if older than 6 h) or POST /api/rules (always)
  → no rules-status run already running? start one (repo_id NULL)
  → finalizeRulesStatus: parse the stamp's rules SHA → settings['rules.current']
  → SHA changed since last time → recheckAllSkills('rules-update'):
       forge check on every repo whose SKILL.md exists
```

Rules-status runs belong to no repo. The Overview run log is the only place
that shows them.

### 6.7 Probe Run

```
1. GET /api/preflight?runner=…  (page load, every 60 s, and in the dialog)
2. POST /api/runs {tool:'probe', options:{grantSet, runner, model, …}}
   → validate → checkRunner → startRun → build writes class.yaml, lists, out/
3. autofix runs in Docker/OpenShell; stdin 'q'
4. finalizeProbe:
     record artifacts from <run>/out
     no probe.profile.json → failed
     flags  = evidence sources + stderr broad-allow warning
     draft  = drafted | not drafted | withheld (guard / broad allow) …
     status = exit 0 → succeeded, else failed
5. /api/probe: "untested" = the current Analyzer grant set (toolSetKey) has no
   successful Probe run
```

### 6.8 Cancel and Restart

```
POST /api/runs/<id>/cancel → SIGTERM -pgid → 5 s → SIGKILL → status cancelled
Server stops mid-run      → next boot: reapOrphans → SIGKILL pgid, status interrupted
```

---

## 7. Data Layer

### 7.1 Where State Lives

All state is under `$AGENT_DASHBOARD_HOME`, which defaults to
`~/.agent-dashboard` (`src/lib/server/paths.ts`). Directories are created
with mode 0700.

| Path | Contents |
|------|----------|
| `console.db` (+ `-wal`, `-shm`) | SQLite database (§7.2) |
| `runs/<id>/` | `command.sh`, `stdout.log`, `stderr.log`, `output.log`, the inputs the Console wrote, and the artifacts the CLI wrote |
| `bin/<tool>-<version>/` | Pinned binaries + `SHA256` |
| `cache/` | `XDG_CACHE_HOME` for the CLIs (rules, Probe result cache) on Linux/WSL |
| `node/` | Private Node.js, only when `make run` had to install it |
| `tmp/` | Defined in `paths.tmp()`. No current caller. |

Artifacts are files on disk. The `artifacts` table only indexes them, by path,
size and SHA-256. `/api/export` serves the bytes unchanged, so downloads match
the CLI's output byte for byte.

### 7.2 SQLite Schema

The driver is Node's built-in `node:sqlite` (`DatabaseSync`). It needs Node
22.13 or newer and no native build. The pragmas are `journal_mode=WAL`,
`foreign_keys=ON` and `busy_timeout=5000`. There is one connection per
process, kept on `globalThis`.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `repos` | A local folder the user registered | `id` (UUID), `path` UNIQUE, `name` (origin `owner/name` or folder), `created_at` |
| `runs` | Every run, including SARIF imports and rules-status runs | `id`, `repo_id` (NULL for rules-status), `tool` (forge\|analyzer\|probe), `action` (generate\|check\|rules-status\|scan\|import\|probe), `status` (running\|succeeded\|failed\|cancelled\|interrupted), `argv` JSON, `command`, `cwd`, `tool_version`, `commit_sha`, `rules_sha`, `exit_code`, `pid`, `error`, `options` JSON, `summary` JSON, `started_at`, `finished_at` |
| `artifacts` | Index of files a run produced | `run_id`, `kind` (file name), `path`, `bytes`, `sha256`; UNIQUE(`run_id`, `kind`) |
| `findings` | One row per finding per Analyzer scan or import | PK (`run_id`, `fingerprint`), `repo_id`, `rule_id`, `category`, `scope`, `severity`, `confidence`, `title`, `explanation`, `suggested_fix`, `tool_name`, `file_path`, `start_line`, `end_line`, `origin` |
| `skills` | Latest `forge check` result per repo | `repo_id` PK, `check_status`, `check_detail` JSON, `check_run_id`, `checked_at` |
| `settings` | Key → JSON value | `rules.current` = `{sha, schema, template, checkedAt, runId}`. Never API keys. |
| `schema_version` | Migration counter | `version` |

Indexes: `runs_repo (repo_id, tool, started_at)` and `findings_repo (repo_id)`.
Deleting a repo cascades to its runs, artifacts index, findings and skill row.
Files on disk are not touched.

Timestamps are epoch milliseconds. The stamp, outline and OTel state of a
skill are not stored. They are read from the `SKILL.md` on disk on every
request.

### 7.3 Migrations

`MIGRATIONS` in `src/lib/server/db.ts` is an ordered array of SQL strings.
On connect, `db()` applies every entry past `schema_version.version` and
records the new version. Rules:

- Never edit a migration that has shipped. Append a new array entry.
- Use `IF NOT EXISTS` / `IF EXISTS` so a half-applied migration can be re-run.
- Derived state (finding status, staleness, draft state) is never stored as
  truth. It is recomputed from runs and artifacts.

### 7.4 Wipe

`make wipe` runs `scripts/wipe.sh`, which asks before deleting.
`WIPE_YES=1 make wipe` skips the prompt. It deletes `$AGENT_DASHBOARD_HOME`
and, on macOS, `~/Library/Caches/trustabl` and
`~/Library/Caches/trustabl-probe`. Repos and any `SKILL.md` written into them
are left alone.

---

## 8. Engineering Conventions

### 8.1 Layering

```
src/app/(console)/*Client.tsx   ← UI; data only through /api/* (lib/client/api.ts)
src/app/api/**/route.ts         ← thin: parse request → lib/server → json()
src/lib/server/actions/         ← build argv, write run inputs, finalize outputs
src/lib/server/queries/         ← read-only view models
src/lib/server/{runner,db,…}    ← engine, storage, process helpers
src/lib/*.ts                    ← pure functions shared by server and client
```

- Client code never imports `src/lib/server/`.
- Routes contain no business logic.
- Parsers live in `src/lib/*.ts`, where they can be tested against recorded
  output.

### 8.2 Never Invent Data

Every value on screen comes from a CLI artifact, CLI output, or the Console's
run history. If the design shows something no pinned CLI produces:

1. render `<Unavailable what="…" />` ("… n/a");
2. open an issue on the CLI's repo.

Do not change the CLIs from this repo (CONTRIBUTING.md).

### 8.3 Subprocess Invocation

- Always use `spawn(bin, args)` with an argv array, never a shell string. Pass
  user input as single argv elements or as files in the run folder.
- Long runs go through `runner.startRun` (detached process group, logged,
  cancellable). Short probes use `execCapture` with a timeout.
- Every run needs a Copy CLI command. Build it with `formatCommand()`, or with
  `standaloneCommand()` for a Probe run that has not happened yet. The command
  must reproduce the same artifacts. The parity test enforces this.
- Never write into the user's repo, except Forge's confirmed `SKILL.md`
  write. Probe always uses `--class` and `--output-dir <run>/out`.
- Never store secrets: env fixture contents, API keys. Only variable names
  appear in the UI or the DB.
- Validate options on the server (`sanitizeForgeOptions`, Probe `validate`).
  Throw `InputError` (400) or `ConflictError` (409).

### 8.4 Error Handling

- Server errors carry an HTTP status on the error object. `handler()` turns
  them into `{ error }` JSON. A 5xx is logged with the `[agent-dashboard]`
  prefix. The full message reaches the browser, because the person reading it
  runs the machine.
- A failed run stores human-readable `error` text: the finalizer's message, or
  the tail of the log. It also stores the command that reproduces the failure.
- `onRunFinished` hooks never fail a run. Their exceptions are swallowed.

### 8.5 Process-Wide State

The DB connection, the boot promise, the finalizer and live-process maps, and
the after-run hooks are kept on `globalThis` (`__trustabl*`). A Next.js dev
reload replaces modules without losing them. Add new singletons the same way.

### 8.6 UI

- Use the tokens in `src/app/globals.css` and the `components/ui`
  components.
- Fonts are bundled from npm. Nothing is loaded at runtime from a CDN.
- The theme is the stored choice, else the OS preference. Light and dark are
  both first-class.

### 8.7 Configuration

| Variable | Effect |
|----------|--------|
| `AGENT_DASHBOARD_HOME` | State directory (default `~/.agent-dashboard`) |
| `AGENT_DASHBOARD_PORT` | Port for `make run` / `make dev` (default 4317) |
| `TRUSTABL_TOOLS_ARCHIVE_DIR` | Install the CLIs from local archives (offline) |
| `TRUSTABL_BIN`, `AUTOFIX_BIN` | Development override of the binary path |
| `AGENT_DASHBOARD_NO_AUTORULES=1` | Skip the rules-SHA refresh at boot |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_API_KEY` | Passed through to Probe, never stored |
| `PARITY_HOME`, `E2E_PORT`, `PLAYWRIGHT_CHROMIUM_PATH` | Tests only |

### 8.8 Commits

Commits are small, one step each, with no `Co-Authored-By` lines.

---

## 9. Security and Local-Only Posture

- **No auth, by design.** The protection is binding to `127.0.0.1` plus
  `proxy.ts` (Host allow-list, same-origin writes). Never add a listener on
  another interface. CI checks that the LAN IP does not answer.
- **Source stays local.** `trustabl` reads the repo in place. Probe sends tool
  source only to the configured LLM endpoint. `--no-sign` keeps Sigstore
  traffic off.
- **Downloads are verified.** The CLIs are checked against SHA-256 in
  `tools.lock.json` (§5.4). Bootstrapped Node is checked against nodejs.org's
  `SHASUMS256.txt`. Extraction uses `tar --no-same-owner` and extracts the
  binary only.
- **Drafts are guarded.** Any-address entries are added to every deny list,
  and every draft is checked after the run. Metadata, link-local,
  `0.0.0.0/0` and broad CIDRs are never presented as a draft.
- **Side effects are opt-in.** `--allow-write-tools` needs explicit
  confirmation, with a warning against production keys.
- **Secrets.** Env fixtures are written 0600 in the run folder and never put
  into the DB. API keys are read from the environment only.
  `make secrets` runs gitleaks over the full history, and CI runs the same
  job.
- **Dependencies.** `make audit` (`npm audit --omit=dev --audit-level=high`)
  fails on runtime advisories. The dev-only `braces` advisory is accepted.

---

## 10. Accessibility and Testing

### 10.1 Accessibility

The target is WCAG 2.1 AA in both themes:

- **axe-core** runs inside Playwright on every screen in dark and light
  (`tests/e2e/0-a11y-empty.spec.ts`, `zz-a11y.spec.ts`).
- **Keyboard spec** (`zz-keyboard.spec.ts`): skip link, visible focus, dialog
  focus trap and Escape, row expand.
- **Reflow check**: no page-level horizontal scroll at 320px.
- **Contrast**: a 2px accent focus ring (`--color-focus-ring`) and 3:1 form
  field borders (`--color-border-control`).
- **Native controls**: the Overview filter is a native `<select>`.

### 10.2 Test Suites

| Command | Suite | What it proves |
|---------|-------|----------------|
| `make test` | Vitest (`tests/unit/lib`, `tests/unit/components`) | Parsers and derivations against recorded real CLI output (`tests/fixtures/cli/`); page components against recorded view models (`tests/fixtures/views/`) |
| `make e2e` | Playwright (`tests/e2e/`) | `tests/e2e/setup.mjs` makes a fresh home in `tests/.tmp/home` and git-initialised copies of `tests/fixtures/repos`. A real `next build` + `next start` on port 4318 runs with the real pinned CLIs. One spec per page, plus the a11y, keyboard and reflow specs. Probe cases skip when Docker is down. |
| `make parity` | Vitest (`tests/parity/parity.test.ts`) | Each tool runs through the Console's run engine, then the run's recorded command runs in a plain shell. The artifacts must match, with timestamps and Probe's harness ID masked. |
| `make check` | lint + `tsc --noEmit` + unit | — |
| `make secrets`, `make audit` | gitleaks, npm audit | §9 |

When a pinned CLI is bumped, re-record `tests/fixtures/cli/` and
`tests/fixtures/views/`. Don't edit them by hand (CONTRIBUTING.md).

### 10.3 CI (`.github/workflows/ci.yml`)

| Job | Steps |
|-----|-------|
| `secrets` | gitleaks 8.18.4 over the full history |
| `checks` | Node 22.22.0, `npm ci`, `make audit`, `make lint`, `make typecheck`, `make test` |
| `e2e` | After `checks`: pre-pull `python:3-slim`, `make parity`, `make e2e`; upload the report on failure |
| `one-command-start` | ubuntu + macOS. `make run` with a fresh home, then wait for `/api/status` and assert both CLIs are installed. Assert the server is not reachable on the LAN IP. `WIPE_YES=1 make wipe` must remove the home. |

---

## 11. Future Work (Not Yet Built)

None of these are in the current implementation.

- **Public repo and green CI**: push to `github.com/trustabl/agent-dashboard`
  and run the workflow on `main`. It has only run locally so far.
- **WSL2 verification**: `make run` on a clean WSL2 machine, timed against the
  README's first-run claim.
- **Owner design review**: of every screen, light and dark.
- **Upstream CLI gaps**, to adopt in the Console when the CLIs
  provide them:
  - a stable agent ID;
  - one rules SHA across `scan` and `forge`;
  - IDE and model detection;
  - Probe telling the model-client host apart from tool egress;
  - named egress flags;
  - a static-only Probe class run;
  - a non-interactive fix review;
  - `--output-dir` creation;
  - Probe cache keys;
  - "checks that ran clean" reporting.
- **Patched `braces`**: drop the dev-only advisory exception when a fixed
  version ships.
