'use client'
import { Button } from '@/components/ui'
import { PageHeader, Toolbar, ToolbarActions } from '@/components/console/primitives'
import { useRunDialog } from '@/components/console/RunDialog'
import { RunHistory } from '@/components/console/RunHistory'
import { useApi } from '@/lib/client/api'

export default function ForgePage() {
  const { openRun } = useRunDialog()
  const { data } = useApi<{ repositories: { id: string; name: string }[] }>('/api/repositories')
  const names = Object.fromEntries((data?.repositories ?? []).map((r) => [r.id, r.name]))
  return (
    <>
      <PageHeader title="Forge" lead="This page's table lands in the next step. Runs already work from the button below." />
      <Toolbar><ToolbarActions><Button onClick={() => openRun({ tool: 'forge' })}>Run Forge</Button></ToolbarActions></Toolbar>
      <RunHistory tool="forge" repoNames={names} />
    </>
  )
}
