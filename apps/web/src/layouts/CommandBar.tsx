import { NavLink } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  BarChart3,
  Compass,
  Database,
  LayoutGrid,
  ListTree,
  Map as MapIcon,
  Megaphone,
  MessageSquareText,
  Microscope,
  type LucideIcon,
} from 'lucide-react'
import { cx } from '../lib/cx'
import { T } from '../lib/motion'
import { Button } from '../components/ui'
import { StatusCluster } from './StatusCluster'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }

/**
 * Seven flat links gave every destination equal weight. They are split into
 * what you *do* (the operational loop) and what you consult to trust the
 * system — a distinction the old bar hid.
 */
const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Map', icon: MapIcon, end: true },
  { to: '/situations', label: 'Situations', icon: ListTree },
  { to: '/zones', label: 'Zones', icon: LayoutGrid },
  { to: '/dispatch', label: 'Dispatch', icon: Megaphone },
]

const SECONDARY_NAV: NavItem[] = [
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/model', label: 'Model', icon: Microscope },
  { to: '/sources', label: 'Sources', icon: Database },
]

export function CommandBar({
  cycle,
  dataMode,
  degraded,
  advisorOpen,
  onToggleAdvisor,
  onOpenTour,
  tourResumable,
}: {
  cycle: string | null
  dataMode: string | null
  degraded: boolean
  advisorOpen: boolean
  onToggleAdvisor: () => void
  onOpenTour: () => void
  tourResumable: boolean
}) {
  return (
    <header className="z-header flex h-13 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="flex shrink-0 items-baseline gap-2.5" data-tour={TOUR_ANCHORS.brand}>
        <span className="font-display text-lg leading-none font-bold tracking-[0.06em] text-ink">
          DIRA
        </span>
        <span className="hidden text-2xs text-faint lg:inline">
          Early-warning situation room · IGAD
        </span>
      </div>

      <nav aria-label="Primary" className="flex min-w-0 items-center gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <NavItemLink key={item.to} item={item} layoutId="nav-primary" />
        ))}
        <span aria-hidden className="mx-2 h-5 w-px bg-line" />
        {SECONDARY_NAV.map((item) => (
          <NavItemLink key={item.to} item={item} layoutId="nav-primary" subdued />
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <StatusCluster cycle={cycle} dataMode={dataMode} degraded={degraded} />
        <div className="relative">
          <Button variant="ghost" size="sm" icon={Compass} onClick={onOpenTour}>
            <span className="hidden sm:inline">Guide</span>
          </Button>
          {tourResumable ? (
            <span
              aria-label="Tour in progress"
              className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent"
            />
          ) : null}
        </div>
        <Button
          variant={advisorOpen ? 'primary' : 'secondary'}
          size="sm"
          icon={MessageSquareText}
          aria-expanded={advisorOpen}
          onClick={onToggleAdvisor}
          data-tour={TOUR_ANCHORS.askDira}
        >
          Ask Dira
        </Button>
      </div>
    </header>
  )
}

function NavItemLink({
  item,
  layoutId,
  subdued = false,
}: {
  item: NavItem
  layoutId: string
  subdued?: boolean
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cx(
          'relative flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium whitespace-nowrap',
          'transition-colors duration-[120ms] ease-standard',
          isActive
            ? 'text-ink'
            : subdued
              ? 'text-faint hover:bg-surface-3 hover:text-ink'
              : 'text-muted hover:bg-surface-3 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={15} strokeWidth={1.75} aria-hidden />
          <span className="hidden md:inline">{item.label}</span>
          {isActive ? (
            <motion.span
              layoutId={layoutId}
              transition={T.panel}
              aria-hidden
              className="absolute inset-x-1.5 -bottom-[9px] h-0.5 rounded-full bg-accent"
            />
          ) : null}
        </>
      )}
    </NavLink>
  )
}
