'use client'
import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status)
  return body as T
}

export async function post<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status)
  return data as T
}

/** SWR with a faster refresh while any run is in progress, so tables update
 *  on their own when a background run finishes. */
export function useApi<T>(url: string | null, opts: SWRConfiguration = {}) {
  return useSWR<T>(url, fetcher, { refreshInterval: 4000, revalidateOnFocus: true, ...opts })
}

/** Re-fetch every page's data after a run changes state. */
export function refreshAll() {
  void globalMutate(() => true)
}
