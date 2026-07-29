/**
 * Dira UI primitives.
 *
 * Conventions:
 *  - Icons come straight from `lucide-react` — no wrapper component. Standard
 *    props are `size={16} strokeWidth={1.75} aria-hidden`; 18 inside buttons,
 *    20 maximum.
 *  - Variable class names must come from an explicit Record<K, string> of full
 *    literal names. Tailwind cannot see `bg-band-${band}` and fails silently.
 *  - Preflight is disabled (see index.css), so always write `border border-line`,
 *    never a bare `border`.
 */
export { Button, IconButton, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export { Field, TextInput, Select, SearchInput } from './Field'
export { Tabs, type TabItem } from './Tabs'
export { DataTable, type Column } from './DataTable'
export { Skeleton, SkeletonText, SkeletonCard, SkeletonRows, ScreenSkeleton } from './Skeleton'
export { Tooltip, InfoHint } from './Tooltip'
export { Sheet } from './Sheet'
export { Meter, ScoreMeter } from './Meter'
export { Stat, StatTile, StatRow, MetricDelta } from './Stat'
export { Sparkline } from './Sparkline'
export { Card, PageHeader, SectionHeader, Section, Screen } from './Card'
export { BandChip, BandDot, IpcChip, StatusChip, type StatusTone } from './Chips'
export {
  Callout,
  EmptyState,
  LoadingNote,
  ErrorNote,
  QueryState,
  type CalloutTone,
} from './Notes'
export { Kbd } from './Kbd'
