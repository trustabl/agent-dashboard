# Trustabl Console

A local, single-user web UI for Trustabl's open-source tools. You can run
**Forge**, **Analyzer** and **Probe** on your own repos from one app, without
installing any of them.

| Page | Wraps | Commands |
| --- | --- | --- |
| Overview | all of the below | — |
| Forge | [agent-reliability-analyzer](https://github.com/trustabl/agent-reliability-analyzer) | `trustabl forge`, `trustabl forge check` |
| Analyzer | agent-reliability-analyzer | `trustabl scan` |
| Probe | [agent-network-access-probe](https://github.com/trustabl/agent-network-access-probe) | `autofix fix` |

- Runs on `127.0.0.1` only. There is no login and no user or org model.
- Pinned CLIs: `trustabl` 0.1.14 and `autofix` 0.2.2. They are downloaded on
  first start and their SHA-256 is checked (`tools.lock.json`).
- Your source code stays on your machine. Probe sends tool source only to the
  LLM endpoint you configure.

## First run (≈ 5 minutes)

[![CI](https://github.com/trustabl/trustabl-console/actions/workflows/ci.yml/badge.svg)](https://github.com/trustabl/trustabl-console/actions/workflows/ci.yml)

Requirements: macOS, Linux or WSL2, with `git`, `curl`, `tar` and `make`.
You need Node.js 22.13 or newer; if you don't have it, `make run` installs a
private copy. To run Probe you also need Docker (or OpenShell) and an
OpenAI-compatible LLM endpoint, for example Ollama.

```sh
git clone https://github.com/trustabl/trustabl-console.git
cd trustabl-console
make run            # or: ./scripts/run.sh
```

Open http://127.0.0.1:4317 and click **Generate skill**, **Scan repo** or
**Run Probe**. Pick **New local path — agent not built**, enter a folder (for
example `~/src/my-agent`) and click **Start**. The output streams live. The run
keeps going if you close the tab, and you can cancel it at any time. Every run
has **Copy CLI**, which copies the exact command to run in a terminal.

For Probe with a local model:

```sh
ollama serve & ollama pull qwen2.5-coder:32b
# in the dialog: --model qwen2.5-coder:32b, --llm-url http://localhost:11434/v1
```

Cloud models read their key from `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or
`LLM_API_KEY` in the environment you start the Console from. The Console never
stores keys.

## Where state lives, and how to wipe it

All state is under `~/.trustabl-console` (override with
`TRUSTABL_CONSOLE_HOME`):

| Path | What |
| --- | --- |
| `console.db` | Repos, run history, findings (SQLite) |
| `runs/<id>/` | Each run's command, output and artifacts (`scan.json`, `trustabl.sarif`, `SKILL.md`, `probe.*.json`, `network_policies.draft.yaml`) |
| `bin/` | Pinned CLIs |
| `cache/` | The CLIs' rule and Probe result caches (Linux/WSL) |

```sh
make wipe           # asks first; WIPE_YES=1 make wipe to skip the prompt
```

This deletes everything above. On macOS it also deletes the CLIs' caches in
`~/Library/Caches/trustabl*`. Your repos are not touched, and neither is any
`SKILL.md` you chose to write into them.

## Development

```sh
make dev            # hot reload on 127.0.0.1:4317
make check          # eslint + tsc + vitest
make e2e            # Playwright against tests/fixtures/repos (Probe cases need Docker)
make parity         # artifacts from a Console run == the same CLI run (timestamps masked)
make secrets        # gitleaks, as in CI
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture
(components, API routes, run engine, data layer, conventions).
Contributions: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
