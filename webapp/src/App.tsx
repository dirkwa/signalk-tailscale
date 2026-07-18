import { useState } from 'react'
import { Container, Nav, NavItem, NavLink, Spinner, Alert } from 'reactstrap'
import { useStatus } from './useStatus'
import { ConnectCard } from './components/ConnectCard'
import { Dashboard } from './components/Dashboard'
import { SettingsPanel } from './components/SettingsPanel'

type Route = 'connect' | 'dashboard' | 'settings'

const ROUTES: { id: Route; label: string }[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' }
]

// In-memory tab state; admin owns the URL hash so we can't write to it without
// breaking navigation.
export function App() {
  const { status, error, loading } = useStatus()
  const running = status?.backendState === 'Running'
  // Land on Dashboard once connected; Connect while logging in.
  const [route, setRoute] = useState<Route>('connect')

  return (
    <Container className="py-4">
      <div className="d-flex align-items-center mb-4">
        <img src="/signalk-tailscale/icon.svg" alt="" width={40} height={40} className="me-3" />
        <h1 className="mb-0">SignalK Tailscale</h1>
        <small className="text-muted ms-3 align-self-end mb-2">v{__PLUGIN_VERSION__}</small>
      </div>

      <Nav tabs className="mb-3">
        {ROUTES.map((r) => (
          <NavItem key={r.id}>
            <NavLink
              href="#"
              active={route === r.id}
              onClick={(e) => {
                e.preventDefault()
                setRoute(r.id)
              }}
            >
              {r.label}
            </NavLink>
          </NavItem>
        ))}
      </Nav>

      {loading && (
        <div className="text-center py-5">
          <Spinner /> <span className="ms-2">Loading Tailscale status…</span>
        </div>
      )}

      {!loading && error && (
        <Alert color="warning">
          Couldn’t reach the Tailscale engine: {error}. It may still be starting — this page retries
          automatically.
        </Alert>
      )}

      {!loading && (
        <>
          {route === 'connect' && (
            <ConnectCard
              status={status}
              onConnected={() => {
                setRoute('dashboard')
              }}
            />
          )}
          {route === 'dashboard' && (
            <Dashboard
              status={status}
              running={running}
              onGoConnect={() => {
                setRoute('connect')
              }}
            />
          )}
          {route === 'settings' && <SettingsPanel status={status} />}
        </>
      )}
    </Container>
  )
}
