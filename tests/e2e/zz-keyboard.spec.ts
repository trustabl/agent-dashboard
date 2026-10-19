import { test, expect } from '@playwright/test'

// Keyboard-only use (WCAG 2.1.1, 2.4.3, 2.4.7): skip link, nav, the run
// dialog's focus trap and Escape, expanding a row from its button.

test('Keyboard: skip link, focus ring, run dialog focus trap and Escape, row expand', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  // First Tab reaches the skip link; it moves focus to the main region.
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  const ring = await skip.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(ring).toBe('solid')
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()

  // Open the run dialog from the keyboard; focus stays inside it.
  const trigger = page.getByRole('button', { name: 'Run Probe' }).first()
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Run a local tool' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const inside = await dialog.evaluate((d) => d.contains(document.activeElement))
    expect(inside, `focus left the dialog after ${i + 1} Tab presses`).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  // Expand a table row with its button.
  const expand = page.getByRole('button', { name: 'Expand row' }).first()
  if (await expand.count()) {
    await expand.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Collapse row' }).first()).toHaveAttribute('aria-expanded', 'true')
  }
})
