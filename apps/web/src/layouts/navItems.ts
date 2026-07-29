import {
  BarChart3,
  Database,
  LayoutGrid,
  ListTree,
  Map as MapIcon,
  Megaphone,
  Microscope,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Second key of the `G`-prefixed chord that jumps here. */
  key: string
  hint: string
}

/**
 * The destinations, split by what they are for.
 *
 * Seven flat links gave every screen equal weight. These are what you *do* —
 * the operational loop from seeing pressure to placing a call.
 *
 * Lives in its own module rather than in `CommandBar` because `AppLayout`
 * needs the same list to bind the keyboard chords, and a component file that
 * also exports constants breaks Fast Refresh.
 */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Map', icon: MapIcon, end: true, key: 'm', hint: 'Where the pressure is' },
  {
    to: '/situations',
    label: 'Situations',
    icon: ListTree,
    key: 's',
    hint: 'Open situations, worst first',
  },
  { to: '/zones', label: 'Zones', icon: LayoutGrid, key: 'z', hint: 'All 22 zones, side by side' },
  { to: '/dispatch', label: 'Dispatch', icon: Megaphone, key: 'd', hint: 'Approve and send alerts' },
]

/** And these are what you consult to decide whether to trust the system. */
export const SECONDARY_NAV: NavItem[] = [
  { to: '/analytics', label: 'Analytics', icon: BarChart3, key: 'a', hint: 'Regional trends' },
  { to: '/model', label: 'Model', icon: Microscope, key: 'o', hint: 'How the forecast is made' },
  {
    to: '/sources',
    label: 'Sources',
    icon: Database,
    key: 'r',
    hint: 'Where every number came from',
  },
]
