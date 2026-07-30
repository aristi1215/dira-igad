import type { ReactNode } from 'react'
import { InfoHint } from './Tooltip'
import { glossaryEntry } from '../../lib/glossary'

export function Term({ term, children }: { term: string; children?: ReactNode }) {
  const entry = glossaryEntry(term)
  if (!entry) return <>{children ?? term}</>
  return (
    <span className="inline-flex items-center gap-1">
      {children ?? entry.plain}
      <InfoHint content={`${entry.technical}: ${entry.explanation}`} />
    </span>
  )
}
