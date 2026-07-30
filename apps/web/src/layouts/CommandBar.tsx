import { NavLink } from 'react-router-dom'
import { motion } from 'motion/react'
import { Compass, Moon, MessageSquareText, Sun } from 'lucide-react'
import { cx } from '../lib/cx'
import { T } from '../lib/motion'
import { Button, IconButton } from '../components/ui'
import { useThemeStore } from '../stores/theme'
import { StatusCluster } from './StatusCluster'
import { BrandMark } from './BrandMark'
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './navItems'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'

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
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)

  return (
    <header
      className={cx(
        'z-header flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface/80 px-4 backdrop-blur-xl',
        // A rule plus a whisper of cast shadow, so the bar sits above the
        // canvas instead of being drawn onto it.
      )}
    >
      <div className="flex shrink-0 items-baseline gap-2" data-tour={TOUR_ANCHORS.brand}>
        <span className="flex items-center gap-2">
          <BrandMark size={21} className="text-accent" />
          <span className="text-xl leading-none font-semibold tracking-[-0.02em] text-ink">
            Dira
          </span>
        </span>
        <span className="hidden text-2xs font-semibold tracking-[0.08em] text-accent uppercase sm:inline">
          The Next Horizon
        </span>
        <span aria-hidden className="hidden h-5 w-px bg-line lg:block" />
        <span className="text-eyebrow hidden text-faint uppercase lg:inline">
          Early warning · IGAD
        </span>
      </div>

      {/*
        Scrolls rather than forcing the bar wide. Seven pills plus the brand,
        status cluster and two buttons need ~650px of the bar's own width; with
        no wrap and no scroll, everything below that overflowed with no way to
        reach it.
      */}
      <nav
        aria-label="Primary"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {PRIMARY_NAV.map((item) => (
          <NavItemLink key={item.to} item={item} layoutId="nav-primary" />
        ))}
        <span aria-hidden className="mx-2 h-5 w-px shrink-0 bg-line" />
        {SECONDARY_NAV.map((item) => (
          <NavItemLink key={item.to} item={item} layoutId="nav-primary" subdued />
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <StatusCluster cycle={cycle} dataMode={dataMode} degraded={degraded} />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          size="sm"
          onClick={toggleTheme}
        />
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
          {/* Hidden below sm, matching Guide — this was the widest item in the
              right cluster and the only one with no responsive treatment. */}
          <span className="hidden sm:inline">Ask Dira</span>
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
    /*
     * A native title rather than the Tooltip primitive. Tooltip's trigger span
     * is tabIndex={0}, so wrapping a link in it would give every nav item two
     * tab stops — fourteen across this bar.
     */
    <NavLink
      to={item.to}
      end={item.end}
      title={`${item.label} — ${item.hint}  (G then ${item.key.toUpperCase()})`}
      className={({ isActive }) =>
        cx(
          'relative flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
          'transition-colors duration-[120ms] ease-standard',
          // Active is a real state, not a hairline: the label, the icon and the
          // plate all move together.
          isActive
            ? 'bg-accent-soft text-accent-deep'
            : subdued
              ? 'text-faint hover:bg-surface-3 hover:text-ink'
              : 'text-muted hover:bg-surface-3 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={isActive ? 15 : 14} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
          <span className="hidden md:inline">{item.label}</span>
          {isActive ? (
            <motion.span
              layoutId={layoutId}
              transition={T.panel}
              aria-hidden
              className="absolute inset-x-1.5 -bottom-[11px] h-0.5 rounded-full bg-accent"
            />
          ) : null}
        </>
      )}
    </NavLink>
  )
}
