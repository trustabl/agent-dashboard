import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'
import { apiRun, repoPath } from './helpers'

test.describe.configure({ mode: 'serial' })

// Probe needs a sandbox runner. With Docker reachable the real `autofix fix`
// runs on the fixture repos; the LLM URL is unreachable on purpose (Probe
// still writes every artifact and skips fix generation).
const dockerUp = (() => {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 15_000 })
    return true
  } catch {
    return false
  }
})()
const LLM = 'http://127.0.0.1:9/v1'

async function ensureScanned(request: Parameters<typeof apiRun>[0], name: string) {
  const repos = (await (await request.get('/api/repositories')).json()).repositories as { id: string; name: string }[]
  const repo = repos.find((r) => r.name === name)
  const scans = (await (await request.get('/api/scans')).json()).repos as { repo: { name: string }; lastScan: unknown }[]
  if (!repo || !scans.find((s) => s.repo.name === name)?.lastScan) {
    await apiRun(request, repo ? { tool: 'analyzer', repoId: repo.id } : { tool: 'analyzer', path: repoPath(name) })
  }
}

async function startProbe(page: Page, opts: { allowList?: string }) {
  const dialog = page.getByRole('dialog', { name: 'Run a local tool' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Sandbox runner').selectOption('docker')
  await expect(dialog.getByTestId('runner-check')).toContainText('✓ Docker')
  await dialog.getByLabel('--model').fill('qwen2.5-coder:32b')
  await dialog.getByLabel('--llm-url').fill(LLM)
  if (opts.allowList) {
    await dialog.getByRole('button', { name: /Allow list, platform allow list/ }).click()
    await dialog.getByLabel('--allow-list').fill(opts.allowList)
  }
  await expect(dialog.getByText(/autofix fix --class .* --sandbox --runner docker/).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Start' }).click()
  const log = dialog.getByTestId('run-log')
  await expect(log).toHaveAttribute('data-status', /succeeded|failed/, { timeout: 110_000 })
  const status = await log.getAttribute('data-status')
  await dialog.getByRole('button', { name: 'Close' }).click()
  return status
}

test('Probe: table, untested grant set, runner check, no sign/bind/push', async ({ page, request }) => {
  await ensureScanned(request, 'acme-support')
  await ensureScanned(request, 'research-tools')
  await page.goto('/probe')
  await expect(page.getByRole('heading', { name: 'Probe', level: 1 })).toBeVisible()
  for (const h of ['Repo / class', 'Grant set', 'Last run', 'Egress', 'Draft', 'Flags']) {
    await expect(page.getByRole('columnheader', { name: h })).toBeVisible()
  }
  // Both runners are checked on load, each with a reachable / unreachable state.
  await expect(page.getByTestId('probe-runners')).toContainText(/Docker (ready|unreachable)/)
  await expect(page.getByTestId('probe-runners')).toContainText(/OpenShell (ready|unreachable)/)

  // acme-support: Analyzer extracted tools, never probed → untested + Run Probe + Copy CLI.
  const acme = page.getByTestId('probe-row-acme-support')
  await expect(acme).toContainText('fetch')
  await expect(acme).toContainText('untested')
  await expect(acme).toContainText('no profile')
  await acme.getByRole('button', { name: 'Expand row' }).click()
  await expect(page.getByRole('button', { name: 'Run Probe on this grant set' })).toBeVisible()
  const copy = page.getByRole('button', { name: /Copy CLI: cd .*autofix fix --class "\$D\/class\.yaml" --sandbox/ })
  await expect(copy).toBeVisible()

  // The runner check names the fix when the chosen runner is unreachable.
  await page.getByRole('button', { name: 'Run Probe on this grant set' }).click()
  const dialog = page.getByRole('dialog', { name: 'Run a local tool' })
  await expect(dialog.getByLabel('Grant set')).toHaveValue('analyzer')
  await dialog.getByLabel('Sandbox runner').selectOption('openshell')
  await expect(dialog.getByTestId('runner-check')).toContainText(/✓ OpenShell|✗ OpenShell .* Fix: /)
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Drafts stay unsigned: nothing on this page signs, binds or pushes.
  await expect(page.getByRole('button', { name: /\b(sign|bind|push)\b/i })).toHaveCount(0)
})

test('Probe: Analyzer grant set run → profile, egress, extras apart, artifacts', async ({ page }) => {
  test.skip(!dockerUp, 'Docker is not reachable on this machine')
  await page.goto('/probe?repo=')
  const acme = page.getByTestId('probe-row-acme-support')
  await acme.getByRole('button', { name: 'Expand row' }).click()
  await page.getByRole('button', { name: 'Run Probe on this grant set' }).click()
  expect(await startProbe(page, {})).toBe('succeeded')

  await expect(acme).toContainText('class acme-support')
  await expect(acme).toContainText(/fresh · Docker|cache hit · Docker/)
  await expect(acme).not.toContainText('untested')
  // No egress observed → the draft allows nothing, and says so.
  await expect(acme).toContainText('not drafted')
  await expect(page.getByText('Per-tool egress')).toBeVisible()
  await expect(page.getByText('model client host n/a')).toBeVisible()
  await expect(page.getByText('List evaluation')).toBeVisible()
  await expect(page.getByText('Observed ∩ declared-allow → draft')).toBeVisible()
  await expect(page.getByText('No network egress observed — the draft allows no outbound destinations.').first()).toBeVisible()
  await expect(page.getByText('Session extras (not the lead)')).toBeVisible()

  // Artifacts: view and download as written.
  await page.getByRole('button', { name: 'View probe.profile.json' }).click()
  const viewer = page.getByRole('dialog', { name: /probe\.profile\.json/ })
  await expect(viewer.getByLabel('probe.profile.json')).toContainText('"grant_set_hash"')
  await viewer.getByRole('button', { name: /close/i }).first().click()
  await page.getByRole('button', { name: 'View network_policies.draft.yaml' }).click()
  const yaml = page.getByRole('dialog', { name: /network_policies\.draft\.yaml/ })
  await expect(yaml.getByText('unsigned', { exact: true })).toBeVisible()
  await expect(yaml.getByLabel('network_policies.draft.yaml')).toContainText('network_policies:')
  await yaml.getByRole('button', { name: /close/i }).first().click()
  await expect(page.getByRole('link', { name: 'Download probe.findings.json' })).toHaveAttribute('href', /kind=probe\.findings\.json/)
})

test('Probe: draft agent with an allow list → flags, draft, skipped write tool; broad list → withheld', async ({ page }) => {
  test.skip(!dockerUp, 'Docker is not reachable on this machine')
  await page.goto('/probe')
  const row = page.getByTestId('probe-row-research-tools')
  await row.getByRole('button', { name: 'Expand row' }).click()
  await page.getByRole('button', { name: 'Run Probe as a draft agent' }).click()
  expect(await startProbe(page, { allowList: 'api.perplexity.ai' })).toBe('succeeded')

  await expect(row).toContainText('unsigned draft')
  await expect(row).toContainText('not_in_org_allow')
  await expect(page.getByRole('list', { name: 'Destinations' })).toContainText('api.stripe.com:443')
  await expect(page.getByText(/Skipped side-effect tool\(s\): refund-tool\/tool\.py/)).toBeVisible()
  await expect(page.getByLabel('Draft network policy')).toContainText('api.perplexity.ai')
  await expect(page.getByLabel('Draft network policy')).toContainText('# unsigned')

  // A broad allow-list entry: Probe drafts what matched the wildcard; the
  // Console does not offer that as a draft and says why.
  await page.getByRole('button', { name: 'Re-probe' }).click()
  expect(await startProbe(page, { allowList: '*.com\napi.perplexity.ai' })).toBe('succeeded')
  await expect(row).toContainText('withheld')
  await expect(row).toContainText('broad_cidr')
  await expect(page.getByText(/Draft withheld: the allow list you supplied has broad entries \(\*\.com\)/).first()).toBeVisible()
  // Metadata / link-local / any-address never appear in what the page shows as a draft.
  await expect(page.getByLabel('Draft network policy')).toHaveCount(0)
})
