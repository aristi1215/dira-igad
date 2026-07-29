import type { ReactNode } from 'react'

/**
 * The smallest useful subset of markdown: paragraphs, `-` bullets, `**bold**`.
 *
 * Not a markdown library. The advisor is capped at 180 words by its system
 * prompt and forbidden from producing tables, headings or code, so a parser
 * would be several hundred KB to render three constructs. Anything it does not
 * recognise falls through as plain text rather than as visible syntax.
 *
 * Rendering is escape-free by construction — every branch produces React
 * elements and text nodes, never `dangerouslySetInnerHTML` — so model output
 * cannot inject markup.
 */
export function renderMarkish(text: string): ReactNode[] {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')

  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-relaxed">
        {inline(paragraph.join(' '))}
      </p>,
    )
    paragraph = []
  }

  const flushBullets = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="flex flex-col gap-1 pl-1">
        {bullets.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm leading-relaxed">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-line-strong" />
            <span>{inline(item)}</span>
          </li>
        ))}
      </ul>,
    )
    bullets = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flushBullets()
      flushParagraph()
      continue
    }
    // `-`, `*` and `1.` all read as a list to a human; treat them alike.
    const bullet = /^([-*•]|\d+[.)])\s+(.*)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      bullets.push(bullet[2])
      continue
    }
    flushBullets()
    paragraph.push(trimmed)
  }
  flushBullets()
  flushParagraph()

  return blocks
}

/** `**bold**` within a line. Everything else stays literal. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <strong key={`b-${match.index}`} className="font-semibold text-ink">
        {match[1]}
      </strong>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}
