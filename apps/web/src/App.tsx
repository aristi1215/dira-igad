import './App.css'

/**
 * Dira web shell.
 * Feature folders: features/map | situations | advisor | dispatch
 * Server state → TanStack Query; UI chrome → small Zustand; forms → useState.
 * SSE patches Query cache only — no parallel delivery store.
 */
function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Dira</h1>
        <p>Causal situation room — Horn of Africa</p>
      </header>
      <main className="app-main">
        <p className="scaffold-note">
          Scaffold ready. Implement MapLibre map, Tabiri cards, Amani risk,
          Onya dispatch panel, and the advisor sidebar.
        </p>
      </main>
    </div>
  )
}

export default App
