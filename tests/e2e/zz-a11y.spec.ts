import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { apiRun, repoPath } from './helpers'

// WCAG 2.1 AA pass with axe-core on every screen, in both themes, with rows
// expanded and the dialogs open. Named zz- so it runs after the page specs
// and sees their data (it seeds what it needs when run alone).

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

type Found = { where: string; rule: string; impact?: string | null; help: string; nodes: string[] }
let found: Found[] = []

async function audit(page: Page, where: string) {
  // Let transitions/animations settle so colors are final.
  await page.waitForTimeout(400)
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const summary = result.violations.map((v) => ({
    where,
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`),
  }))
  found.push(...summary)
}

async function expandFirst(page: Page) {
  const btn = page.getByRole('button', { name: 'Expand row' }).first()
  if (await btn.count()) await btn.click()
}

test.describe.configure({ mode: 'serial' })

for (const theme of ['dark', 'light'] as const) {
  test(`WCAG 2.1 AA (axe) — every screen, ${theme} theme`, async ({ page, request }) => {
    test.setTimeout(240_000)
    found = []
    const repos = (await (await request.get('/api/repositories')).json()).repositories as { id: string; name: string }[]
    if (!repos.find((r) => r.name === 'acme-support')) await apiRun(request, { tool: 'analyzer', path: repoPath('acme-support') })
    const acme = ((await (await request.get('/api/repositories')).json()).repositories as { id: string; name: string }[]).find((r) => r.name === 'acme-support')!

    await page.addInitScript((t) => window.localStorage.setItem('trustabl_theme', t), theme)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await audit(page, `overview (${theme})`)
    await expandFirst(page)
    await audit(page, `overview expanded (${theme})`)

    await page.goto('/forge')
    await expect(page.getByRole('heading', { name: 'Forge', level: 1 })).toBeVisible()
    await expandFirst(page)
    await audit(page, `forge expanded (${theme})`)

    await page.goto('/analyzer')
    await expect(page.getByRole('heading', { name: 'Analyzer', level: 1 })).toBeVisible()
    await expandFirst(page)
    await audit(page, `analyzer by repo expanded (${theme})`)
    const hist = page.getByRole('button', { name: 'History' }).first()
    if (await hist.count()) {
      await hist.click()
      await audit(page, `analyzer history (${theme})`)
    }
    await page.getByRole('tab', { name: 'All findings' }).click()
    await expandFirst(page)
    await audit(page, `analyzer all findings (${theme})`)

    await page.goto('/probe')
    await expect(page.getByRole('heading', { name: 'Probe', level: 1 })).toBeVisible()
    await expandFirst(page)
    await audit(page, `probe expanded (${theme})`)

    // Artifact viewer modal (when a Probe run exists).
    const view = page.getByRole('button', { name: /^View / }).first()
    if (await view.count()) {
      await view.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await audit(page, `probe artifact viewer (${theme})`)
      await page.keyboard.press('Escape')
    }

    await page.goto(`/repos/${acme.id}`)
    await expect(page.getByRole('heading', { name: 'acme-support', level: 1 })).toBeVisible()
    await audit(page, `repo detail (${theme})`)
    // Full run output modal from the run log.
    await page.getByRole('button', { name: 'Log', exact: true }).first().click()
    await expect(page.getByTestId('run-log').first()).toBeVisible()
    await audit(page, `run log modal (${theme})`)
    await page.keyboard.press('Escape')

    // The shared run dialog, for each tool, with options expanded.
    await page.goto('/')
    await page.getByRole('button', { name: 'Generate skill' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Run a local tool' })
    await expect(dialog).toBeVisible()
    await audit(page, `run dialog: forge (${theme})`)
    await dialog.getByLabel('Tool', { exact: true }).selectOption('analyzer')
    await audit(page, `run dialog: analyzer (${theme})`)
    await dialog.getByLabel('Tool', { exact: true }).selectOption('probe')
    const lists = dialog.getByRole('button', { name: /Allow list, platform allow list/ })
    if (await lists.count()) await lists.click()
    await audit(page, `run dialog: probe (${theme})`)

    // Every screen is checked before failing, so one run lists everything.
    expect(found, JSON.stringify(found, null, 2)).toEqual([])
  })
}

// WCAG 1.4.10 Reflow: at 320 CSS px only the tables may scroll sideways,
// never the page itself.
test('reflow — no page-level horizontal scroll at 320px', async ({ page, request }) => {
  const repos = (await (await request.get('/api/repositories')).json()).repositories as { id: string }[]
  await page.setViewportSize({ width: 320, height: 800 })
  const wide: string[] = []
  for (const url of ['/', '/forge', '/analyzer', '/probe', ...(repos[0] ? [`/repos/${repos[0].id}`] : [])]) {
    await page.goto(url)
    await expect(page.locator('main h1')).toBeVisible()
    await page.waitForTimeout(400)
    const w = await page.evaluate(() => document.documentElement.scrollWidth)
    if (w > 320) wide.push(`${url}: ${w}px`)
  }
  expect(wide).toEqual([])
})
