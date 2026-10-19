import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Runs first (file order): every page in its empty state — no repos yet —
// in both themes. The data-filled states are checked by zz-a11y.spec.ts.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function violations(page: Page, where: string) {
  await page.waitForTimeout(300)
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  return r.violations.map((v) => ({ where, rule: v.id, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }))
}

for (const theme of ['dark', 'light'] as const) {
  test(`WCAG 2.1 AA (axe) — empty states, ${theme} theme`, async ({ page, request }) => {
    const repos = (await (await request.get('/api/repositories')).json()).repositories as unknown[]
    test.skip(repos.length > 0, 'Needs a fresh Console home (it runs first in the e2e suite)')
    await page.addInitScript((t) => window.localStorage.setItem('trustabl_theme', t), theme)
    const found = []
    for (const [path, heading] of [['/', 'Overview'], ['/forge', 'Forge'], ['/analyzer', 'Analyzer'], ['/probe', 'Probe']] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expect(page.getByText('No repos yet').first()).toBeVisible()
      found.push(...(await violations(page, `${heading} empty (${theme})`)))
    }
    expect(found, JSON.stringify(found, null, 2)).toEqual([])
  })
}
