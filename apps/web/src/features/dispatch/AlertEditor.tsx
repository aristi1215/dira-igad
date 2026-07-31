import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Languages, Pencil, Save, Trash2 } from 'lucide-react'
import {
  createAlertVariant,
  deleteAlertVariant,
  queryKeys,
  updateAlert,
  updateAlertVariant,
} from '../../lib/api'
import { fmtDateTime, titleCase } from '../../lib/format'
import {
  Button,
  DateStamp,
  ErrorNote,
  Field,
  ForecastWindow,
  Select,
  StatusChip,
} from '../../components/ui'
import { Modal } from '../../components/Modal'
import { cx } from '../../lib/cx'
import type { Alert, AlertVariant } from '../../lib/types'
import { LANGUAGES, VARIANT_SOURCE_LABEL } from './constants'

const TEXTAREA =
  'w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent-ring/40'

/**
 * The message an approver is being asked to stand behind, plus the per-language
 * wordings. Mutations live here rather than in the screen: nothing outside this
 * component needs to know that a variant was edited — the server recomputes who
 * still falls through to the default and the recipient list refetches.
 */
export function AlertEditor({ alert, variants }: { alert: Alert; variants: AlertVariant[] }) {
  const queryClient = useQueryClient()

  const [editingAlert, setEditingAlert] = useState(false)
  const [alertBody, setAlertBody] = useState('')
  const [alertLanguage, setAlertLanguage] = useState(alert.language)
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [editingVariant, setEditingVariant] = useState(false)
  const [variantBody, setVariantBody] = useState('')
  const [showDraftDiff, setShowDraftDiff] = useState(false)
  const [addingLanguage, setAddingLanguage] = useState(false)

  // Variant writes always refresh the recipient list too: adding a Somali
  // wording changes which recipients are still falling through to the default,
  // and that flag is what tells the operator the work is finished.
  const invalidateAlert = (alertId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.alertVariants(alertId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.alertRecipients(alertId) })
  }

  const editAlertMutation = useMutation({
    mutationFn: (input: { body_text: string; language: string }) =>
      updateAlert(alert.id, { body_text: input.body_text, language: input.language }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (alerts = []) =>
        alerts.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingAlerts })
      invalidateAlert(alert.id)
      setEditingAlert(false)
    },
  })

  const draftVariantMutation = useMutation({
    mutationFn: (input: { language: string }) =>
      createAlertVariant(alert.id, { language: input.language }),
    onSuccess: (variant) => {
      invalidateAlert(variant.alert_id)
      setActiveVariantId(variant.id)
    },
  })

  const editVariantMutation = useMutation({
    mutationFn: (input: { variantId: string; body_text: string }) =>
      updateAlertVariant(input.variantId, input.body_text),
    onSuccess: (variant) => {
      invalidateAlert(variant.alert_id)
      setEditingVariant(false)
    },
  })

  const deleteVariantMutation = useMutation({
    mutationFn: (variantId: string) => deleteAlertVariant(variantId),
    onSuccess: () => {
      invalidateAlert(alert.id)
      setActiveVariantId(null)
    },
  })

  const activeVariant = variants.find((variant) => variant.id === activeVariantId) ?? null
  const missingLanguages = LANGUAGES.filter(
    (language) =>
      language.code !== alert.language &&
      !variants.some((variant) => variant.language === language.code),
  )
  const editable = alert.status === 'pending_approval'

  return (
    <>
      {/*
        What the alert is about, when it was drafted, and — at display size —
        the period it warns about.
      */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusChip tone="warning">Pending approval</StatusChip>
          <span className="text-sm font-semibold text-ink">
            {alert.zone_name ?? 'Voice alert'}
          </span>
          <span className="text-2xs text-faint">{alert.language.toUpperCase()} message</span>
          <DateStamp title="When this alert was drafted">
            Drafted {fmtDateTime(alert.created_at)}
          </DateStamp>
        </div>
        <ForecastWindow
          label="Warns about"
          start={alert.window_start}
          end={alert.window_end}
          className="shrink-0"
        />
      </div>

      {editingAlert && editable ? (
        <form
          className="grid gap-3 rounded-md border border-line bg-surface-2 p-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            editAlertMutation.mutate({ body_text: alertBody, language: alertLanguage })
          }}
        >
          <Field label="Alert message" htmlFor="alert-body">
            <textarea
              id="alert-body"
              value={alertBody}
              maxLength={4000}
              rows={4}
              autoFocus
              onChange={(event) => setAlertBody(event.target.value)}
              className={TEXTAREA}
            />
            <span
              className={cx('text-2xs', alertBody.length > 320 ? 'text-warn-fg' : 'text-faint')}
            >
              {alertBody.length}/4000 characters
              {alertBody.length > 320 ? ' · Long for a voice-readable alert' : ''}
            </span>
          </Field>
          <Field label="Language" htmlFor="alert-language">
            <Select
              id="alert-language"
              value={alertLanguage}
              onChange={(event) => setAlertLanguage(event.target.value)}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </Select>
          </Field>
          {editAlertMutation.isError ? <ErrorNote error={editAlertMutation.error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              icon={Save}
              loading={editAlertMutation.isPending}
            >
              Save message
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditingAlert(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {/*
            One alert, several wordings. `recipients.language` used to be
            collected and read by nothing — a contact registered as Somali
            received the Swahili text. These tabs are where that stops being
            invisible.
          */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveVariantId(null)
                setEditingVariant(false)
              }}
              className={cx(
                'rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                activeVariantId === null
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line text-muted hover:text-ink',
              )}
            >
              {alert.language.toUpperCase()} · default
            </button>
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => {
                  setActiveVariantId(variant.id)
                  setEditingVariant(false)
                  setShowDraftDiff(false)
                }}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                  activeVariantId === variant.id
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line text-muted hover:text-ink',
                )}
              >
                {variant.language.toUpperCase()}
                {variant.role ? ` · ${titleCase(variant.role)}` : ''}
              </button>
            ))}
            {editable && missingLanguages.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                icon={Languages}
                loading={draftVariantMutation.isPending}
                onClick={() => setAddingLanguage(true)}
              >
                Add language
              </Button>
            ) : null}
          </div>

          {draftVariantMutation.isError ? (
            <ErrorNote error={draftVariantMutation.error} className="mb-2" />
          ) : null}

          {editingVariant && activeVariant ? (
            <form
              className="grid gap-3 rounded-md border border-line bg-surface-2 p-3"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                editVariantMutation.mutate({
                  variantId: activeVariant.id,
                  body_text: variantBody,
                })
              }}
            >
              <Field label={`${activeVariant.language.toUpperCase()} message`} htmlFor="variant-body">
                <textarea
                  id="variant-body"
                  value={variantBody}
                  maxLength={4000}
                  rows={4}
                  autoFocus
                  onChange={(event) => setVariantBody(event.target.value)}
                  className={TEXTAREA}
                />
              </Field>
              {editVariantMutation.isError ? <ErrorNote error={editVariantMutation.error} /> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  icon={Save}
                  loading={editVariantMutation.isPending}
                >
                  Save wording
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditingVariant(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              {/* The alert body is the product. It gets to be the biggest thing here. */}
              <blockquote className="rounded-md border border-line border-l-[3px] border-l-accent bg-surface-2 px-4 py-3 text-md leading-relaxed text-ink">
                {activeVariant ? activeVariant.body_text : alert.body_text}
              </blockquote>

              {activeVariant?.llm_draft &&
              activeVariant.llm_draft !== activeVariant.body_text &&
              showDraftDiff ? (
                <blockquote className="mt-1.5 rounded-md border border-dashed border-line bg-surface px-4 py-2.5 text-xs leading-relaxed text-faint">
                  <span className="mb-1 block text-eyebrow uppercase">
                    AI draft, before your edit
                  </span>
                  {activeVariant.llm_draft}
                </blockquote>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
                  Read it as the recipient will hear it.
                  {activeVariant ? (
                    <StatusChip tone={activeVariant.source === 'llm' ? 'neutral' : 'success'}>
                      {VARIANT_SOURCE_LABEL[activeVariant.source]}
                    </StatusChip>
                  ) : null}
                </p>
                {editable ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {activeVariant?.llm_draft &&
                    activeVariant.llm_draft !== activeVariant.body_text ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowDraftDiff((shown) => !shown)}
                      >
                        {showDraftDiff ? 'Hide AI draft' : 'Show AI draft'}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Pencil}
                      onClick={() => {
                        if (activeVariant) {
                          setVariantBody(activeVariant.body_text)
                          setEditingVariant(true)
                        } else {
                          setAlertBody(alert.body_text)
                          setAlertLanguage(alert.language)
                          setEditingAlert(true)
                        }
                      }}
                    >
                      Edit message
                    </Button>
                    {activeVariant ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        loading={deleteVariantMutation.isPending}
                        onClick={() => deleteVariantMutation.mutate(activeVariant.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      {addingLanguage ? (
        <Modal title="Add a wording" eyebrow="Alert languages" onClose={() => setAddingLanguage(false)}>
          <p className="mb-3 text-sm text-muted">
            The advisor drafts this alert again in the chosen language. You can edit it
            afterwards — the original draft is kept either way.
          </p>
          <ul className="grid gap-1.5">
            {missingLanguages.map((language) => (
              <li key={language.code}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  loading={
                    draftVariantMutation.isPending &&
                    draftVariantMutation.variables?.language === language.code
                  }
                  onClick={() => {
                    draftVariantMutation.mutate({ language: language.code })
                    setAddingLanguage(false)
                  }}
                >
                  {language.label}
                </Button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </>
  )
}
