/**
 * Warm the code-split routes. The guided tour navigates between screens, and
 * a lazy chunk that starts loading only once the route renders would leave the
 * spotlight waiting on an anchor that does not exist yet.
 */
const LOADERS = [
  () => import('../screens/SituationDetailScreen'),
  () => import('../screens/ZoneDossierScreen'),
  () => import('../screens/AnalyticsScreen'),
  () => import('../screens/ModelScreen'),
  () => import('../screens/SourcesScreen'),
]

export function preloadScreens(): void {
  for (const load of LOADERS) {
    void load().catch(() => {
      // A failed prefetch is not an error — the route will load on demand.
    })
  }
}
