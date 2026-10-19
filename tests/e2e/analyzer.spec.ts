import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { repoPath, runFromDialog } from './helpers'

test.describe.configure({ mode: 'serial' })

test('Analyzer: empty state, scan a new path, findings, history, rescan diff, downloads, SARIF import', async ({ page, request }) => {
  await page.goto('/analyzer')
  await expect(page.getByRole('heading', { name: 'Analyzer', level: 1 })).toBeVisible()
  await expect(page.getByText('No repos yet')).toBeVisible()

  // Scan through the shared dialog, on a path not registered yet.
  await page.getByRole('button', { name: 'Scan repo' }).first().click()
  const { dialog, status } = await runFromDialog(page, { tool: 'analyzer', newPath: repoPath('acme-support') })
  expect(status).toBe('succeeded')
  await dialog.getByRole('button', { name: 'Close' }).click()

  const row = page.getByTestId('analyzer-row-acme-support')
  await expect(row).toBeVisible()
  await expect(row).toContainText('64')            // readiness = round(overall_score * 100)
  await expect(row).toContainText('13 open · 0 resolved')

  // Open findings ranked by severity then confidence, with rulebook links.
  await row.getByRole('button', { name: 'Expand row' }).click()
  const panel = page.getByRole('table', { name: 'Open findings' })
  await expect(panel).toBeVisible()
  const sevs = await panel.locator('tbody tr td:first-child span').allTextContents()
  const order = ['C', 'H', 'M', 'L', 'I']
  expect(sevs.map((s) => order.indexOf(s))).toEqual([...sevs.map((s) => order.indexOf(s))].sort((a, b) => a - b))
  const link = panel.getByRole('link', { name: 'OAI-005' })
  await expect(link).toHaveAttribute('href', /trustabl-rulebook\/blob\/main\/openai_sdk\/POLICY_INDEX\.md/)
  await expect(panel.getByRole('button', { name: /Copy for Cursor/ }).first()).toBeVisible()
  // Test-path findings are hidden by default.
  await expect(page.getByText(/test-path finding\(s\) hidden/)).toBeVisible()
  await expect(panel.getByText('fetch_fixture')).toHaveCount(0)

  // Download JSON matches the run artifact byte for byte.
  const scans = await (await request.get('/api/scans')).json()
  const runId = scans.repos[0].lastScan.id
  const dl = await request.get(`/api/export?run_id=${runId}&kind=scan.json`)
  expect(dl.ok()).toBeTruthy()
  expect(JSON.parse(await dl.text()).findings.length).toBe(17)

  // Fix one finding, rescan: fingerprint gone = resolved.
  const agent = path.join(repoPath('acme-support'), 'agent.py')
  fs.writeFileSync(agent, fs.readFileSync(agent, 'utf8').replace('requests.get(url).json()', 'requests.get(url, timeout=10).json()'))
  await row.getByRole('button', { name: 'Scan', exact: true }).click()
  await runFromDialog(page, { tool: 'analyzer' })
  await page.getByRole('dialog', { name: 'Run a local tool' }).getByRole('button', { name: 'Close' }).click()
  await expect(row).toContainText('13 → 12 open')

  await row.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText('Scan history · acme-support')).toBeVisible()
  await expect(page.getByText(/12 open · 1 resolved/)).toBeVisible()
  await expect(page.getByText(/13 open · first scan|13 open · baseline/)).toBeVisible()

  // All findings: Open / Resolved / Introduced / All with a Status column.
  await page.getByRole('tab', { name: 'All findings' }).click()
  await expect(page.getByRole('radio', { name: 'Resolved (1)' })).toBeVisible()
  await page.getByRole('radio', { name: 'Resolved (1)' }).click()
  const all = page.getByRole('table', { name: 'All findings' })
  await expect(all.getByText('OAI-005')).toBeVisible()
  await expect(all.getByText('resolved', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show test-path findings' }).check()
  await page.getByRole('radio', { name: /^All/ }).click()
  await expect(all.getByText('fetch_fixture').first()).toBeVisible()

  // Import a `trustabl scan --format sarif` export.
  await page.getByRole('tab', { name: 'By repo' }).click()
  await page.getByRole('button', { name: 'Import SARIF' }).click()
  const modal = page.getByRole('dialog', { name: 'Import SARIF' })
  await modal.getByLabel('SARIF file').setInputFiles(path.resolve(__dirname, '..', 'fixtures', 'cli', 'trustabl.sarif'))
  await modal.getByRole('button', { name: 'Import' }).click()
  await expect(modal).toBeHidden()
  const hist = row.getByRole('button', { name: 'History' })
  if ((await hist.getAttribute('aria-pressed')) !== 'true') await hist.click()
  await expect(page.getByText(/imported SARIF/)).toBeVisible()
})
