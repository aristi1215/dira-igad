import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  CornerDownLeft,
  FileText,
  Loader2,
  Newspaper,
  Radar,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { streamAdvisor } from '../../lib/api'
import { useSelectedZone } from '../map/useSelectedZone'
import type { AdvisorCitation, OperationalBand, ZoneSummary } from '../../lib/types'
import { BAND_COLORS, BAND_LABELS, fmtRiskScore } from '../../lib/format'
import { Button, Callout } from '../../components/ui'
import { cx } from '../../lib/cx'
import { T } from '../../lib/motion'
import { useAdvisorStore } from './advisorStore'
import { renderMarkish } from './markish'

/** Human labels for the retrieval tools the backend actually names. */
const TOOL_LABELS: Record<string, string> = {
  read_situation: 'Reading the open situation',
  read_zone_context: 'Reading zone context',
  query_news_signals: 'Searching news signals',
  query_hazards: 'Checking hazard bulletins',
  query_field_reports: 'Reading field reports',
  read_watchlist: 'Scanning the regional watchlist',
}

const CITATION_STYLE: Record<string, { icon: typeof Newspaper; className: string }> = {
  news: { icon: Newspaper, className: 'bg-info-bg text-info-fg' },
  hazard: { icon: TriangleAlert, className: 'bg-warn-bg text-warn-fg' },
  field_report: { icon: FileText, className: 'bg-ok-bg text-ok-fg' },
}

type AskAdvisorProps = {
  situationId: string | null
  /** The selected zone, for grounding and for question suggestions. */
  zone?: ZoneSummary | null
}

/**
 * Questions worth asking about *this* zone.
 *
 * The three hardcoded prompts this replaced were generic enough to be useless
 * once a zone was selected — they never mentioned the place on screen, so they
 * read as filler rather than as a way in.
 */
function suggestionsFor(zone: ZoneSummary | null | undefined): string[] {
  if (!zone) {
    return [
      'Which zones need attention first this cycle?',
      'What changed across the region since the last cycle?',
      'Where is displacement rising fastest?',
    ]
  }
  const name = zone.zone_name
  const suggestions = [`Why is ${name} rated the way it is this cycle?`]
  if (zone.operational_band === 'high' || zone.operational_band === 'very_high') {
    suggestions.push(`What should a response team prepare for in ${name} over the next 30 days?`)
  } else {
    suggestions.push(`What would have to change for ${name} to escalate?`)
  }
  if ((zone.verified_field_reports_recent ?? 0) > 0) {
    suggestions.push(`What do the verified field reports from ${name} say?`)
  } else {
    suggestions.push(`What evidence is missing for ${name}?`)
  }
  return suggestions
}

