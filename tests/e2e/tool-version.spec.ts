import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { repoPath } from './helpers'

// Switching autofix to another installed version (a fake 9.9.9 that only
// prints its version) changes the badge and Copy CLI, then switches back.
const FAKE = path.resolve(__dirname, '..', '.tmp', 'home', 'bin', 'autofix-9.9.9')

test.beforeAll(() => {
  fs.mkdirSync(FAKE, { recursive: true })
  fs.writeFileSync(path.join(FAKE, 'autofix'), '#!/bin/sh\necho 9.9.9\n', { mode: 0o755 })
})

test.afterAll(async ({ request }) => {
  await request.put('/api/tools/autofix/active', { data: { version: '0.2.2' } })
  fs.rmSync(FAKE, { recursive: true, force: true })
})

test('switch autofix versions from the Probe page', async ({ page, request }) => {
  await page.goto('/probe')
  await page.getByRole('button', { name: /^autofix 0\.2\.2/ }).click()
  const dialog = page.getByRole('dialog', { name: 'autofix versions' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Use autofix 9.9.9' }).click()
  await expect(page.getByRole('button', { name: 'autofix 9.9.9 · untested' })).toBeVisible()

  const preview = await (await request.post('/api/runs/preview', {
    data: { tool: 'probe', path: repoPath('research-tools'), options: { grantSet: 'draft', runner: 'docker', model: 'm', llmUrl: 'http://127.0.0.1:9/v1' } },
  })).json()
  expect(preview.command).toContain('/bin/autofix-9.9.9/autofix')

  await dialog.getByRole('button', { name: 'Use autofix 0.2.2' }).click()
  await expect(page.getByRole('button', { name: /^autofix 0\.2\.2/ })).toBeVisible()
})
