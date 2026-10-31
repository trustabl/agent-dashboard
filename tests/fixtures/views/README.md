# Recorded view models

JSON returned by the Console's own `/api/overview` and `/api/repositories/<id>`
after real runs of the pinned CLIs on the fixture repos (`../repos`):

1. `trustabl scan` on `acme-support` and `research-tools`
2. `autofix fix` (Docker) on `acme-support` (Analyzer grant set) and on
   `research-tools` (draft agent, `--allow-list api.perplexity.ai`)
3. `trustabl forge` on `acme-support`, written after confirmation, `forge check`
4. `agent.py` edited (`timeout=10`), `trustabl scan` again

Absolute paths were rewritten to `/work/repos/…` and `/home/me/.agent-dashboard/…`;
nothing else was changed. Component tests render these instead of hand-written
objects, so what they assert is what the real pipeline produces.
