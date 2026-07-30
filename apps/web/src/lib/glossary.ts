export type GlossaryEntry = {
  plain: string
  technical: string
  explanation: string
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  corroboration: {
    plain: 'what people are reporting',
    technical: 'corroboration',
    explanation: 'Independent reports that support or challenge the model forecast.',
  },
  'operational score': {
    plain: 'combined score',
    technical: 'operational score',
    explanation: 'The model forecast combined with what people are reporting.',
  },
  'combination rule': {
    plain: 'how the score is worked out',
    technical: 'combination rule',
    explanation: 'The stored formula that combines the model and supporting reports.',
  },
  dekad: {
    plain: '10-day period',
    technical: 'dekad',
    explanation: 'A ten-day reporting period used by the climate and conflict data.',
  },
  'frozen snapshot': {
    plain: 'what we knew at the time',
    technical: 'frozen snapshot',
    explanation: 'Context recorded when an assessment ran, rather than updated later.',
  },
  'news signals': {
    plain: 'reports in the news',
    technical: 'news signals',
    explanation: 'Structured pressure indicators extracted from monitored reporting.',
  },
  SHAP: {
    plain: 'what pushed the score',
    technical: 'SHAP attribution',
    explanation: 'A model diagnostic showing which inputs moved the forecast up or down.',
  },
  signal: {
    plain: 'report',
    technical: 'signal',
    explanation: 'A structured observation extracted from a source.',
  },
  snapshot: {
    plain: 'record at that time',
    technical: 'snapshot',
    explanation: 'A point-in-time record preserved for historical transparency.',
  },
}

export function glossaryEntry(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key]
}
