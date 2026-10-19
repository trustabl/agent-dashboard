import { Suspense } from 'react'
import { ProbeClient } from './ProbeClient'

export default function ProbePage() {
  return (
    <Suspense>
      <ProbeClient />
    </Suspense>
  )
}
