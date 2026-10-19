import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { repoPath } from './helpers'

test.describe.configure({ mode: 'serial' })
const SKILL = '.claude/skills/trustabl-pre-coding/SKILL.md'

test('Forge: no SDK asks for --policy, writes only after confirm, check, stale cause, regenerate with diff', async ({ page }) => {
  const research = repoPath('research-tools')
  const skillFile = path.join(research, SKILL)
  await page.goto('/forge')
  await expect(page.getByRole('heading', { name: 'Forge', level: 1 })).toBeVisible()

  // research-tools has no SDK manifest: forge exits 1 and the dialog asks for --policy.
  await page.getByRole('button', { name: 'Generate skill' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Run a local tool' })
  await dialog.getByLabel('Tool', { exact: true }).selectOption('forge')
  await dialog.getByLabel('Repo', { exact: true }).selectOption('__new__')
  await dialog.getByLabel('Local path', { exact: true }).fill(research)
  await expect(dialog.getByText(/trustabl forge .*-o .*SKILL\.md/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(dialog.getByText('No SDK detected — choose a policy')).toBeVisible({ timeout: 60_000 })
  await dialog.getByRole('checkbox', { name: 'claude_sdk' }).last().check()
  await dialog.getByRole('button', { name: /Generate with --policy claude_sdk/ }).click()

  // The generated skill is shown for confirmation; nothing is on disk yet.
  const review = page.getByRole('dialog', { name: 'Write SKILL.md?' })
  await expect(review).toBeVisible({ timeout: 60_000 })
  expect(fs.existsSync(skillFile)).toBe(false)
  await review.getByRole('button', { name: 'Write SKILL.md' }).click()
  await expect(review).toBeHidden()
  await expect.poll(() => fs.existsSync(skillFile)).toBe(true)
  await dialog.getByRole('button', { name: /^(Close|Run in background)$/ }).click()

  // Row: stack from the stamp, OTel encoded, forge check pass (runs after write).
  const row = page.getByTestId('forge-row-research-tools')
  await expect(row).toContainText('claude_sdk')
  await expect(row).toContainText(SKILL)
  // No manifest → no language → forge leaves the Runtime Tracing section out.
  await expect(row).toContainText('none')
  await expect(row.getByText('pass', { exact: true })).toBeVisible({ timeout: 60_000 })

  // Expanded row: what the skill instructs, inventory, raw stamp.
  await row.getByRole('button', { name: 'Expand row' }).click()
  await expect(page.getByText('What this skill instructs')).toBeVisible()
  await expect(page.getByText('Inventory at generate time')).toBeVisible()
  await expect(page.getByText(/<!-- generated: .* \| rules: [0-9a-f]{40} \| schema: \d+ \| sdks: claude_sdk \| template: \d+ -->/)).toBeVisible()

  // Make the stamp stale: forge check names the cause and offers Regenerate.
  const text = fs.readFileSync(skillFile, 'utf8')
  fs.writeFileSync(skillFile, text.replace(/rules: [0-9a-f]{40}/, 'rules: 0123456789abcdef0123456789abcdef01234567'))
  await page.getByRole('button', { name: 'Run forge check' }).last().click()
  await expect(row.getByText('stale rules')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Why forge check fails')).toBeVisible()
  await expect(page.getByText(/stamp rules 0123456 ≠ current [0-9a-f]{7}/)).toBeVisible()

  // Regenerate: the review shows a diff against the file on disk.
  await page.getByRole('button', { name: 'Regenerate skill' }).click()
  const d2 = page.getByRole('dialog', { name: 'Run a local tool' })
  await d2.getByRole('button', { name: /Options/ }).click().catch(() => {})
  await d2.getByRole('checkbox', { name: 'claude_sdk' }).check()
  await d2.getByRole('checkbox', { name: 'python' }).check()
  await expect(d2.getByText(/--policy claude_sdk --lang python/)).toBeVisible()
  await d2.getByRole('button', { name: 'Start' }).click()
  const r2 = page.getByRole('dialog', { name: 'Review changes to SKILL.md' })
  await expect(r2).toBeVisible({ timeout: 60_000 })
  await expect(r2.getByText(/^-<!-- generated: .*rules: 0123456789abcdef/)).toBeVisible()
  await r2.getByRole('button', { name: 'Write SKILL.md' }).click()
  await d2.getByRole('button', { name: /^(Close|Run in background)$/ }).click()
  await expect(row.getByText('pass', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(row).toContainText('encoded')
})
