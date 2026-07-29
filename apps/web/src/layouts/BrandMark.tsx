/**
 * The Dira mark.
 *
 * Concentric arcs opening to the east, cut by a radial sweep and anchored on a
 * solid core — a signal propagating outward from a place. It is the same
 * vocabulary as the map's situation anchors, so the brand and the data read as
 * one system rather than a logo bolted onto a dashboard.
 *
 * Drawn in `currentColor` so a single element can be tinted by its context.
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* Outer arc — the faintest ring, furthest from the source. */}
      <path
        d="M7.6 3.6a10 10 0 0 1 0 16.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.28"
      />
      <path
        d="M7.6 7.4a6.2 6.2 0 0 1 0 9.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M7.6 10.9a2.9 2.9 0 0 1 0 2.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* The core: where the reading is taken. */}
      <circle cx="6" cy="12" r="2.4" fill="currentColor" />
    </svg>
  )
}
