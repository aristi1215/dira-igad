import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { askAdvisor } from '../../lib/api'
import { useMapUiStore } from '../../stores/mapUi'
import type { AdvisorCitation } from '../../lib/types'

type AskAdvisorProps = {
  situationId: string | null
}

type ChatTurn = {
  role: 'user' | 'assistant'
  text: string
  citations?: AdvisorCitation[]
  tools?: string[]
}

export function AskAdvisor({ situationId }: AskAdvisorProps) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const selectedZoneId = useMapUiStore((state) => state.selectedZoneId)
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
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [turns, askMutation.isPending])

  const submit = () => {
    const q = question.trim()
    if (!q || askMutation.isPending) return
    setTurns((current) => [...current, { role: 'user', text: q }])
    setQuestion('')
    askMutation.mutate(q)
  }

  return (
    <section className="ask-advisor panel-fade" aria-label="Ask the advisor">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Situation advisor · grounded, read-only</p>
          <h2>Ask Dira</h2>
          <small className="muted">
            {selectedZoneId
              ? `Answers grounded in ${selectedZoneId} — situations, signals, hazards, field reports.`
              : 'Select a zone on the map for zone-grounded answers. The advisor can never approve or dispatch alerts.'}
          </small>
        </div>
      </div>

      <div className="advisor-log" ref={logRef}>
        {turns.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Try: “What should the response team prepare for in the selected
            zone over the next 30 days?”
          </p>
        ) : null}
        {turns.map((turn, index) => (
          <div
            key={`${turn.role}-${index}`}
            className={turn.role === 'user' ? 'advisor-turn user' : 'advisor-turn'}
          >
            <p>{turn.text}</p>
            {turn.tools && turn.tools.length > 0 ? (
              <small className="muted">Tools: {turn.tools.join(', ')}</small>
            ) : null}
            {turn.citations && turn.citations.length > 0 ? (
              <ul className="advisor-citations">
                {turn.citations.slice(0, 6).map((citation, i) => (
                  <li key={`${citation.title}-${i}`}>
                    <span className="mono">{citation.kind}</span> {citation.title}
                    {citation.source ? ` — ${citation.source}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {askMutation.isPending ? (
          <div className="advisor-turn">
            <p className="muted">Retrieving context and thinking…</p>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={
            situationId
              ? 'Ask about the selected situation...'
              : 'Ask about regional priorities...'
          }
          rows={2}
        />
        <button
          className="button button-primary"
          type="submit"
          disabled={askMutation.isPending || question.trim().length === 0}
        >
          {askMutation.isPending ? 'Thinking...' : 'Ask advisor'}
        </button>
      </form>
      {askMutation.isError ? (
        <p className="error-note">Advisor request failed. Try again.</p>
      ) : null}
    </section>
  )
}
