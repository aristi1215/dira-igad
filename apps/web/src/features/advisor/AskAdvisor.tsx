import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { askAdvisor } from '../../lib/api'

type AskAdvisorProps = {
  situationId: string | null
}

export function AskAdvisor({ situationId }: AskAdvisorProps) {
  const [question, setQuestion] = useState('')
  const askMutation = useMutation({
    mutationFn: (q: string) => askAdvisor(q, situationId),
  })

  return (
    <section className="ask-advisor panel-fade" aria-label="Ask the advisor">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Situation advisor</p>
          <h2>Ask Dira</h2>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (question.trim()) askMutation.mutate(question.trim())
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
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
      {askMutation.data ? (
        <div className="advisor-answer">
          <p>{askMutation.data.answer}</p>
        </div>
      ) : null}
    </section>
  )
}
