import { test, expect } from '@playwright/test'
import { apiRun, repoPath } from './helpers'

test.describe.configure({ mode: 'serial' })

test('Overview: header, tiles, toolbar, filters, repo table, tool links, expanded row, repo detail', async ({ page, request }) => {
  // Earlier specs scanned acme-support and forged research-tools; make sure
  // both exist even when this file runs alone.
  const repos = (await (await request.get('/api/repositories')).json()).repositories as { id: string; name: string }[]
  if (!repos.find((r) => r.name === 'acme-support')) await apiRun(request, { tool: 'analyzer', path: repoPath('acme-support') })
  if (!repos.find((r) => r.name === 'research-tools')) await apiRun(request, { tool: 'analyzer', path: repoPath('research-tools') })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  // Header: repo count + current rules SHA.
  await expect(page.getByRole('banner')).toContainText(/\d+ repos?/)
  await expect(page.getByRole('banner')).toContainText(/rules ([0-9a-f]{7}|…)/)

  for (const t of ['Repos', 'Open findings', 'OTel profile', 'Probe drafts']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/\d+ not yet forged/)).toBeVisible()
  // The tile ("1 grant set untested"), not the Probe cell's "grant set untested".
  await expect(page.getByText(/^\d+ grant sets? untested$/)).toBeVisible()
  for (const b of ['Generate skill', 'Scan repo', 'Run Probe']) await expect(page.getByRole('button', { name: b }).first()).toBeVisible()

  const filter = page.getByRole('combobox', { name: 'Filter repos' })
  await expect(filter.locator('option')).toHaveText([/^All repos \(\d+\)$/, /^Has open findings \(\d+\)$/, /^Stale or missing tool \(\d+\)$/, /^OTel gap \(\d+\)$/])

  // Scoped to the repo table: the run log below it has its own "Repo" column.
  const table = page.getByRole('table', { name: 'Repos' })
  for (const h of ['Repo', 'Stack', 'Forge', 'Analyzer', 'Probe', 'Issues']) await expect(table.getByRole('columnheader', { name: h, exact: true })).toBeVisible()
  const acme = page.getByTestId('overview-row-acme-support')
  const research = page.getByTestId('overview-row-research-tools')
  await expect(acme).toContainText(/ready/)
  await expect(acme).toContainText(/open/)
  await expect(research).toContainText(/skill current|skill stale|not checked/)

  // "Has open findings" keeps acme-support, which has open findings.
  await filter.selectOption('open')
  await expect(acme).toBeVisible()
  await filter.selectOption('all')

  // A tool column opens that page on the same repo.
  await research.getByRole('link', { name: /^Forge for research-tools/ }).click()
  await expect(page).toHaveURL(/\/forge\?repo=/)
  await expect(page.getByTestId('forge-row-research-tools')).toHaveAttribute('data-open', 'true')
  await page.goBack()
  await acme.getByRole('link', { name: /^Analyzer for acme-support/ }).click()
  await expect(page).toHaveURL(/\/analyzer\?repo=.*open=issues/)
  await expect(page.getByText('Open findings · acme-support')).toBeVisible()
  await page.goBack()

  // Expanded row.
  await acme.getByRole('button', { name: 'Expand row' }).click()
  await expect(page.getByText('Inventory', { exact: true })).toBeVisible()
  await expect(page.getByText(/Agents \d+ · tools \d+ · MCP \d+/)).toBeVisible()
  await expect(page.getByText('Latest runs', { exact: true })).toBeVisible()
  await expect(page.getByText('Next', { exact: true })).toBeVisible()
  // Inventory panel actions (the "Next" panel may offer Rescan too).
  const inventory = page.getByText('Inventory', { exact: true }).locator('..')
  for (const b of ['Rescan', 'Re-probe']) await expect(inventory.getByRole('button', { name: b, exact: true })).toBeVisible()
  await expect(inventory.getByRole('button', { name: /^(Regenerate|Generate skill)$/ })).toBeVisible()

  // Repo detail.
  await page.getByRole('link', { name: 'Open repo' }).click()
  await expect(page).toHaveURL(/\/repos\//)
  await expect(page.getByRole('heading', { name: 'acme-support', level: 1 })).toBeVisible()
  for (const t of ['Readiness', 'Open findings', 'OTel', 'Probe dest']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Issue history' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Open findings per scan: / })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Forge', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Probe', exact: true })).toBeVisible()
  const log = page.getByRole('region', { name: 'Run log' })
  await expect(log.getByRole('row').nth(1)).toBeVisible()
  await expect(log).toContainText('Analyzer')

  // Unknown repo → error state, not a crash.
  await page.goto('/repos/does-not-exist')
  await expect(page.getByText('Repo not found')).toBeVisible()
})
