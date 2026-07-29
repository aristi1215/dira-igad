/** Minimal className joiner. Falsy entries are dropped. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
