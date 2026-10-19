import { Suspense } from 'react'
import { RepoDetailClient } from './RepoDetailClient'

export default async function RepoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <RepoDetailClient id={id} />
    </Suspense>
  )
}
