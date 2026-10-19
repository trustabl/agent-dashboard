'use client'
import { useId, useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { useToast } from '@/components/ui/ToastContext'
import { Select, TextInput } from '@/components/console/form'
import { CommandBlock } from '@/components/console/CopyCli'
import { ErrorBox, Note } from '@/components/console/primitives'
import { refreshAll } from '@/lib/client/api'

const NEW = '__new__'

/** Import a `trustabl scan --format sarif` export as a scan of one repo. */
export function ImportSarif({ repos, onClose }: { repos: { id: string; name: string; path: string }[]; onClose: () => void }) {
  const { toast } = useToast()
  const fileId = useId()
  const [repoId, setRepoId] = useState(repos[0]?.id ?? NEW)
  const [path, setPath] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const repo = repos.find((r) => r.id === repoId)

  const submit = async () => {
    if (!file) return setError('Choose a .sarif file.')
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('file', file)
    if (repoId === NEW) fd.set('path', path)
    else fd.set('repo_id', repoId)
    try {
      const res = await fetch('/api/scans/import', { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      toast('SARIF imported as a scan')
      refreshAll()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import SARIF"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!file}>Import</Button>
        </>
      }
    >
      <p className="mt-0">Load a SARIF file exported by trustabl. Its findings become a scan of the repo you pick. Status is computed from fingerprints, the same way as for scans run here.</p>
      <Select label="Repo" value={repoId} onChange={setRepoId} options={[...repos.map((r) => ({ value: r.id, label: r.name })), { value: NEW, label: 'New local path' }]} />
      {repoId === NEW && <TextInput label="Local path" value={path} onChange={setPath} placeholder="~/src/my-agent" mono />}
      <div className="flex flex-col gap-1 mb-3">
        <label htmlFor={fileId} className="text-base font-medium text-(--color-text-primary)">SARIF file</label>
        <input id={fileId} type="file" accept=".sarif,.json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-base" />
      </div>
      <Note>Produce one with:</Note>
      <CommandBlock command={`trustabl scan ${repo?.path ?? (path || '.')} --format sarif -o trustabl.sarif`} />
      {error && <ErrorBox title="Import failed">{error}</ErrorBox>}
    </Modal>
  )
}
