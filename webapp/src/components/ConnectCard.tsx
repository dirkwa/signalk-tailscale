import { useEffect, useState } from 'react'
import { Card, CardBody, CardTitle, Button, Spinner, Alert } from 'reactstrap'
import QRCode from 'qrcode'
import { kickLogin, type StatusSnapshot } from '../api'

interface Props {
  status: StatusSnapshot | null
  onConnected: () => void
}

/**
 * The zero-config entry point: shows the Tailscale login link + a QR code
 * (scan on a phone) while the node needs login, and nudges the user to the
 * Dashboard once connected.
 */
export function ConnectCard({ status, onConnected }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [kicking, setKicking] = useState(false)
  const [kickErr, setKickErr] = useState<string | null>(null)

  const state = status?.backendState ?? 'NoState'
  const authUrl = status?.authUrl ?? null
  const running = state === 'Running'

  // Render a QR for the current AuthURL.
  useEffect(() => {
    let cancelled = false
    // Clear immediately on any authUrl change so a stale QR can't linger while
    // the new one renders (or if the new authUrl is null).
    setQrDataUrl(null)
    if (!authUrl) {
      return
    }
    QRCode.toDataURL(authUrl, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [authUrl])

  // Sync handler wrapping the async work — keeps onClick's expected void
  // return (no-misused-promises) while still awaiting internally.
  const onKick = () => {
    void (async () => {
      setKicking(true)
      setKickErr(null)
      try {
        await kickLogin()
      } catch (err) {
        setKickErr(err instanceof Error ? err.message : String(err))
      } finally {
        setKicking(false)
      }
    })()
  }

  if (running) {
    return (
      <Card>
        <CardBody className="text-center">
          <CardTitle tag="h4">✅ Connected</CardTitle>
          <p className="text-muted">
            This boat is on your tailnet
            {status?.self.dnsName ? ` as ${status.self.dnsName}` : ''}.
          </p>
          <Button color="primary" onClick={onConnected}>
            Open Dashboard
          </Button>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="text-center">
        <CardTitle tag="h4">Connect this boat to your Tailscale account</CardTitle>
        <p className="text-muted">
          Sign in with Google, Apple, Microsoft, or GitHub. A tailnet is created automatically for
          new accounts. Then install the Tailscale app on your phone or laptop (same account) to
          reach your boat from anywhere.
        </p>

        {authUrl ? (
          <>
            {qrDataUrl && (
              <div className="my-3">
                <img src={qrDataUrl} alt="Tailscale login QR code" width={240} height={240} />
                <div className="text-muted small">Scan with your phone camera</div>
              </div>
            )}
            <div className="my-3">
              <Button color="primary" size="lg" href={authUrl} target="_blank" rel="noreferrer">
                Sign in to Tailscale ↗
              </Button>
            </div>
            <div className="text-muted small text-break">{authUrl}</div>
          </>
        ) : (
          <div className="my-4">
            <Spinner size="sm" />{' '}
            <span className="ms-2">
              {state === 'Starting' || state === 'NoState'
                ? 'Starting Tailscale…'
                : 'Preparing a login link…'}
            </span>
          </div>
        )}

        {kickErr && (
          <Alert color="danger" className="mt-3">
            {kickErr}
          </Alert>
        )}

        <div className="mt-3">
          <Button color="link" size="sm" onClick={onKick} disabled={kicking}>
            {kicking ? 'Requesting…' : 'Get a fresh login link'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
