import './App.css'
import 'maplibre-gl/dist/maplibre-gl.css'

import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { AdvisorPanel } from './features/advisor/AdvisorPanel'
import { DispatchPanel } from './features/dispatch/DispatchPanel'
import { MapView } from './features/map/MapView'
import { TabiriCard } from './features/situations/TabiriCard'
import { useCreateDraft, useSituations } from './hooks/queries'
import { useDiraStream } from './lib/sse'
import type { AlertDraft } from './lib/types'
import { useMapUiStore } from './stores/mapUi'

function App() {
  const qc = useQueryClient()
  const connected = useDiraStream(qc)
  // Backup polling every 3s only while SSE is down (server stays the source of truth).
  const { data } = useSituations(connected ? false : 3000)

  const selectedSituationId = useMapUiStore((s) => s.selectedSituationId)
  const setSelected = useMapUiStore((s) => s.setSelectedSituationId)
  const [draft, setDraft] = useState<AlertDraft | null>(null)
  const [deliveriesCreated, setDeliveriesCreated] = useState(false)
  const createDraft = useCreateDraft()

  const selectedFeature = useMemo(
    () => data?.features.find((f) => f.properties.situation_id === selectedSituationId) ?? null,
    [data, selectedSituationId],
  )

  const handleSelect = (sid: string) => {
    setSelected(sid)
    setDraft(null)
    setDeliveriesCreated(false)
  }

  const handlePrepare = () => {
    if (!selectedSituationId) return
    createDraft.mutate(selectedSituationId, { onSuccess: (d) => setDraft(d) })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Dira</h1>
          <p>Causal situation room — Horn of Africa (Mandera)</p>
        </div>
        <span className={`conn ${connected ? 'on' : 'off'}`}>
          {connected ? 'live' : 'polling'}
        </span>
      </header>

      <main className="app-main">
        <section className="map-pane">
          <MapView
            data={data}
            selectedSituationId={selectedSituationId}
            onSelect={handleSelect}
          />
        </section>

        <aside className="side-pane">
          {!selectedSituationId && (
            <div className="card empty">
              Select a coloured zone on the map to open its Tabiri card.
            </div>
          )}
          {selectedSituationId && (
            <TabiriCard
              situationId={selectedSituationId}
              exposedPopulation={selectedFeature?.properties.exposed_population ?? null}
              onPrepareAlert={handlePrepare}
              preparing={createDraft.isPending}
            />
          )}
          {draft && (
            <AdvisorPanel draft={draft} onApproved={() => setDeliveriesCreated(true)} />
          )}
          {draft && deliveriesCreated && <DispatchPanel alertId={draft.id} />}
        </aside>
      </main>
    </div>
  )
}

export default App
