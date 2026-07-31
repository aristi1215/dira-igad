import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { createRecipient, queryKeys, updateRecipient } from '../../lib/api'
import { Button, ErrorNote, Field, Select, TextInput } from '../../components/ui'
import { Modal } from '../../components/Modal'
import type { Recipient, ZoneSummary } from '../../lib/types'
import {
  EMPTY_RECIPIENT_FORM,
  LANGUAGES,
  PHONE_PATTERN,
  type RecipientForm,
} from './constants'
import { SmsCaveat } from './SmsCaveat'

export type RecipientEditorState = {
  mode: 'create' | 'edit'
  recipient?: Recipient
  /** Pre-fills the zone on a create, so "add someone here" lands in the zone. */
  zoneId?: string | null
}

function initialForm(state: RecipientEditorState): RecipientForm {
  if (state.mode === 'edit' && state.recipient) {
    return {
      name: state.recipient.name,
      phone_e164: state.recipient.phone_e164,
      zone_id: state.recipient.zone_id ?? '',
      language: state.recipient.language,
      channel: state.recipient.channel,
      active: state.recipient.active,
    }
  }
  return { ...EMPTY_RECIPIENT_FORM, zone_id: state.zoneId ?? '' }
}

/**
 * Add or edit one contact. Zone is fixed after creation: moving a number
 * between zones silently changes who a future alert reaches, which is a
 * different decision from correcting a typo in a name.
 */
export function RecipientFormModal({
  state,
  zones,
  onClose,
  onCreated,
}: {
  state: RecipientEditorState
  zones: ZoneSummary[]
  onClose: () => void
  /** Fired only on create, with the new row — lets the caller target them. */
  onCreated?: (recipient: Recipient) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<RecipientForm>(() => initialForm(state))

  const mutation = useMutation({
    mutationFn: (input: { id?: string; form: RecipientForm }) =>
      input.id
        ? updateRecipient(input.id, {
            name: input.form.name,
            phone_e164: input.form.phone_e164,
            language: input.form.language,
            channel: input.form.channel,
            active: input.form.active,
          })
        : createRecipient({
            name: input.form.name,
            phone_e164: input.form.phone_e164,
            zone_id: input.form.zone_id || null,
            language: input.form.language,
            channel: input.form.channel,
          }),
    onSuccess: (recipient) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipients })
      if (state.mode === 'create') onCreated?.(recipient)
      onClose()
    },
  })

  const phoneInvalid = Boolean(form.phone_e164) && !PHONE_PATTERN.test(form.phone_e164)

  return (
    <Modal
      title={state.mode === 'create' ? 'Add recipient' : 'Edit recipient'}
      eyebrow="Recipient roster"
      onClose={onClose}
    >
      <form
        className="grid gap-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          if (!PHONE_PATTERN.test(form.phone_e164)) return
          mutation.mutate({ id: state.recipient?.id, form })
        }}
      >
        <Field label="Name" htmlFor="recipient-name">
          <TextInput
            id="recipient-name"
            required
            autoFocus
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field
          label="Phone (E.164)"
          htmlFor="recipient-phone"
          hint="Format: +2547XXXXXXXX"
          error={phoneInvalid ? 'Use an international number such as +2547XXXXXXXX.' : undefined}
        >
          <TextInput
            id="recipient-phone"
            required
            value={form.phone_e164}
            placeholder="+2547XXXXXXXX"
            onChange={(event) =>
              setForm((current) => ({ ...current, phone_e164: event.target.value }))
            }
          />
        </Field>
        <Field label="Zone" htmlFor="recipient-zone" hint="All zones sends to any zone alert.">
          <Select
            id="recipient-zone"
            value={form.zone_id}
            onChange={(event) =>
              setForm((current) => ({ ...current, zone_id: event.target.value }))
            }
            disabled={state.mode === 'edit'}
          >
            <option value="">All zones</option>
            {zones.map((zone) => (
              <option key={zone.zone_id} value={zone.zone_id}>
                {zone.zone_name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Language" htmlFor="recipient-language">
            <Select
              id="recipient-language"
              value={form.language}
              onChange={(event) =>
                setForm((current) => ({ ...current, language: event.target.value }))
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Channel" htmlFor="recipient-channel">
            <Select
              id="recipient-channel"
              value={form.channel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  channel: event.target.value as Recipient['channel'],
                }))
              }
            >
              <option value="voice">Voice call</option>
              <option value="sms">SMS</option>
              <option value="both">Voice + SMS</option>
            </Select>
          </Field>
        </div>
        {state.mode === 'edit' ? (
          <Field label="Status" htmlFor="recipient-active">
            <Select
              id="recipient-active"
              value={form.active ? 'active' : 'inactive'}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.value === 'active',
                }))
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        ) : null}
        <SmsCaveat />
        {mutation.isError ? <ErrorNote error={mutation.error} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            loading={mutation.isPending}
            disabled={!form.name.trim() || !PHONE_PATTERN.test(form.phone_e164)}
          >
            {state.mode === 'create' ? 'Add recipient' : 'Save recipient'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}
