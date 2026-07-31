import {
  CircleCheck,
  CircleX,
  Clock,
  MessageSquare,
  PhoneOutgoing,
  Radio,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { AlertVariant, DeliveryStatus, Recipient } from '../../lib/types'

export const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/

/** The alert languages this room offers, in one place rather than four. */
export const LANGUAGES = [
  { code: 'sw', label: 'Swahili (sw)' },
  { code: 'en', label: 'English (en)' },
  { code: 'am', label: 'Amharic (am)' },
  { code: 'so', label: 'Somali (so)' },
  { code: 'ar', label: 'Arabic (ar)' },
]

export const VARIANT_SOURCE_LABEL: Record<AlertVariant['source'], string> = {
  llm: 'Drafted by AI',
  human_edited: 'Edited by you',
  human_authored: 'Written by you',
}

export const CHANNEL_LABEL: Record<Recipient['channel'], string> = {
  voice: 'Voice',
  sms: 'SMS',
  both: 'Voice + SMS',
}

export const CHANNEL_ICON: Record<Recipient['channel'], LucideIcon> = {
  voice: PhoneOutgoing,
  sms: MessageSquare,
  both: Radio,
}

export type RecipientForm = {
  name: string
  phone_e164: string
  zone_id: string
  language: string
  channel: Recipient['channel']
  active: boolean
}

export const EMPTY_RECIPIENT_FORM: RecipientForm = {
  name: '',
  phone_e164: '',
  zone_id: '',
  language: 'sw',
  channel: 'voice',
  active: true,
}

/** A row in the selection list: a default target, or one the operator added. */
export type TargetRow = {
  id: string
  name: string
  phone_e164: string
  channel: Recipient['channel']
  language: string
  zone_name: string | null
  reason: string
  /** True when no wording exists in their language and they get the default. */
  isFallback: boolean
}

export function deliveriesFor(rows: TargetRow[]): { voice: number; sms: number } {
  let voice = 0
  let sms = 0
  for (const row of rows) {
    if (row.channel === 'voice' || row.channel === 'both') voice += 1
    if (row.channel === 'sms' || row.channel === 'both') sms += 1
  }
  return { voice, sms }
}

/**
 * `bar` is a full literal class name, not an interpolation: Tailwind's scanner
 * cannot see `bg-${x}` and would emit no CSS at all, silently.
 */
export const BOARD_COLUMNS: {
  status: DeliveryStatus
  label: string
  icon: LucideIcon
  tint: string
  bar: string
}[] = [
  { status: 'queued', label: 'Queued', icon: Clock, tint: 'text-faint', bar: 'bg-line-strong' },
  {
    status: 'sending',
    label: 'Calling',
    icon: PhoneOutgoing,
    tint: 'text-info-fg',
    bar: 'bg-band-low',
  },
  { status: 'sent', label: 'Sent', icon: Send, tint: 'text-info-fg', bar: 'bg-accent-hover' },
  {
    status: 'delivered',
    label: 'Delivered',
    icon: CircleCheck,
    tint: 'text-ok-fg',
    bar: 'bg-band-ack',
  },
  { status: 'failed', label: 'Failed', icon: CircleX, tint: 'text-err-fg', bar: 'bg-band-high' },
  {
    status: 'needs_review',
    label: 'Needs review',
    icon: TriangleAlert,
    tint: 'text-warn-fg',
    bar: 'bg-band-elevated',
  },
]
