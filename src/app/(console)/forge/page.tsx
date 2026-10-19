import { Suspense } from 'react'
import { ForgeClient } from './ForgeClient'

export default function ForgePage() {
  return (
    <Suspense>
      <ForgeClient />
    </Suspense>
  )
}
