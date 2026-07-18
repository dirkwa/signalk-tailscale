import { Alert } from 'reactstrap'
import type { StatusSnapshot } from '../api'

const ENABLE_HTTPS_URL = 'https://login.tailscale.com/admin/dns'

/**
 * Shown when serve reports an HTTPS/cert problem (serve.lastError or a cert
 * Health message). MagicDNS HTTPS certs are NOT on by default for new tailnets;
 * this is the single non-zero-config step, so we surface a deep link. The
 * http:// URL works meanwhile, so this is a nudge, not an error.
 */
export function HttpsHint({ status }: { status: StatusSnapshot | null }) {
  if (!status) return null

  const serveErr = status.serve.lastError
  const certHealth = status.health.find(
    (h) => /https|cert/i.test(h) && /enable|not (yet )?available|no cert/i.test(h)
  )
  const message = serveErr ?? certHealth
  // Only show for the HTTPS-pending flavour; other serve errors render on the
  // Dashboard itself.
  if (!message || !/https|cert/i.test(message)) return null

  return (
    <Alert color="info">
      <strong>One-time step to enable HTTPS.</strong> Your boat is reachable over http now. For a
      padlock (https://), turn on HTTPS certificates for your tailnet:{' '}
      <a className="alert-link" href={ENABLE_HTTPS_URL} target="_blank" rel="noreferrer">
        Enable HTTPS in the Tailscale admin console ↗
      </a>
      . It applies to this device automatically within a minute.
    </Alert>
  )
}
