import { useEffect, useState } from 'react'
import {
  Card,
  CardBody,
  CardTitle,
  Button,
  Input,
  Label,
  FormGroup,
  Alert,
  Spinner
} from 'reactstrap'
import {
  updateRoutes,
  suggestRoutes,
  checkUpdate,
  applyUpdate,
  logout,
  type StatusSnapshot,
  type UpdateCheckResult
} from '../api'

const ADMIN_ROUTES_URL = 'https://login.tailscale.com/admin/machines'

interface Props {
  status: StatusSnapshot | null
}

export function SettingsPanel({ status }: Props) {
  // ---- subnet router ----
  const advertised = status?.routes.advertised ?? []
  const [routeInput, setRouteInput] = useState('')
  const [acceptRoutes, setAcceptRoutes] = useState(status?.routes.accepted ?? false)
  const [suggested, setSuggested] = useState<string[]>([])
  const [routeMsg, setRouteMsg] = useState<string | null>(null)
  const [routeErr, setRouteErr] = useState<string | null>(null)
  const [savingRoutes, setSavingRoutes] = useState(false)

  // Seed the input from the currently-advertised route once it appears. Keyed
  // on advertised.length so we don't clobber the user's edits every render.
  useEffect(() => {
    if (advertised.length > 0 && routeInput === '') setRouteInput(advertised.join(', '))
  }, [advertised.length, advertised, routeInput])

  useEffect(() => {
    setAcceptRoutes(status?.routes.accepted ?? false)
  }, [status?.routes.accepted])

  useEffect(() => {
    let cancelled = false
    suggestRoutes()
      .then((s) => {
        if (!cancelled) setSuggested(s)
      })
      .catch(() => {
        /* suggestion is best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const parseCidrs = (text: string): string[] =>
    text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  const saveRoutes = () => {
    void (async () => {
      setSavingRoutes(true)
      setRouteMsg(null)
      setRouteErr(null)
      try {
        const routes = parseCidrs(routeInput)
        await updateRoutes({ advertiseRoutes: routes, acceptRoutes })
        setRouteMsg(
          routes.length > 0
            ? 'Saved. Approve the advertised routes in the Tailscale admin console for them to take effect.'
            : 'Saved.'
        )
      } catch (err) {
        setRouteErr(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingRoutes(false)
      }
    })()
  }

  // ---- updates ----
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [updateErr, setUpdateErr] = useState<string | null>(null)

  const doCheck = () => {
    void (async () => {
      setChecking(true)
      setUpdateErr(null)
      try {
        setUpdate(await checkUpdate())
      } catch (err) {
        setUpdateErr(err instanceof Error ? err.message : String(err))
      } finally {
        setChecking(false)
      }
    })()
  }

  const doApply = () => {
    void (async () => {
      setApplying(true)
      setUpdateErr(null)
      try {
        await applyUpdate()
        setUpdate(null)
      } catch (err) {
        setUpdateErr(err instanceof Error ? err.message : String(err))
      } finally {
        setApplying(false)
      }
    })()
  }

  // ---- logout (danger zone) ----
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutErr, setLogoutErr] = useState<string | null>(null)

  const doLogout = () => {
    if (
      !window.confirm(
        'Log out of Tailscale? This removes the boat from your tailnet and requires a fresh login to reconnect. Backups that include the node key can resurrect it on replacement hardware.'
      )
    ) {
      return
    }
    void (async () => {
      setLoggingOut(true)
      setLogoutErr(null)
      try {
        await logout()
      } catch (err) {
        setLogoutErr(err instanceof Error ? err.message : String(err))
      } finally {
        setLoggingOut(false)
      }
    })()
  }

  return (
    <div>
      <Card className="mb-3">
        <CardBody>
          <CardTitle tag="h5">Subnet router (advanced)</CardTitle>
          <p className="text-muted">
            Expose your whole boat LAN over Tailscale, not just SignalK. Advertise the CIDR, then{' '}
            <a href={ADMIN_ROUTES_URL} target="_blank" rel="noreferrer">
              approve it in the admin console
            </a>
            .
          </p>

          <FormGroup>
            <Label for="routeInput">Advertised routes (comma-separated CIDRs)</Label>
            <Input
              id="routeInput"
              value={routeInput}
              placeholder="192.168.0.0/24"
              onChange={(e) => {
                setRouteInput(e.target.value)
              }}
            />
            {suggested.length > 0 && (
              <div className="form-text">
                Suggested for this host:{' '}
                {suggested.map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    color="link"
                    className="p-0 me-2"
                    onClick={() => {
                      setRouteInput(c)
                    }}
                  >
                    {c}
                  </Button>
                ))}
              </div>
            )}
          </FormGroup>

          <FormGroup check className="mb-3">
            <Input
              type="checkbox"
              id="acceptRoutes"
              checked={acceptRoutes}
              onChange={(e) => {
                setAcceptRoutes(e.target.checked)
              }}
            />
            <Label check for="acceptRoutes">
              Accept routes advertised by other devices in the tailnet
            </Label>
          </FormGroup>

          <Button color="primary" onClick={saveRoutes} disabled={savingRoutes}>
            {savingRoutes ? 'Saving…' : 'Save routes'}
          </Button>
          {routeMsg && (
            <Alert color="success" className="mt-3 mb-0">
              {routeMsg}
            </Alert>
          )}
          {routeErr && (
            <Alert color="danger" className="mt-3 mb-0">
              {routeErr}
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardBody>
          <CardTitle tag="h5">Updates</CardTitle>
          <Button color="secondary" outline onClick={doCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>{' '}
          {update && update.updateAvailable && (
            <Button color="primary" onClick={doApply} disabled={applying} className="ms-2">
              {applying ? (
                <>
                  <Spinner size="sm" /> Updating…
                </>
              ) : (
                `Update to ${update.latestVersion ?? 'latest'}`
              )}
            </Button>
          )}
          {update && !update.updateAvailable && (
            <span className="ms-2 text-muted">
              Up to date{update.currentVersion ? ` (${update.currentVersion})` : ''}.
            </span>
          )}
          {updateErr && (
            <Alert color="danger" className="mt-3 mb-0">
              {updateErr}
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card className="border-danger">
        <CardBody>
          <CardTitle tag="h5" className="text-danger">
            Danger zone
          </CardTitle>
          <p className="text-muted">
            Logging out removes this boat from your tailnet. Disabling the plugin instead just drops
            the VPN and keeps the identity, so re-enabling reconnects without a new login.
          </p>
          <Button color="danger" outline onClick={doLogout} disabled={loggingOut}>
            {loggingOut ? 'Logging out…' : 'Log out of Tailscale'}
          </Button>
          {logoutErr && (
            <Alert color="danger" className="mt-3 mb-0">
              {logoutErr}
            </Alert>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
