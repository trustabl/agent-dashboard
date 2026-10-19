'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import FocusTrap from 'focus-trap-react'
import { X, AlertTriangle } from 'lucide-react'
import { Button, Modal } from '@/components/ui'
import { useToast } from '@/components/ui/ToastContext'
import { post, useApi, refreshAll } from '@/lib/client/api'
import type { ConsoleTool, RunRow } from '@/lib/types'
import { RunLog } from './RunLog'
import { CopyCli, CommandBlock } from './CopyCli'
import { CheckRow, Fieldset, Select, TextArea, TextInput } from './form'
import { ErrorBox, Note } from './primitives'
import { SkillReview } from './SkillReview'

interface RepoOption {
  id: string
  name: string
  path: string
  hasSkill: boolean
  scanTools: number | null
}

export interface OpenRunArgs {
  tool?: ConsoleTool
  repoId?: string
  /** Forge: go straight to `forge check` instead of generate. */
  action?: 'generate' | 'check'
  /** Probe: preselect the Analyzer-extracted grant set or a draft agent. */
  grantSet?: 'analyzer' | 'draft'
}

interface Ctx {
  openRun: (args?: OpenRunArgs) => void
}

const RunDialogContext = createContext<Ctx>({ openRun: () => {} })
export const useRunDialog = () => useContext(RunDialogContext)

const NEW = '__new__'

const LEADS: Record<ConsoleTool | 'default', string> = {
  default: 'Point Forge, Analyzer, or Probe at a repo on this machine. Works even if the agent is not built yet — Forge detects the stack from files.',
  forge: 'Generate a SKILL.md even if the agent is not written yet. Forge detects SDK / IDE / model from the repo files.',
  analyzer: 'Scan the repo for reliability + OTel-emission findings. Fingerprints update open / resolved / introduced.',
  probe: 'Run the grant set in a temporary sandbox and write an unsigned network_policies.draft.yaml.',
}

const LANGS = ['python', 'typescript', 'go']

interface ProbePrefs { runner: 'docker' | 'openshell'; model: string; llmUrl: string }
const PREFS_KEY = 'trustabl_console_probe_prefs'

function loadPrefs(): ProbePrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as ProbePrefs) : null
  } catch {
    return null
  }
}
function savePrefs(p: ProbePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private window */ }
}

export function RunDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [args, setArgs] = useState<OpenRunArgs>({})
  const [nonce, setNonce] = useState(0)
  const openRun = useCallback((a: OpenRunArgs = {}) => {
    setArgs(a)
    setNonce((n) => n + 1)
    setOpen(true)
  }, [])
  return (
    <RunDialogContext.Provider value={{ openRun }}>
      {children}
      {open && <RunDialog key={nonce} initial={args} onClose={() => setOpen(false)} />}
    </RunDialogContext.Provider>
  )
}

