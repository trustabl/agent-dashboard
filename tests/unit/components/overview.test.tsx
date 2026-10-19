// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/ToastContext'
import type { OverviewData } from '@/app/(console)/OverviewClient'
import type { RepoDetail } from '@/app/(console)/repos/[id]/RepoDetailClient'

// View-model fixtures recorded from the Console's own API over real CLI runs
// (trustabl 0.1.14 scan ×2 + forge, autofix 0.2.2 with Docker) on the fixture
// repos; paths rewritten to /work/repos. See tests/fixtures/views/README.md.
const views = path.join(__dirname, '..', '..', 'fixtures', 'views')
const overview = JSON.parse(fs.readFileSync(path.join(views, 'overview.json'), 'utf8')) as OverviewData
const detail = JSON.parse(fs.readFileSync(path.join(views, 'repo-detail.acme-support.json'), 'utf8')) as RepoDetail

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))
vi.mock('@/lib/client/api', () => ({
  useApi: (url: string | null) => ({
    data: url === '/api/overview' ? overview : url?.startsWith('/api/runs') ? { runs: [] } : url?.startsWith('/api/repositories/') ? detail : undefined,
    error: undefined,
    isLoading: false,
  }),
  post: vi.fn(),
  refreshAll: vi.fn(),
}))

const { OverviewClient, OverviewTable } = await import('@/app/(console)/OverviewClient')
const { RepoDetailView } = await import('@/app/(console)/repos/[id]/RepoDetailClient')

const acme = overview.rows.find((r) => r.repo.name === 'acme-support')!
const research = overview.rows.find((r) => r.repo.name === 'research-tools')!

describe('Overview', () => {
  it('shows the four tiles from the view', () => {
    render(<ToastProvider><OverviewClient /></ToastProvider>)
    expect(screen.getByText('1 not yet forged')).toBeInTheDocument()
    expect(screen.getByText('across 1 repo')).toBeInTheDocument()
    expect(screen.getByText('/ 2 emitting')).toBeInTheDocument()
    expect(screen.getByText('0 grant sets untested')).toBeInTheDocument()
    for (const b of ['Generate skill', 'Scan repo', 'Run Probe']) expect(screen.getAllByRole('button', { name: b }).length).toBeGreaterThan(0)
  })

  it('filters with a count per filter', () => {
    render(<ToastProvider><OverviewClient /></ToastProvider>)
    const select = screen.getByRole('combobox', { name: 'Filter repos' })
    expect(within(select).getByRole('option', { name: 'All repos (2)' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Stale or missing tool (1)' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'stale' } })
    expect(screen.queryByTestId('overview-row-acme-support')).not.toBeInTheDocument()
    expect(screen.getByTestId('overview-row-research-tools')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'open' } })
    expect(screen.getByTestId('overview-row-acme-support')).toBeInTheDocument()
    expect(screen.queryByTestId('overview-row-research-tools')).not.toBeInTheDocument()
  })

  it('has the design columns and per-tool states', () => {
    render(<ToastProvider><OverviewTable rows={[acme, research]} onRun={vi.fn()} onView={vi.fn()} /></ToastProvider>)
    for (const h of ['Repo', 'Stack', 'Forge', 'Analyzer', 'Probe', 'Issues']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
    const a = screen.getByTestId('overview-row-acme-support')
    expect(a).toHaveTextContent('agent ID n/a')
    expect(a).toHaveTextContent('Claude Agent SDK · OpenAI Agents SDK')
    expect(a).toHaveTextContent('skill current')
    expect(a).toHaveTextContent('70 ready')
    expect(a).toHaveTextContent('not drafted')
    expect(a).toHaveTextContent('13 → 14 open')
    const r = screen.getByTestId('overview-row-research-tools')
    expect(r).toHaveTextContent('no skill')
    expect(r).toHaveTextContent('forge never run')
    expect(r).toHaveTextContent('draft ready')
  })

  it('links each tool column to that page on the same repo', () => {
    render(<ToastProvider><OverviewTable rows={[acme]} onRun={vi.fn()} onView={vi.fn()} /></ToastProvider>)
    const id = acme.repo.id
    expect(screen.getByRole('link', { name: /^Forge for acme-support/ })).toHaveAttribute('href', `/forge?repo=${id}`)
    expect(screen.getByRole('link', { name: /^Analyzer for acme-support/ })).toHaveAttribute('href', `/analyzer?repo=${id}&open=issues`)
    expect(screen.getByRole('link', { name: /^Probe for acme-support/ })).toHaveAttribute('href', `/probe?repo=${id}`)
  })

  it('expands into inventory, grant-set hash, OTel, latest runs, artifacts and next step', () => {
    const onRun = vi.fn()
    render(<ToastProvider><OverviewTable rows={[acme]} onRun={onRun} onView={vi.fn()} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }))
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText(acme.probe.grantSetHash!.slice(0, 7))).toBeInTheDocument()
    expect(screen.getByText('Latest runs')).toBeInTheDocument()
    expect(screen.getByText(acme.next.text)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /SKILL\.md/ })).toHaveAttribute('href', `/api/forge/skill?repo_id=${acme.repo.id}&download=1`)
    expect(screen.getByRole('button', { name: 'View network_policies.draft.yaml' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Re-probe' }))
    expect(onRun).toHaveBeenCalledWith({ tool: 'probe', repoId: acme.repo.id, grantSet: 'analyzer' })
    expect(screen.getByRole('link', { name: 'Open repo' })).toHaveAttribute('href', `/repos/${acme.repo.id}`)
  })
})

describe('Repo detail', () => {
  it('shows readiness, open findings, OTel, Probe destinations, history, Forge and Probe panels and the run log', () => {
    render(<ToastProvider><RepoDetailView d={detail} /></ToastProvider>)
    expect(screen.getByRole('heading', { name: 'acme-support', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('projected 95 if medium fixed')).toBeInTheDocument()
    expect(screen.getByText('13 → 14')).toBeInTheDocument()
    expect(screen.getByText('Issue history')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Open findings per scan: 13, 14' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Forge' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Probe' })).toBeInTheDocument()
    expect(screen.getByText(/matches Analyzer/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Run log' })).toBeInTheDocument()
  })
})
