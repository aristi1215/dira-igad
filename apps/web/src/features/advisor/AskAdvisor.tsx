import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CornerDownLeft, Quote, Wrench } from 'lucide-react'
import { askAdvisor } from '../../lib/api'
import { useSelectedZone } from '../map/useSelectedZone'
import type { AdvisorCitation } from '../../lib/types'
import { Button, Callout } from '../../components/ui'
import { cx } from '../../lib/cx'

type AskAdvisorProps = {
  situationId: string | null
}

type ChatTurn = {
  role: 'user' | 'assistant'
  text: string
  citations?: AdvisorCitation[]
  tools?: string[]
}

const SUGGESTIONS = [
  'What should the response team prepare for over the next 30 days?',
  'Why is this zone rated the way it is?',
  'Which zones need attention first this cycle?',
]

export function AskAdvisor({ situationId }: AskAdvisorProps) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const { selectedZoneId } = useSelectedZone()
  const logRef = useRef<HTMLDivElement>(null)

  const askMutation = useMutation({
    mutationFn: (q: string) =>
      askAdvisor(q, situationId, {
        zoneId: selectedZoneId,
        conversationId,
      }),
    onSuccess: (response) => {
      if (response.conversation_id) setConversationId(response.conversation_id)
      setTurns((current) => [
        ...current,
        {
          role: 'assistant',
          text: response.answer,
          citations: response.citations,
          tools: response.tools_used,
        },
      ])
    },
  })

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, askMutation.isPending])

  const ask = (raw: string) => {
    const q = raw.trim()
    if (!q || askMutation.isPending) return
    setTurns((current) => [...current, { role: 'user', text: q }])
    setQuestion('')
    askMutation.mutate(q)
  }

  return (
    <div className="flex h-full flex-col">
      <p className="border-b border-line bg-surface-2 px-4 py-2 text-xs text-muted">
        {selectedZoneId
          ? `Grounded in ${selectedZoneId} — its situation, signals, hazards, and field reports.`
          : 'Select a zone on the map for zone-specific answers.'}
      </p>

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 && !askMutation.isPending ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-[0.04em] text-faint uppercase">
              Try asking
            </p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                className="rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-sm text-muted transition-colors duration-[120ms] hover:border-accent hover:bg-accent-soft hover:text-ink"
              >
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
                'rounded-md px-3 py-2.5 text-sm',
                turn.role === 'user'
                  ? 'ml-6 bg-accent-soft text-ink'
                  : 'border border-line bg-surface text-ink',
              )}
            >
              <p className="leading-relaxed whitespace-pre-wrap">{turn.text}</p>

              {turn.citations && turn.citations.length > 0 ? (
                <ul className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2.5">
                  {turn.citations.slice(0, 6).map((citation, i) => (
                    <li
                      key={`${citation.title}-${i}`}
                      className="flex gap-1.5 text-xs text-muted"
                    >
                      <Quote size={11} strokeWidth={1.75} aria-hidden className="mt-1 shrink-0 text-faint" />
                      <span>
                        <span className="font-mono text-2xs text-faint">{citation.kind}</span>{' '}
                        {citation.title}
                        {citation.source ? ` — ${citation.source}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {turn.tools && turn.tools.length > 0 ? (
                <p className="mt-2 flex items-center gap-1.5 text-2xs text-faint">
                  <Wrench size={11} strokeWidth={1.75} aria-hidden />
                  {turn.tools.join(' · ')}
                </p>
              ) : null}
            </div>
          ))}

          {askMutation.isPending ? (
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-muted">
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 animate-pulse rounded-full bg-line-strong"
                    style={{ animationDelay: `${dot * 140}ms` }}
                  />
                ))}
              </span>
              Retrieving context…
            </div>
          ) : null}
        </div>
      </div>

      <form
        className="border-t border-line p-3"
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
            situationId ? 'Ask about the selected situation…' : 'Ask about regional priorities…'
          }
          rows={2}
          aria-label="Your question"
          className="w-full resize-none rounded-sm border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink transition-colors duration-[120ms] placeholder:text-faint hover:border-faint focus:border-accent focus:ring-2 focus:ring-accent-ring focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-2xs text-faint">
            <CornerDownLeft size={11} strokeWidth={1.75} aria-hidden className="inline" /> to send
          </span>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={askMutation.isPending}
            disabled={question.trim().length === 0}
          >
            {askMutation.isPending ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
        {askMutation.isError ? (
          <Callout tone="danger" className="mt-2">
            The advisor could not answer. Try again.
          </Callout>
        ) : null}
      </form>
    </div>
  )
}
