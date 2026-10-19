import { Suspense } from 'react'
import { AnalyzerClient } from './AnalyzerClient'

export default function AnalyzerPage() {
  return (
    <Suspense>
      <AnalyzerClient />
    </Suspense>
  )
}
