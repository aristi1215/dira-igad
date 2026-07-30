import { extendTailwindMerge } from 'tailwind-merge'

/*
 * `cx` used to be a plain join, which meant a `className` prop could not
 * reliably override a primitive's own utility for the same CSS property: with
 * two competing classes in the attribute, the winner is decided by the order
 * Tailwind emitted them (which follows `@theme` declaration order), not by the
 * order they were written. Overrides worked or silently did nothing depending
 * on which token happened to be declared first.
 *
 * tailwind-merge resolves that by dropping the losing class outright, so the
 * last one written wins. It has to be told about the custom scale, though:
 * anything it does not recognise after `text-` is classified as a *color*, so
 * an unconfigured merge would quietly eat `text-eyebrow` from
 * `text-eyebrow text-faint` — which is exactly what `Eyebrow` emits. Custom
 * *colors* need no entry; the color validators accept any token after a known
 * prefix.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Custom --text-* steps that are sizes, not colors.
      'font-size': [{ text: ['2xs', 'md', 'eyebrow', 'metric'] }],
      rounded: [{ rounded: ['bento'] }],
      z: [{ z: ['map-base', 'map-ui', 'map-panel', 'header', 'drawer', 'modal', 'tour', 'tooltip'] }],
      shadow: [{ shadow: ['bento', 'panel'] }],
      ease: [{ ease: ['standard', 'entrance', 'exit'] }],
      animate: [{ animate: ['shimmer', 'indeterminate', 'flash-ring', 'signal-pulse'] }],
    },
  },
})

/** Joins class names, dropping falsy entries and resolving conflicts left-to-right. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(' '))
}
