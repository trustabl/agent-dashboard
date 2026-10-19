'use client'
import { FolderGit2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader, Toolbar, ToolbarActions } from '@/components/console/primitives'
import { useRunDialog } from '@/components/console/RunDialog'
import { RunHistory } from '@/components/console/RunHistory'
import { useApi } from '@/lib/client/api'

export function OverviewClient() {
  const { openRun } = useRunDialog()
  const { data } = useApi<{ repositories: { id: string; name: string }[] }>('/api/repositories')
  const repos = data?.repositories ?? []
  const names = Object.fromEntries(repos.map((r) => [r.id, r.name]))
  return (
    <>
      <PageHeader title="Overview" lead="Per-repo record of Forge, Analyzer, and Probe. Click a tool column to open that product on the same repo. Generate a skill, scan, or probe from the toolbar or a repo row." />
      <Toolbar>
        <ToolbarActions>
          <Button variant="secondary" onClick={() => openRun({ tool: 'forge' })}>Generate skill</Button>
          <Button variant="secondary" onClick={() => openRun({ tool: 'analyzer' })}>Scan repo</Button>
          <Button onClick={() => openRun({ tool: 'probe' })}>Run Probe</Button>
        </ToolbarActions>
      </Toolbar>
      {data && repos.length === 0 && (
        <EmptyState icon={FolderGit2} title="No repos yet" description="Run a local tool on a folder on this machine — it is added here. The agent does not have to be built yet." action={{ label: 'Run a local tool', onClick: () => openRun() }} />
      )}
      <RunHistory repoNames={names} />
    </>
  )
}