function RunDialog({ initial, onClose }: { initial: OpenRunArgs; onClose: () => void }) {
  const { toast } = useToast()
  const { data: repoData } = useApi<{ repositories: RepoOption[] }>('/api/repositories?with=flags', { refreshInterval: 0 })
  const repos = useMemo(() => repoData?.repositories ?? [], [repoData])
  const [tool, setTool] = useState<ConsoleTool>(initial.tool ?? 'forge')
  const [action, setAction] = useState<'generate' | 'check'>(initial.action ?? 'generate')
  const [repoIdChoice, setRepoId] = useState<string>(initial.repoId ?? '')
  const [newPath, setNewPath] = useState('')
  const [createDir, setCreateDir] = useState(true)
  const [noAgentChoice, setNoAgent] = useState(false)
  // Forge
  const [policy, setPolicy] = useState<string[]>([])
  const [lang, setLang] = useState<string[]>([])
  const [rulesRef, setRulesRef] = useState('')
  // Probe
  const prefs = useMemo(() => (typeof window === 'undefined' ? null : loadPrefs()), [])
  const [runnerChoice, setRunnerChoice] = useState<'docker' | 'openshell' | null>(prefs?.runner ?? null)
  const [model, setModel] = useState(prefs?.model ?? '')
  const [llmUrl, setLlmUrl] = useState(prefs?.llmUrl ?? '')
  const [allowList, setAllowList] = useState('')
  const [platformAllowList, setPlatformAllowList] = useState('')
  const [denyList, setDenyList] = useState('')
  const [envFixtures, setEnvFixtures] = useState('')
  const [useCache, setUseCache] = useState(true)
  const [allowWrite, setAllowWrite] = useState(false)
  const [confirmWriteOpen, setConfirmWriteOpen] = useState(false)
  const [grantSetChoice, setGrantSet] = useState<'analyzer' | 'draft' | null>(initial.grantSet ?? null)

  const [preview, setPreview] = useState<{ command?: string; note?: string; extra?: { classYaml?: string | null } }>({})
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [run, setRun] = useState<RunRow | null>(null)
  const [needsPolicy, setNeedsPolicy] = useState<string[] | null>(null)
  const [reviewRun, setReviewRun] = useState<RunRow | null>(null)

  // Default the repo once the list arrives; no repos yet → a new path.
  const repoId = repoIdChoice || initial.repoId || repos[0]?.id || (repoData && repos.length === 0 ? NEW : '')
  const isNew = repoId === NEW
  const repo = repos.find((r) => r.id === repoId)
  // "No agent built yet" is always on for a new path (design).
  const noAgent = isNew || noAgentChoice
  const canUseAnalyzer = !isNew && !!repo?.scanTools
  const grantSet: 'analyzer' | 'draft' = !canUseAnalyzer ? 'draft' : grantSetChoice ?? (noAgent ? 'draft' : 'analyzer')

  const { data: cats } = useApi<{ categories: string[] }>(tool === 'forge' ? '/api/forge/categories' : null, { refreshInterval: 0 })
  type Pre = { runner: { ok: boolean; detail: string; fix?: string; command: string }; llmKeyEnv: string[] }
  const { data: preOpenshell } = useApi<Pre>(tool === 'probe' ? '/api/preflight?runner=openshell' : null, { refreshInterval: 0 })
  const { data: preDocker } = useApi<Pre>(tool === 'probe' ? '/api/preflight?runner=docker' : null, { refreshInterval: 0 })
  // CLI default runner is openshell; if it is not reachable and Docker is, default to Docker.
  const runner: 'docker' | 'openshell' =
    runnerChoice ?? (preOpenshell && !preOpenshell.runner.ok && preDocker?.runner.ok ? 'docker' : 'openshell')
  const setRunner = setRunnerChoice
  const pre = runner === 'docker' ? preDocker : preOpenshell

  const options = useMemo(() => {
    if (tool === 'forge') return action === 'check' ? { rulesRef } : { policy, lang, rulesRef }
    if (tool === 'probe') {
      return {
        grantSet, runner, model, llmUrl, allowList, platformAllowList, denyList, envFixtures,
        allowWriteTools: allowWrite, confirmWriteTools: allowWrite, noCache: !useCache,
      }
    }
    return {}
  }, [tool, action, policy, lang, rulesRef, grantSet, runner, model, llmUrl, allowList, platformAllowList, denyList, envFixtures, allowWrite, useCache])

  const request = useMemo(() => {
    const base = { tool, action: tool === 'forge' ? action : undefined, options }
    return isNew ? { ...base, path: newPath, create: createDir } : { ...base, repoId }
  }, [tool, action, options, isNew, newPath, createDir, repoId])

  // Live "Copy CLI" preview of exactly what Start will run.
  const previewable = !run && (isNew ? !!newPath.trim() : !!repoId)
  useEffect(() => {
    if (!previewable) return
    const t = setTimeout(async () => {
      try {
        const p = await post<{ command: string; note?: string; extra?: { classYaml?: string | null } }>('/api/runs/preview', request)
        setPreview(p)
        setPreviewError(null)
      } catch (e) {
        setPreview({})
        setPreviewError((e as Error).message)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [request, previewable])

  const start = async () => {
    setStartError(null)
    if (isNew && !newPath.trim()) {
      setStartError('Enter a local path.')
      return
    }
    setStarting(true)
    try {
      if (tool === 'probe') savePrefs({ runner, model, llmUrl })
      const res = await post<{ run: RunRow }>('/api/runs', request)
      setRun(res.run)
      setNeedsPolicy(null)
      refreshAll()
    } catch (e) {
      setStartError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const onRunDone = useCallback((final: RunRow) => {
    const s = final.summary as { needsPolicy?: boolean; categories?: string[]; pending?: boolean }
    if (final.tool === 'forge' && final.action === 'generate') {
      if (s.needsPolicy) {
        setNeedsPolicy(s.categories ?? [])
      } else if (final.status === 'succeeded' && s.pending) {
        setReviewRun(final)
      }
    }
    toast(`${final.tool === 'analyzer' ? 'Analyzer' : final.tool === 'forge' ? 'Forge' : 'Probe'} run ${final.status}`)
  }, [toast])

  const titleId = 'run-dialog-title'
  const repoOptions = [
    ...repos.map((r) => ({ value: r.id, label: `${r.name}${tool === 'forge' && !r.hasSkill ? ' (no skill yet)' : ''}` })),
    { value: NEW, label: 'New local path — agent not built' },
  ]

  const closeDialog = () => {
    if (run?.status === 'running') toast('Run continues in the background')
    onClose()
  }

  return (
    <>
      <div
        className="fixed inset-0 flex items-center justify-center p-6 overflow-y-auto"
        style={{ backgroundColor: 'var(--color-backdrop)', zIndex: 'var(--z-modal)' }}
        onMouseDown={(e) => { if (e.target === e.currentTarget && !confirmWriteOpen && !reviewRun) closeDialog() }}
        onKeyDown={(e) => { if (e.key === 'Escape' && !confirmWriteOpen && !reviewRun) closeDialog() }}
      >
        <FocusTrap active={!confirmWriteOpen && !reviewRun} focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: '#run-dialog', escapeDeactivates: false }}>
          <div
            id="run-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="w-full max-w-[640px] my-auto rounded-(--radius-card) border border-(--color-border-muted) bg-(--color-bg-surface) shadow-(--shadow-modal) p-6 max-h-[calc(100vh-48px)] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="m-0 mb-1.5 text-lg font-semibold text-(--color-text-primary)">Run a local tool</h2>
              <button type="button" aria-label="Close dialog" onClick={closeDialog} className="cursor-pointer text-(--color-text-tertiary) hover:text-(--color-text-primary)">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="text-base text-(--color-text-secondary) mt-0 mb-4">{LEADS[tool] ?? LEADS.default}</p>

            {!run ? (
              <form onSubmit={(e) => { e.preventDefault(); void start() }}>
                <Select
                  label="Tool"
                  id="run-tool"
                  value={tool}
                  onChange={(v) => setTool(v as ConsoleTool)}
                  options={[
                    { value: 'forge', label: 'Forge — generate / refresh SKILL.md' },
                    { value: 'analyzer', label: 'Analyzer — scan repo' },
                    { value: 'probe', label: 'Probe — sandbox + egress report' },
                  ]}
                />
                <Select label="Repo" id="run-repo" value={repoId} onChange={setRepoId} options={repoOptions} />
                {isNew && (
                  <>
                    <TextInput label="Local path" id="run-path" value={newPath} onChange={setNewPath} placeholder="~/src/my-new-agent" mono />
                    <CheckRow checked={createDir} onChange={setCreateDir}>Create the folder if it does not exist</CheckRow>
                  </>
                )}
                <CheckRow checked={noAgent} onChange={setNoAgent} id="run-noagent" disabled={isNew}>
                  No agent built yet — detect stack from repo files and still write the skill / scan / harness
                </CheckRow>

                {tool === 'forge' && (
                  <ForgeFields
                    action={action}
                    setAction={setAction}
                    categories={needsPolicy?.length ? needsPolicy : cats?.categories ?? []}
                    policy={policy}
                    setPolicy={setPolicy}
                    lang={lang}
                    setLang={setLang}
                    rulesRef={rulesRef}
                    setRulesRef={setRulesRef}
                    emphasizePolicy={noAgent || !!needsPolicy}
                  />
                )}
                {tool === 'analyzer' && <Note>Runs <code className="font-mono">trustabl scan</code> with the CLI defaults; JSON and SARIF are kept for download.</Note>}
                {tool === 'probe' && (
                  <ProbeFields
                    grantSet={grantSet} setGrantSet={setGrantSet} canUseAnalyzer={canUseAnalyzer}
                    runner={runner} setRunner={setRunner}
                    preflight={pre}
                    model={model} setModel={setModel} llmUrl={llmUrl} setLlmUrl={setLlmUrl}
                    allowList={allowList} setAllowList={setAllowList}
                    platformAllowList={platformAllowList} setPlatformAllowList={setPlatformAllowList}
                    denyList={denyList} setDenyList={setDenyList}
                    envFixtures={envFixtures} setEnvFixtures={setEnvFixtures}
                    useCache={useCache} setUseCache={setUseCache}
                    allowWrite={allowWrite}
                    onAllowWrite={(v) => (v ? setConfirmWriteOpen(true) : setAllowWrite(false))}
                    classYaml={preview.extra?.classYaml ?? null}
                  />
                )}

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold uppercase tracking-wide text-(--color-text-tertiary)">Command</span>
                    <CopyCli command={preview.command} />
                  </div>
                  {previewable && preview.command ? <CommandBlock command={preview.command} /> : <Note>{previewError ?? (isNew ? 'Enter a local path to see the command.' : 'Building command…')}</Note>}
                  {preview.note && <Note>{preview.note}</Note>}
                </div>

                {startError && <ErrorBox title="Could not start">{startError}</ErrorBox>}

                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button type="button" variant="secondary" onClick={closeDialog}>Cancel</Button>
                  <Button type="submit" loading={starting} disabled={!!previewError && !isNew} id="run-go">Start</Button>
                </div>
              </form>
            ) : (
              <div>
                <RunLog key={run.id} run={run} onDone={onRunDone} />
                {needsPolicy && (
                  <div className="mt-3">
                    <ErrorBox title="No SDK detected — choose a policy">
                      Forge found no SDK in the dependency manifests. Pick one or more <code className="font-mono">--policy</code> categories and generate again.
                    </ErrorBox>
                    <PolicyPicker categories={needsPolicy} policy={policy} setPolicy={setPolicy} />
                    <div className="flex justify-end mt-2">
                      <Button disabled={!policy.length} onClick={() => { setRun(null) ; setTimeout(() => void start(), 0) }}>
                        Generate with --policy {policy.join(',')}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 mt-4">
                  {run.status !== 'running' && (
                    <Button variant="secondary" onClick={() => { setRun(null); setNeedsPolicy(null) }}>New run</Button>
                  )}
                  <Button variant={run.status === 'running' ? 'secondary' : 'primary'} onClick={closeDialog}>
                    {run.status === 'running' ? 'Run in background' : 'Close'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </FocusTrap>
      </div>

      <Modal
        open={confirmWriteOpen}
        onClose={() => setConfirmWriteOpen(false)}
        title="Run side-effect tools for real?"
        variant="danger"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmWriteOpen(false)}>Keep them skipped</Button>
            <Button variant="danger" onClick={() => { setAllowWrite(true); setConfirmWriteOpen(false) }}>Allow write tools</Button>
          </>
        }
      >
        <div className="flex gap-3">
          <AlertTriangle size={18} className="shrink-0 text-(--color-warning-text)" aria-hidden="true" />
          <div className="flex flex-col gap-2">
            <p className="m-0">
              With <code className="font-mono">--allow-write-tools</code>, Probe executes tools whose code performs a network write, subprocess call,
              file delete or destructive SQL. A refund tool will really refund; a delete tool will really delete.
            </p>
            <p className="m-0 font-semibold text-(--color-text-primary)">Never point this at production keys.</p>
            <p className="m-0">Supply staging or test-mode credentials with env fixtures instead.</p>
          </div>
        </div>
      </Modal>

      {reviewRun && <SkillReview runId={reviewRun.id} onClose={() => setReviewRun(null)} />}
    </>
  )
}

function PolicyPicker({ categories, policy, setPolicy }: { categories: string[]; policy: string[]; setPolicy: (p: string[]) => void }) {
  return (
    <Fieldset legend="--policy (additive to auto-detected SDKs)">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3">
        {categories.map((c) => (
          <CheckRow key={c} checked={policy.includes(c)} onChange={(v) => setPolicy(v ? [...policy, c] : policy.filter((p) => p !== c))}>
            <span className="font-mono text-sm">{c}</span>
          </CheckRow>
        ))}
      </div>
    </Fieldset>
  )
}

function ForgeFields(p: {
  action: 'generate' | 'check'
  setAction: (a: 'generate' | 'check') => void
  categories: string[]
  policy: string[]
  setPolicy: (v: string[]) => void
  lang: string[]
  setLang: (v: string[]) => void
  rulesRef: string
  setRulesRef: (v: string) => void
  emphasizePolicy: boolean
}) {
  const [showAdvanced, setShowAdvanced] = useState(p.emphasizePolicy)
  const shown = showAdvanced || p.emphasizePolicy
  return (
    <div className="mt-2">
      <Select
        label="Forge command"
        value={p.action}
        onChange={(v) => p.setAction(v as 'generate' | 'check')}
        options={[
          { value: 'generate', label: 'trustabl forge — generate SKILL.md' },
          { value: 'check', label: 'trustabl forge check — is the skill current?' },
        ]}
      />
      {p.action === 'generate' && (
        <>
          <button type="button" className="text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) cursor-pointer mb-2" aria-expanded={shown} onClick={() => setShowAdvanced(!showAdvanced)}>
            {shown ? '▾' : '▸'} Options (--policy, --lang, --rules-ref)
          </button>
          {shown && (
            <>
              {p.categories.length > 0 && <PolicyPicker categories={p.categories} policy={p.policy} setPolicy={p.setPolicy} />}
              <Fieldset legend="--lang (additive to detected languages)">
                <div className="flex gap-4">
                  {LANGS.map((l) => (
                    <CheckRow key={l} checked={p.lang.includes(l)} onChange={(v) => p.setLang(v ? [...p.lang, l] : p.lang.filter((x) => x !== l))}>
                      <span className="font-mono text-sm">{l}</span>
                    </CheckRow>
                  ))}
                </div>
              </Fieldset>
            </>
          )}
        </>
      )}
      {(shown || p.action === 'check') && (
        <TextInput label="--rules-ref" value={p.rulesRef} onChange={p.setRulesRef} placeholder="latest cached (CLI default)" mono hint="A branch or tag of agent-reliability-rules. Leave empty for the CLI default." />
      )}
    </div>
  )
}

function ProbeFields(p: {
  grantSet: 'analyzer' | 'draft'
  setGrantSet: (v: 'analyzer' | 'draft') => void
  canUseAnalyzer: boolean
  runner: 'docker' | 'openshell'
  setRunner: (v: 'docker' | 'openshell') => void
  preflight?: { runner: { ok: boolean; detail: string; fix?: string; command: string }; llmKeyEnv: string[] }
  model: string
  setModel: (v: string) => void
  llmUrl: string
  setLlmUrl: (v: string) => void
  allowList: string
  setAllowList: (v: string) => void
  platformAllowList: string
  setPlatformAllowList: (v: string) => void
  denyList: string
  setDenyList: (v: string) => void
  envFixtures: string
  setEnvFixtures: (v: string) => void
  useCache: boolean
  setUseCache: (v: boolean) => void
  allowWrite: boolean
  onAllowWrite: (v: boolean) => void
  classYaml: string | null
}) {
  const [showLists, setShowLists] = useState(false)
  const keyRef = useRef<HTMLParagraphElement>(null)
  return (
    <div className="mt-2">
      <Select
        label="Grant set"
        value={p.grantSet}
        onChange={(v) => p.setGrantSet(v as 'analyzer' | 'draft')}
        options={[
          ...(p.canUseAnalyzer ? [{ value: 'analyzer', label: 'Analyzer-extracted grant set (tools from the latest scan)' }] : []),
          { value: 'draft', label: 'Draft agent — let Probe find entrypoints in the repo' },
        ]}
        hint={!p.canUseAnalyzer ? 'No Analyzer grant set yet: scan the repo first to probe exactly the tools it found.' : undefined}
      />
      {p.classYaml && (
        <details className="mb-3">
          <summary className="text-sm text-(--color-text-secondary) cursor-pointer">class.yaml the Console will pass to --class</summary>
          <CommandBlock command={p.classYaml} />
        </details>
      )}
      <Select
        label="Sandbox runner"
        value={p.runner}
        onChange={(v) => p.setRunner(v as 'docker' | 'openshell')}
        options={[
          { value: 'openshell', label: 'OpenShell (CLI default)' },
          { value: 'docker', label: 'Docker' },
        ]}
      />
      <div role="status" className="-mt-2 mb-3 text-sm" data-testid="runner-check">
        {!p.preflight ? (
          <span className="text-(--color-text-tertiary)">Checking runner…</span>
        ) : p.preflight.runner.ok ? (
          <span className="text-(--color-success-text)">✓ {p.preflight.runner.detail}</span>
        ) : (
          <span className="text-(--color-danger-text)">
            ✗ {p.preflight.runner.detail} <span className="text-(--color-text-secondary)">Fix: {p.preflight.runner.fix}</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <TextInput label="--model" value={p.model} onChange={p.setModel} placeholder="qwen2.5-coder:32b" mono />
        <TextInput label="--llm-url" value={p.llmUrl} onChange={p.setLlmUrl} placeholder="http://localhost:11434/v1" mono />
      </div>
      <p ref={keyRef} className="-mt-2 mb-3 text-sm text-(--color-text-tertiary)">
        Probe sends tool source to this LLM endpoint only. Auto-detected for gpt-*/claude-* models. API key:{' '}
        {p.preflight?.llmKeyEnv.length ? `from ${p.preflight.llmKeyEnv.join(', ')} in the Console's environment` : 'none set (fine for a local model)'} — never stored by the Console.
      </p>
      <CheckRow checked={p.useCache} onChange={p.setUseCache}>Use Probe&apos;s result cache (off adds <code className="font-mono">--no-cache</code>)</CheckRow>
      <CheckRow checked={p.allowWrite} onChange={p.onAllowWrite}>
        Run side-effect tools for real (<code className="font-mono">--allow-write-tools</code>) — skipped by default
      </CheckRow>
      <button type="button" className="text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-primary) cursor-pointer my-2" aria-expanded={showLists} onClick={() => setShowLists(!showLists)}>
        {showLists ? '▾' : '▸'} Allow list, platform allow list, deny list, env fixtures
      </button>
      {showLists && (
        <>
          <TextArea label="--allow-list" value={p.allowList} onChange={p.setAllowList} placeholder={'# one host / CIDR / *.suffix per line\napi.example.com'} hint="Once supplied, an observed destination not on the list is flagged (egress.not_in_org_allow), not drafted." />
          <TextArea label="--platform-allow-list" value={p.platformAllowList} onChange={p.setPlatformAllowList} placeholder="nim.internal.example" hint="Platform must-reach endpoints (e.g. NIM, IdP); tagged source=platform." />
          <TextArea label="--deny-list" value={p.denyList} onChange={p.setDenyList} placeholder="10.0.0.0/8" hint="On top of Probe's built-in metadata / link-local deny. The Console also adds 0.0.0.0 and :: so they can never be drafted." />
          <TextArea label="--env-fixtures" value={p.envFixtures} onChange={p.setEnvFixtures} placeholder={'STRIPE_API_KEY=sk_test_…'} hint="KEY=value per line, injected into the sandbox. Use staging/test credentials. Written only to this run's folder (mode 600), never to the database." />
        </>
      )}
    </div>
  )
}
