import { useState } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Playground } from './pages/Playground'
import { Report } from './pages/Report'
import { theme } from './theme'

const navStyle = ({ isActive }: { isActive: boolean }) => ({
  color: isActive ? theme.text : theme.muted,
})

export function App() {
  const [isDark, setIsDark] = useState(true)

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
  }

  return (
    <HashRouter>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            padding: 0,
            height: 44,
            background: theme.bg,
            borderBottom: `1px solid ${theme.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 700, color: theme.accent, fontSize: 15, padding: '0 16px' }}>tikzjs</span>
          <NavLink to="/" style={navStyle} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} end>
            Playground
          </NavLink>
          <NavLink to="/report" style={navStyle} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Golden Diff
          </NavLink>
          <div style={{ flex: 1 }} />
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.muted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              flexShrink: 0,
            }}
          >
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </nav>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Playground isDark={isDark} />} />
            <Route path="/report" element={<Report />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  )
}
