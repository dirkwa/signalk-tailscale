import { useEffect, useState } from 'react'
import { getStatus, subscribeStatus, type StatusSnapshot } from './api'

export interface StatusState {
  status: StatusSnapshot | null
  error: string | null
  loading: boolean
}

/**
 * Live status via SSE, with an initial one-shot fetch so the UI paints
 * immediately (before the first SSE frame). Falls back to the last snapshot on
 * transient SSE errors; EventSource auto-reconnects.
 */
export function useStatus(): StatusState {
  const [status, setStatus] = useState<StatusSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // The one-shot fetch and the SSE stream race; if an SSE frame arrives first
    // (or during the fetch), the fetch's older snapshot must not overwrite it.
    let receivedSseSnapshot = false

    getStatus()
      .then((s) => {
        if (!cancelled && !receivedSseSnapshot) {
          setStatus(s)
          setError(null)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !receivedSseSnapshot) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    const unsubscribe = subscribeStatus(
      (s) => {
        if (!cancelled) {
          receivedSseSnapshot = true
          setStatus(s)
          setError(null)
          setLoading(false)
        }
      },
      () => {
        // Transient — keep the last snapshot; EventSource retries on its own.
      }
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { status, error, loading }
}
