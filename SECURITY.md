# Security Policy

## Reporting a vulnerability

Report privately through GitHub, not in a public issue:

**[Open a private security advisory](https://github.com/trustabl/agent-dashboard/security/advisories/new)**

That route is private between you and the maintainers until a fix ships. Please
do not open a public issue, a pull request, or a discussion for a suspected
vulnerability.

Useful things to include: the commit you ran (`git rev-parse --short HEAD`), the
platform, the browser if it matters, the smallest steps that reproduce it, and
what you expected instead. A proof of concept is welcome but not required.

We aim to acknowledge a report within three working days, and to tell you
whether it is in scope within a week. If we accept it, we will keep you updated
through the advisory and credit you in it unless you would rather we did not.

## Supported versions

There are no releases yet. Fixes land on `main`; pull the latest `main` before
reporting.

## Scope

Agent Dashboard is a local, single-user web UI. It listens on `127.0.0.1` only,
has no login, and runs pinned open-source CLIs (`trustabl`, `autofix`) as
subprocesses on repositories you point it at. Because it runs commands on your
machine, the boundary that matters most is who can make it do so.

**In scope**

- A web page you visit, or any host other than `localhost`, getting the
  dashboard to start a run or change state: bypassing the Host and Origin checks
  in `src/proxy.ts`, DNS rebinding, or cross-site requests
- The server answering on anything other than the loopback interface
- Command or argument injection through a repository path, a repository's
  contents, or CLI output
- Reading or writing files outside the dashboard's home (`~/.agent-dashboard`)
  and the repository a run was started on, for example through the artifact
  viewer or downloads
- Script injection in the browser from rendered CLI output or repository content
  (finding text, `SKILL.md`, file and tool names)
- Installing a CLI that does not match the SHA-256 in `tools.lock.json`
- An LLM API key ending up anywhere but the environment: the database, run logs,
  artifacts, process arguments, or the browser
- Source code leaving the machine during a scan or a Forge run, or Probe sending
  it anywhere other than the LLM endpoint you configured
- A Probe sandbox policy written by the dashboard that allows more network
  access than it reports

**Out of scope**

- **A missed finding or a false positive is a bug, not a vulnerability.** Open a
  normal issue on
  [agent-reliability-analyzer](https://github.com/trustabl/agent-reliability-analyzer)
- Vulnerabilities in the CLIs themselves. Report those to
  [agent-reliability-analyzer](https://github.com/trustabl/agent-reliability-analyzer/security)
  or [agent-network-access-probe](https://github.com/trustabl/agent-network-access-probe/security)
- Escapes from Docker or OpenShell themselves. Those belong to their projects
- Vulnerabilities in a repository you scanned. Those belong to that repository
- Anything that needs an attacker who can already run code as your user. There
  is no login by design, so any local process can reach the dashboard, just as
  it could run the CLIs directly
- Reports produced only by an automated scanner, with no demonstrated impact

## Probe uses your own key and endpoint

Analyzer and Forge runs never need a network connection beyond the one-time CLI
download and the rules they fetch. Probe is opt-in and sends the source of the
tools it tests to the OpenAI-compatible endpoint you configure, using a key the
dashboard reads from `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `LLM_API_KEY` in
its environment and never stores. That is a deliberate boundary rather than a
defect, but if Probe sends more than the tool source, or sends it somewhere
else, that is in scope.
