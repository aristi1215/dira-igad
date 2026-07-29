import { Suspense, lazy } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { MapScreen } from './screens/MapScreen'
import { SituationsScreen } from './screens/SituationsScreen'
import { ZonesScreen } from './screens/ZonesScreen'
import { DispatchScreen } from './screens/DispatchScreen'
import { ScreenSkeleton } from './components/ui'

/*
 * The landing route is the map, so it should not pay for recharts. These five
 * chart-heavy screens are code-split; `routes/preload.ts` warms them for the
 * guided tour.
 */
const SituationDetailScreen = lazy(async () => ({
  default: (await import('./screens/SituationDetailScreen')).SituationDetailScreen,
}))
const ZoneDossierScreen = lazy(async () => ({
  default: (await import('./screens/ZoneDossierScreen')).ZoneDossierScreen,
}))
const AnalyticsScreen = lazy(async () => ({
  default: (await import('./screens/AnalyticsScreen')).AnalyticsScreen,
}))
const ModelScreen = lazy(async () => ({
  default: (await import('./screens/ModelScreen')).ModelScreen,
}))
const SourcesScreen = lazy(async () => ({
  default: (await import('./screens/SourcesScreen')).SourcesScreen,
}))

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<MapScreen />} />
        <Route path="/situations" element={<SituationsScreen />} />
        <Route
          path="/situations/:id"
          element={
            <Suspense fallback={<ScreenSkeleton />}>
              <SituationDetailScreen />
            </Suspense>
          }
        />
        <Route path="/zones" element={<ZonesScreen />} />
        <Route
          path="/zones/:id"
          element={
            <Suspense fallback={<ScreenSkeleton />}>
              <ZoneDossierScreen />
            </Suspense>
          }
        />
        <Route path="/dispatch" element={<DispatchScreen />} />
        <Route
          path="/analytics"
          element={
            <Suspense fallback={<ScreenSkeleton />}>
              <AnalyticsScreen />
            </Suspense>
          }
        />
        <Route
          path="/model"
          element={
            <Suspense fallback={<ScreenSkeleton />}>
              <ModelScreen />
            </Suspense>
          }
        />
        <Route
          path="/sources"
          element={
            <Suspense fallback={<ScreenSkeleton />}>
              <SourcesScreen />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start gap-4 px-6 pt-16">
      <div>
        <p className="text-2xs font-semibold tracking-[0.08em] text-accent uppercase">
          Page not found
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          There is nothing at this address.
        </h1>
        <p className="mt-1.5 text-base text-muted">
          The link may be out of date, or the zone or situation it pointed to has since resolved.
        </p>
      </div>
      <Link
        to="/"
        className="inline-flex h-8.5 items-center rounded-sm border border-accent bg-accent px-3.5 text-sm font-medium text-white transition-colors duration-[120ms] hover:border-accent-hover hover:bg-accent-hover hover:text-white"
      >
        Back to the map
      </Link>
    </div>
  )
}

export default App
