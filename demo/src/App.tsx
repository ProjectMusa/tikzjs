import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Playground } from './pages/Playground'
import { Report } from './pages/Report'
import { theme } from './theme'

const navStyle = ({ isActive }: { isActive: boolean }) => ({
  fontWeight: isActive ? 700 : 400,
  color: isActive ? theme.text : theme.muted,
  textDecoration: 'none' as const,
})

export function App() {
  return (
    <HashRouter>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            padding: '0 16px',
            height: 44,
            background: theme.bg,
            borderBottom: `1px solid ${theme.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 700, color: theme.text, fontSize: 15 }}>tikzjs</span>
          <NavLink to="/" style={navStyle}>
            Playground
          </NavLink>
          <NavLink to="/report" style={navStyle}>
            Golden Diff
          </NavLink>
        </nav>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Playground />} />
            <Route path="/report" element={<Report />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  )
}
