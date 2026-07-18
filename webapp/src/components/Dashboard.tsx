import { useState } from 'react'
import { Card, CardBody, CardTitle, Button, Badge, Row, Col, Alert } from 'reactstrap'
import { HttpsHint } from './HttpsHint'
import type { StatusSnapshot } from '../api'

interface Props {
  status: StatusSnapshot | null
  running: boolean
  onGoConnect: () => void
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    // navigator.clipboard is typed as always-present; in an insecure context
    // writeText rejects, which the rejection handler below swallows (the link
    // text stays selectable as a fallback).
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => {
          setCopied(false)
        }, 1500)
      },
      () => {
        /* clipboard blocked; the link text is still selectable */
      }
    )
  }
  return (
    <div className="d-flex align-items-center gap-2 mb-2">
      <a href={url} target="_blank" rel="noreferrer" className="text-break">
        {url}
      </a>
      <Button size="sm" color="secondary" outline onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/**
 * Connected view: the URLs to reach SignalK over Tailscale, peer count, and
 * (when relevant) the Enable-HTTPS hint. When not yet Running, points back to
 * Connect.
 */
export function Dashboard({ status, running, onGoConnect }: Props) {
  if (!running || !status) {
    return (
      <Card>
        <CardBody className="text-center">
          <CardTitle tag="h5">Not connected yet</CardTitle>
          <p className="text-muted">
            {status ? statusLine(status) : 'Waiting for the Tailscale engine…'}
          </p>
          <Button color="primary" onClick={onGoConnect}>
            Go to Connect
          </Button>
        </CardBody>
      </Card>
    )
  }

  const { self, tailnet, serve, peerCount, peersOnline } = status
  const nonHttpsServeErr =
    serve.lastError && !/https|cert/i.test(serve.lastError) ? serve.lastError : null

  return (
    <div>
      <Card className="mb-3">
        <CardBody>
          <CardTitle tag="h5">
            {self.dnsName ?? self.hostName ?? 'This boat'}{' '}
            <Badge color="success" pill>
              online
            </Badge>
          </CardTitle>
          <div className="text-muted mb-3">
            {peersOnline} of {peerCount} devices online in your tailnet
            {tailnet.magicDNSSuffix ? ` (${tailnet.magicDNSSuffix})` : ''}
          </div>

          {serve.enabled ? (
            <>
              <div className="fw-semibold">Reach SignalK at:</div>
              {serve.httpsUrl && <CopyLink url={serve.httpsUrl} />}
              {serve.httpUrl && <CopyLink url={serve.httpUrl} />}
              {!serve.httpsUrl && !serve.httpUrl && (
                <div className="text-muted">Setting up the address…</div>
              )}
            </>
          ) : (
            <Alert color="secondary" className="mb-0">
              Exposing SignalK over Tailscale is turned off. Enable it in Settings.
            </Alert>
          )}
        </CardBody>
      </Card>

      <HttpsHint status={status} />

      {nonHttpsServeErr && <Alert color="warning">Serve issue: {nonHttpsServeErr}</Alert>}

      <Card className="mb-3">
        <CardBody>
          <CardTitle tag="h6">Reach your boat from a phone or laptop</CardTitle>
          <ol className="mb-0 text-muted">
            <li>
              Install Tailscale from{' '}
              <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                tailscale.com/download
              </a>{' '}
              and sign in with the same account.
            </li>
            <li>Open the URL above. http works immediately; https after the one-time step.</li>
          </ol>
        </CardBody>
      </Card>

      <Row className="text-muted small">
        <Col xs="12">
          IPv4: {self.ipv4 ?? '—'} · Tailscale {status.versions.tailscale ?? '—'} · engine{' '}
          {status.versions.server}
        </Col>
      </Row>
    </div>
  )
}

function statusLine(s: StatusSnapshot): string {
  switch (s.backendState) {
    case 'NoState':
    case 'Starting':
      return 'Starting Tailscale…'
    case 'NeedsLogin':
    case 'NeedsMachineAuth':
      return 'Login required — open the Connect screen.'
    case 'Stopped':
      return 'Tailscale is stopped.'
    default:
      return `State: ${s.backendState}`
  }
}
