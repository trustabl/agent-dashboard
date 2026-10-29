# Agent Dashboard — see README.md
.PHONY: run dev tools test e2e parity lint typecheck check secrets audit wipe

run:            ## Install what is missing, build, and serve on http://127.0.0.1:4317
	@./scripts/run.sh

dev:            ## Next.js dev server (hot reload), same localhost-only binding
	@node scripts/fetch-tools.mjs && npx next dev -H 127.0.0.1 -p $${AGENT_DASHBOARD_PORT:-4317}

tools:          ## Download/verify the pinned trustabl + autofix CLIs
	@node scripts/fetch-tools.mjs

test:           ## Unit tests (Vitest)
	@npx vitest run

e2e:            ## Playwright end-to-end tests against the fixture repos
	@npx playwright test

parity:         ## Artifact parity: Console run == CLI run for scan / forge / probe (Probe needs Docker)
	@npx vitest run --config vitest.parity.config.mts

secrets:        ## Secret scan of the working tree and history (gitleaks; CI runs the same)
	@gitleaks detect --source . --redact --config .gitleaks.toml

audit:          ## Fail on high-severity advisories in runtime dependencies (dev-only ones are not checked)
	@npm audit --omit=dev --audit-level=high

lint:
	@npx eslint

typecheck:
	@npx tsc --noEmit

check: lint typecheck test

wipe:           ## Delete ALL Console state (asks first; WIPE_YES=1 to skip)
	@./scripts/wipe.sh $(if $(WIPE_YES),--yes,)
