import type { ReactNode } from 'react'
import type { AdvisorCitation } from '../../lib/types'

/**
 * The smallest useful subset of markdown: paragraphs, `-` bullets, `**bold**`,
 * and `[S3]` inline citation markers.
 *
 * Not a markdown library. The advisor is capped at 180-320 words by its
 * system prompt and forbidden from producing tables, headings or code, so a
 * parser would be several hundred KB to render four constructs. Anything it
 * does not recognise falls through as plain text rather than as visible
 * syntax.
 *
 * Rendering is escape-free by construction — every branch produces React
 * elements and text nodes, never `dangerouslySetInnerHTML` — so model output
 * cannot inject markup.
 */
export function renderMarkish(text: string, citations: AdvisorCitation[] = []): ReactNode[] {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')

  let paragraph: string[] = []
  let bullets: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-relaxed">
        {inline(paragraph.join(' '), citations)}
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
            <span>{inline(item, citations)}</span>
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

/** DOM id of a source row in the `Citations` list — shared with `AskAdvisor`
 * so a `[S3]` chip can scroll to and briefly highlight its source. */
export function citationRowId(citationId: string): string {
  return `advisor-source-${citationId}`
}

function jumpToSource(citationId: string) {
  const row = document.getElementById(citationRowId(citationId))
  if (!row) return
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  row.classList.add('ring-2', 'ring-accent')
  window.setTimeout(() => row.classList.remove('ring-2', 'ring-accent'), 900)
}

/** `**bold**` and `[S3]` citation markers within a line. Everything else
 * stays literal. */
function inline(text: string, citations: AdvisorCitation[]): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|\[S(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1] !== undefined) {
      parts.push(
        <strong key={`b-${match.index}`} className="font-semibold text-ink">
          {match[1]}
        </strong>,
      )
    } else {
      const citationId = `S${match[2]}`
      const known = citations.some((citation) => citation.id === citationId)
      parts.push(
        <button
          key={`c-${match.index}`}
          type="button"
          disabled={!known}
          onClick={() => jumpToSource(citationId)}
          aria-label={`Jump to source ${citationId}`}
          className="mx-0.5 inline-flex h-4 min-w-4 translate-y-[-3px] items-center justify-center rounded-xs bg-accent-soft px-1 text-2xs font-semibold text-accent enabled:hover:bg-accent enabled:hover:text-white disabled:cursor-default disabled:opacity-50"
        >
          {match[2]}
        </button>,
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}
