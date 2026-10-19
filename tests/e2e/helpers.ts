import path from 'node:path'
import { expect, type Page, type APIRequestContext } from '@playwright/test'

export const REPOS = path.resolve(__dirname, '..', '.tmp', 'repos')
export const repoPath = (name: string) => path.join(REPOS, name)

/** Start a run through the real dialog and wait until it finishes. */
export async function runFromDialog(page: Page, opts: { tool: 'forge' | 'analyzer' | 'probe'; repoLabel?: string; newPath?: string }) {
  const dialog = page.getByRole('dialog', { name: 'Run a local tool' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Tool', { exact: true }).selectOption(opts.tool)
  if (opts.newPath) {
    await dialog.getByLabel('Repo', { exact: true }).selectOption('__new__')
    await dialog.getByLabel('Local path', { exact: true }).fill(opts.newPath)
  } else if (opts.repoLabel) {
    await dialog.getByLabel('Repo', { exact: true }).selectOption({ label: opts.repoLabel })
  }
  await expect(dialog.getByText(/^cd /).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Start' }).click()
  const log = dialog.getByTestId('run-log')
  await expect(log).toHaveAttribute('data-status', /succeeded|failed/, { timeout: 90_000 })
  return { dialog, status: await log.getAttribute('data-status') }
}

export async function apiRun(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post('/api/runs', { data: body })
  expect(res.ok(), await res.text()).toBeTruthy()
  const { run } = await res.json()
  for (let i = 0; i < 180; i++) {
    const r = await (await request.get(`/api/runs/${run.id}`)).json()
    if (r.run.status !== 'running') return r.run
    await new Promise((x) => setTimeout(x, 500))
  }
  throw new Error('run did not finish')
}
