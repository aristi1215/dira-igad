import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PenLine, Sparkles } from 'lucide-react'
import { prepareAlert, queryKeys } from '../../lib/api'
import { BAND_LABELS, fmtRiskScore, maskPhone } from '../../lib/format'
import {
  Button,
  Callout,
  ErrorNote,
  Field,
  Select,
  SkeletonText,
} from '../../components/ui'
import { Modal } from '../../components/Modal'
import { cx } from '../../lib/cx'
import type { Alert, Recipient, ZoneSummary } from '../../lib/types'
import { LANGUAGES } from './constants'

const TEXTAREA =
  'w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent-ring/40'

type Source = 'ai' | 'own'

/**
 * Start an alert from this screen instead of walking to the map for one.
 *
 * An alert still belongs to a zone and its open situation — that anchor is what
 * makes every dispatch traceable back to an assessment — so the first thing
 * asked for is the zone. Everything after that is existing machinery: the draft
 * lands `pending_approval` like any other, gets its recipients chosen beside
 * it, and goes out through the same signed gate.
 */
export function ComposeAlertModal({
  zones,
  zonesLoading,
  signer,
  target,
  onClose,
  onCreated,
}: {
  zones: ZoneSummary[]
  zonesLoading: boolean
  signer: string
  /** Set when composing for one person picked out of the roster. */
  target: Recipient | null
  onClose: () => void
  onCreated: (alert: Alert, recipientIds: string[] | null) => void
}) {
  const queryClient = useQueryClient()

  // Only zones with an open situation can carry an alert: `alerts.situation_id`
  // is NOT NULL, and a warning with nothing behind it is not a warning.
  const options = useMemo(
    () =>
      zones
        .filter((zone) => zone.situation_id != null)
        .sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1)),
    [zones],
  )

  const [zoneId, setZoneId] = useState(() => {
    if (target?.zone_id && options.some((zone) => zone.zone_id === target.zone_id)) {
      return target.zone_id
    }
    return options[0]?.zone_id ?? ''
  })
  const [language, setLanguage] = useState(target?.language ?? 'sw')
  const [source, setSource] = useState<Source>('ai')
  const [bodyText, setBodyText] = useState('')

  const zone = options.find((option) => option.zone_id === zoneId) ?? null

  const createMutation = useMutation({
    mutationFn: (input: { situationId: string; bodyText?: string }) =>
      prepareAlert(input.situationId, {
        createdBy: signer.trim() || 'dispatch console',
        language,
        bodyText: input.bodyText,
      }),
    onSuccess: (alert) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingAlerts })
      onCreated(alert, target ? [target.id] : null)
    },
  })

  const ownTextReady = source === 'own' ? bodyText.trim().length > 0 : true
  const canSubmit = Boolean(zone?.situation_id) && ownTextReady

  return (
    <Modal
      title={target ? `Write an alert for ${target.name}` : 'New alert'}
      eyebrow="Compose"
      onClose={onClose}
    >
      <form
        className="grid gap-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          if (!zone?.situation_id || !ownTextReady) return
          createMutation.mutate({
            situationId: zone.situation_id,
            bodyText: source === 'own' ? bodyText.trim() : undefined,
          })
        }}
      >
        {target ? (
          <Callout tone="info">
            Only {target.name} ({maskPhone(target.phone_e164)}) is selected to start with.
            You can add anyone else before signing.
          </Callout>
        ) : null}

        {zonesLoading ? <SkeletonText lines={2} /> : null}

        {!zonesLoading && options.length === 0 ? (
          <Callout tone="warning" title="No zone has an open situation">
            An alert is always about something. Run a pipeline cycle, or open a situation
            from the map first.
          </Callout>
        ) : null}

        {options.length > 0 ? (
          <Field
            label="About which zone"
            htmlFor="compose-zone"
            hint={
              zone
                ? `${BAND_LABELS[zone.operational_band ?? 'low']} · pressure ${fmtRiskScore(
                    zone.model_risk,
                  )}/100`
                : undefined
            }
          >
            <Select
              id="compose-zone"
              value={zoneId}
              autoFocus
              onChange={(event) => setZoneId(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.zone_id} value={option.zone_id}>
                  {option.zone_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Language" htmlFor="compose-language">
          <Select
            id="compose-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-2">
          <span className="text-eyebrow text-faint uppercase">The message</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <SourceChoice
              icon={Sparkles}
              title="Let the advisor draft it"
              body="Uses this cycle's assessment. You can edit every word afterwards."
              selected={source === 'ai'}
              onSelect={() => setSource('ai')}
            />
            <SourceChoice
              icon={PenLine}
              title="Write it myself"
              body="Nothing is sent to the model. Your words go in exactly as typed."
              selected={source === 'own'}
              onSelect={() => setSource('own')}
            />
          </div>
        </div>

        {source === 'own' ? (
          <Field label="Alert message" htmlFor="compose-body">
            <textarea
              id="compose-body"
              rows={4}
              maxLength={4000}
              value={bodyText}
              placeholder="Move livestock away from the river crossing until Friday…"
              onChange={(event) => setBodyText(event.target.value)}
              className={TEXTAREA}
            />
            <span className={cx('text-2xs', bodyText.length > 320 ? 'text-warn-fg' : 'text-faint')}>
              {bodyText.length}/4000 characters
              {bodyText.length > 320 ? ' · Long for a voice-readable alert' : ''}
            </span>
          </Field>
        ) : null}

        {createMutation.isError ? <ErrorNote error={createMutation.error} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            loading={createMutation.isPending}
          >
            {createMutation.isPending
              ? source === 'ai'
                ? 'Drafting…'
                : 'Creating…'
              : 'Continue to recipients'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <p className="text-2xs text-faint">
          Nothing is sent yet. The draft lands at the gate, where you pick who hears it and
          sign it off.
        </p>
      </form>
    </Modal>
  )
}

function SourceChoice({
  icon: Icon,
  title,
  body,
  selected,
  onSelect,
}: {
  icon: typeof PenLine
  title: string
  body: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <Icon size={14} strokeWidth={1.75} aria-hidden />
        {title}
      </span>
      <span className="text-2xs leading-relaxed text-faint">{body}</span>
    </button>
  )
}