export function AskAdvisor({ situationId, zone }: AskAdvisorProps) {
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const { selectedZoneId } = useSelectedZone()
  const logRef = useRef<HTMLDivElement>(null)

  const turns = useAdvisorStore((state) => state.turns)
  const conversationId = useAdvisorStore((state) => state.conversationId)
  const addTurn = useAdvisorStore((state) => state.addTurn)
  const appendToLast = useAdvisorStore((state) => state.appendToLast)
  const finishLast = useAdvisorStore((state) => state.finishLast)
  const setConversationId = useAdvisorStore((state) => state.setConversationId)
  const consumeSeed = useAdvisorStore((state) => state.consumeSeed)

  const ask = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || pending) return

    setQuestion('')
    setError(null)
    setActiveTools([])
    setPending(true)
    addTurn({ role: 'user', text: trimmed })
    // The assistant turn is created empty and filled by the deltas, so the
    // answer grows in place instead of appearing all at once at the end.
    addTurn({ role: 'assistant', text: '' })

    void streamAdvisor(trimmed, situationId, {
      zoneId: selectedZoneId,
      conversationId,
      onTool: (name) => setActiveTools((current) => [...current, name]),
      onConversation: setConversationId,
      onDelta: (text) => appendToLast(text),
      onDone: (payload) => {
        finishLast({ citations: payload.citations, tools: payload.tools_used })
        setPending(false)
        setActiveTools([])
      },
      onError: (message) => {
        setError(message)
        setPending(false)
        setActiveTools([])
      },
    }).catch(() => {
      setError('The advisor could not answer. Try again.')
      setPending(false)
      setActiveTools([])
    })
  }

  /*
   * A question seeded from elsewhere in the app fires once, on open.
   *
   * `ask` closes over this render's state, so it is mirrored into a ref from
   * an effect — never assigned during render, which the React Compiler
   * forbids. The seed effect then depends only on the store selector and
   * cannot re-fire when unrelated state changes.
   */
  const askRef = useRef(ask)
  useEffect(() => {
    askRef.current = ask
  })

  useEffect(() => {
    const seed = consumeSeed()
    if (seed) askRef.current(seed)
  }, [consumeSeed])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, pending])

  const band = (zone?.operational_band ?? null) as OperationalBand | null
  const suggestions = suggestionsFor(zone)

  return (
    <div className="flex h-full flex-col">
      {/* Grounding. Tinted by the band, so the panel is never colorless. */}
      <div
        className="shrink-0 border-b border-line px-4 py-2"
        style={{
          background: band
            ? `color-mix(in srgb, ${BAND_COLORS[band]} 7%, white)`
            : 'var(--color-surface-2)',
        }}
      >
        {zone ? (
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-eyebrow text-faint uppercase">
                Grounded in
              </span>
              <span className="block truncate text-sm font-medium text-ink">
                {zone.zone_name}
              </span>
            </span>
            {band ? (
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span
                  className="font-mono text-lg leading-none font-semibold tabular-nums"
                  style={{ color: BAND_COLORS[band] }}
                >
                  {fmtRiskScore(zone.model_risk)}
                </span>
                <span className="text-2xs" style={{ color: BAND_COLORS[band] }}>
                  {BAND_LABELS[band]}
                </span>
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Select a zone on the map for zone-specific answers.
          </p>
        )}
      </div>

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 && !pending ? (
          <div className="flex flex-col gap-2">
            <p className="text-eyebrow text-faint uppercase">
              Try asking
            </p>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                className={cx(
                  'group flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-left',
                  'text-sm text-muted transition-colors duration-[120ms]',
                  'hover:border-accent hover:bg-accent-soft hover:text-ink',
                )}
              >
                <Sparkles
                  size={13}
                  strokeWidth={1.75}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-line-strong transition-colors group-hover:text-accent"
                />
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {turns.map((turn, index) => (
            <div
              key={`${turn.role}-${index}`}
              className={cx(
                'rounded-md text-sm',
                turn.role === 'user'
                  ? 'ml-6 bg-accent-soft px-3 py-2.5 text-ink'
                  : 'border border-line bg-surface',
              )}
            >
              {turn.role === 'assistant' ? (
                <div
                  className="border-l-[3px] px-3 py-2.5"
                  style={{ borderLeftColor: band ? BAND_COLORS[band] : 'var(--color-accent)' }}
                >
                  {turn.text ? (
                    <div className="flex flex-col gap-2 leading-relaxed text-ink">
                      {renderMarkish(turn.text)}
                    </div>
                  ) : null}

                  {turn.citations && turn.citations.length > 0 ? (
                    <Citations citations={turn.citations} />
                  ) : null}
                </div>
              ) : (
                <p className="leading-relaxed whitespace-pre-wrap">{turn.text}</p>
              )}
            </div>
          ))}

          {/*
            The retrieval trace. These are real events — one per query the
            backend actually ran — which is a far better answer to "is it
            doing anything" than three pulsing dots, and it shows the answer
            is grounded rather than invented.
          */}
          <AnimatePresence>
            {pending ? (
              <motion.ul
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={T.fast}
                className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-3 py-2.5"
              >
                {activeTools.length === 0 ? (
                  <li className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 size={12} strokeWidth={2} aria-hidden className="animate-spin" />
                    Gathering context…
                  </li>
                ) : (
                  activeTools.map((tool, index) => (
                    <motion.li
                      key={`${tool}-${index}`}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={T.fast}
                      className="flex items-center gap-2 text-xs text-muted"
                    >
                      <Check
                        size={12}
                        strokeWidth={2.5}
                        aria-hidden
                        className="shrink-0 text-ok-fg"
                      />
                      {TOOL_LABELS[tool] ?? tool}
                    </motion.li>
                  ))
                )}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <form
        className="shrink-0 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault()
          ask(question)
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              ask(question)
            }
          }}
          placeholder={
            zone ? `Ask about ${zone.zone_name}…` : 'Ask about regional priorities…'
          }
          rows={2}
          aria-label="Your question"
          className="w-full resize-none rounded-sm border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink transition-colors duration-[120ms] placeholder:text-faint hover:border-faint focus:border-accent focus:ring-2 focus:ring-accent-ring focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-2xs text-faint">
            <Radar size={11} strokeWidth={1.75} aria-hidden />
            Read-only · cannot approve or dispatch
          </span>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
            disabled={question.trim().length === 0}
            icon={pending ? undefined : CornerDownLeft}
          >
            {pending ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
        {error ? (
          <Callout tone="danger" className="mt-2">
            {error}
          </Callout>
        ) : null}
      </form>
    </div>
  )
}

/**
 * Sources, numbered so the answer can point at them.
 *
 * Colored and iconed by kind, because "a news article said this" and "a
 * verified field report said this" carry very different weight in this domain
 * and a uniform grey list flattened that distinction away.
 */
function Citations({ citations }: { citations: AdvisorCitation[] }) {
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <p className="mb-1.5 text-eyebrow text-faint uppercase">
        Sources
      </p>
      <ul className="flex flex-col gap-1">
        {citations.slice(0, 6).map((citation, index) => {
          const style = CITATION_STYLE[citation.kind] ?? {
            icon: FileText,
            className: 'bg-canvas text-muted',
          }
          const Icon = style.icon
          return (
            <li key={`${citation.title}-${index}`} className="flex items-start gap-2 text-xs">
              <span
                className={cx(
                  'mt-px flex size-4 shrink-0 items-center justify-center rounded-xs',
                  style.className,
                )}
                aria-hidden
              >
                <Icon size={10} strokeWidth={2} />
              </span>
              <span className="min-w-0 text-muted">
                <span className="font-mono text-2xs text-faint">[{index + 1}]</span>{' '}
                {citation.title}
                {citation.source ? (
                  <span className="text-faint"> — {citation.source}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
