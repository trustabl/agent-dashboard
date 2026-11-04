import { test, expect } from '@playwright/test'

// A fresh start downloads nothing. The first trustabl run (here Refresh rules,
// which needs no repo, so the page specs still see their empty states)
// installs the pinned CLI into its own log, verified against tools.lock.json,
// then runs it. Runs after 0-a11y-empty.
test('first run installs the pinned CLI, then runs it', async ({ request }) => {
  const before = await (await request.get('/api/status')).json()
  expect(before.tools.trustabl.installed).toBe(false)
  expect(before.tools.autofix.installed).toBe(false)
  expect((await (await request.get('/api/runs?tool=forge')).json()).runs).toEqual([])

  expect((await request.post('/api/rules')).status()).toBe(202)
  let run: { id: string; status: string; action: string; tool_version: string } | undefined
  for (let i = 0; i < 120 && run?.status !== 'succeeded' && run?.status !== 'failed'; i++) {
    await new Promise((r) => setTimeout(r, 500))
    run = ((await (await request.get('/api/runs?tool=forge')).json()).runs as NonNullable<typeof run>[]).find((r) => r.action === 'rules-status')
  }
  expect(run?.status).toBe('succeeded')
  expect(run?.tool_version).toBe('0.1.15')
  const log = await (await request.get(`/api/runs/${run!.id}/log`)).text()
  expect(log).toContain('• trustabl: using')
  expect(log).toContain('✓ SHA-256 matches tools.lock.json')

  const after = await (await request.get('/api/status')).json()
  expect(after.tools.trustabl).toMatchObject({ installed: true, reported: '0.1.15', active: '0.1.15' })
  expect(after.rules?.sha).toMatch(/^[0-9a-f]{40}$/)
})
