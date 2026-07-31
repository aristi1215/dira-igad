import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Send, Trash2, UserPlus, Users } from 'lucide-react'
import { deleteRecipient, queryKeys } from '../../lib/api'
import { maskPhone } from '../../lib/format'
import {
  Button,
  Callout,
  EmptyState,
  ErrorNote,
  SearchInput,
  SkeletonText,
  StatusChip,
  Tabs,
} from '../../components/ui'
import { cx } from '../../lib/cx'
import type { Recipient } from '../../lib/types'
import { CHANNEL_ICON, CHANNEL_LABEL, type TargetRow } from './constants'

type PeopleTab = 'targets' | 'roster'

function matches(query: string, haystack: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || haystack.toLowerCase().includes(needle)
}

/**
 * People, always on screen.
 *
 * The roster used to sit below the delivery board — a full page of scrolling
 * past the thing you came here to do. Who an alert reaches is not reference
 * material; it is half the decision, so it sits beside the message.
 */
export function PeoplePanel({
  hasAlert,
  alertLanguage,
  targetRows,
  selectedIds,
  fallbackCount,
  targetsLoading,
  targetsError,
  recipients,
  recipientsLoading,
  recipientsError,
  onToggleTarget,
  onSelectAll,
  onClearSelection,
  onAddRecipient,
  onEditRecipient,
  onSendTo,
}: {
  hasAlert: boolean
  alertLanguage: string
  targetRows: TargetRow[]
  selectedIds: Set<string>
  fallbackCount: number
  targetsLoading: boolean
  targetsError: unknown
  recipients: Recipient[]
  recipientsLoading: boolean
  recipientsError: unknown
  onToggleTarget: (id: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onAddRecipient: () => void
  onEditRecipient: (recipient: Recipient) => void
  /** Compose a new alert aimed at this one person. */
  onSendTo: (recipient: Recipient) => void
}) {
  const [tab, setTab] = useState<PeopleTab>(hasAlert ? 'targets' : 'roster')
  const active = hasAlert ? tab : 'roster'

  const selectedCount = targetRows.filter((row) => selectedIds.has(row.id)).length
  // The tab counts who can be called, not how many rows the table has.
  const reachableCount = recipients.filter((recipient) => recipient.active).length

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          size="sm"
          layoutId="people-panel"
          ariaLabel="Recipients"
          value={active}
          onChange={setTab}
          items={
            hasAlert
              ? [
                  { id: 'targets' as const, label: 'This alert', count: selectedCount },
                  { id: 'roster' as const, label: 'Roster', count: reachableCount },
                ]
              : [{ id: 'roster' as const, label: 'Roster', count: reachableCount }]
          }
        />
        <Button size="sm" variant="secondary" icon={Plus} onClick={onAddRecipient}>
          Add
        </Button>
      </div>

      {active === 'targets' ? (
        <TargetsTab
          alertLanguage={alertLanguage}
          rows={targetRows}
          selectedIds={selectedIds}
          fallbackCount={fallbackCount}
          isLoading={targetsLoading}
          error={targetsError}
          onToggle={onToggleTarget}
          onSelectAll={onSelectAll}
          onClear={onClearSelection}
          onBrowseRoster={() => setTab('roster')}
        />
      ) : (
        <RosterTab
          recipients={recipients}
          isLoading={recipientsLoading}
          error={recipientsError}
          hasAlert={hasAlert}
          selectedIds={selectedIds}
          onToggle={onToggleTarget}
          onEdit={onEditRecipient}
          onSendTo={onSendTo}
          onAddRecipient={onAddRecipient}
        />
      )}
    </div>
  )
}

function TargetsTab({
  alertLanguage,
  rows,
  selectedIds,
  fallbackCount,
  isLoading,
  error,
  onToggle,
  onSelectAll,
  onClear,
  onBrowseRoster,
}: {
  alertLanguage: string
  rows: TargetRow[]
  selectedIds: Set<string>
  fallbackCount: number
  isLoading: boolean
  error: unknown
  onToggle: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
  onBrowseRoster: () => void
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        matches(query, `${row.name} ${row.phone_e164} ${row.zone_name ?? ''} ${row.language}`),
      ),
    [query, rows],
  )
  const selectedCount = rows.filter((row) => selectedIds.has(row.id)).length

  return (
    <>
      {error ? <ErrorNote error={error} /> : null}

      {/*
        The whole point of variants is that this is visible. Without it, a
        Somali speaker quietly receiving Swahili looks exactly like a
        successful delivery.
      */}
      {fallbackCount > 0 ? (
        <Callout tone="warning">
          {fallbackCount} recipient{fallbackCount === 1 ? '' : 's'} hear
          {fallbackCount === 1 ? 's' : ''} the default {alertLanguage.toUpperCase()} message
          because nothing is written in their language. Add a wording, or send it knowingly.
        </Callout>
      ) : null}

      {isLoading ? <SkeletonText lines={3} /> : null}

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody matches this zone"
          action={
            <Button size="sm" variant="secondary" icon={UserPlus} onClick={onBrowseRoster}>
              Pick from the roster
            </Button>
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchInput
              value={query}
              placeholder="Filter…"
              className="min-w-0 flex-1"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={onSelectAll}
              disabled={selectedCount === rows.length}
            >
              All
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear} disabled={selectedCount === 0}>
              None
            </Button>
          </div>

          <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
            {visible.map((row) => {
              const Icon = CHANNEL_ICON[row.channel]
              const checked = selectedIds.has(row.id)
              return (
                <li key={row.id}>
                  <label
                    className={cx(
                      'flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs transition-colors',
                      checked ? 'border-accent bg-surface' : 'border-line bg-surface opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(row.id)}
                      className="size-3.5 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{row.name}</span>
                      <span className="block truncate text-2xs text-faint">
                        {row.zone_name ?? 'All zones'} · {row.reason} ·{' '}
                        <span className="tabular-nums">{maskPhone(row.phone_e164)}</span>
                      </span>
                    </span>
                    <span
                      className={cx(
                        'flex shrink-0 items-center gap-1 text-2xs',
                        row.isFallback ? 'text-warn-fg' : 'text-muted',
                      )}
                      title={
                        row.isFallback
                          ? `No ${row.language.toUpperCase()} wording — hears the default message`
                          : undefined
                      }
                    >
                      <Icon size={13} strokeWidth={1.75} aria-hidden />
                      {row.language.toUpperCase()}
                      {row.isFallback ? '*' : ''}
                    </span>
                  </label>
                </li>
              )
            })}
            {visible.length === 0 ? (
              <li className="py-1 text-2xs text-faint">Nobody matches “{query}”.</li>
            ) : null}
          </ul>

          <Button size="sm" variant="ghost" icon={UserPlus} onClick={onBrowseRoster}>
            Add someone from the roster
          </Button>
        </>
      ) : null}
    </>
  )
}

function RosterTab({
  recipients,
  isLoading,
  error,
  hasAlert,
  selectedIds,
  onToggle,
  onEdit,
  onSendTo,
  onAddRecipient,
}: {
  recipients: Recipient[]
  isLoading: boolean
  error: unknown
  hasAlert: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onEdit: (recipient: Recipient) => void
  onSendTo: (recipient: Recipient) => void
  onAddRecipient: () => void
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')

  const deactivate = useMutation({
    mutationFn: deleteRecipient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipients })
    },
  })

  // Active first. The server orders by zone then name, which buries the people
  // you can actually call under every contact ever deactivated — and a roster
  // is deactivated precisely because it is out of play.
  const visible = useMemo(
    () =>
      recipients
        .filter((recipient) =>
          matches(
            query,
            `${recipient.name} ${recipient.phone_e164} ${recipient.zone_name ?? 'all zones'} ${recipient.language}`,
          ),
        )
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1
          return a.name.localeCompare(b.name)
        }),
    [query, recipients],
  )
  const activeCount = recipients.filter((recipient) => recipient.active).length

  return (
    <>
      {error ? <ErrorNote error={error} /> : null}
      {deactivate.isError ? <ErrorNote error={deactivate.error} /> : null}

      <SearchInput
        value={query}
        placeholder="Search name, zone or number…"
        onChange={(event) => setQuery(event.target.value)}
      />

      {recipients.length > activeCount ? (
        <p className="text-2xs text-faint">
          {activeCount} reachable · {recipients.length - activeCount} deactivated, kept for
          delivery history
        </p>
      ) : null}

      {isLoading ? <SkeletonText lines={4} /> : null}

      {!isLoading && recipients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No recipients yet"
          action={
            <Button size="sm" variant="primary" icon={Plus} onClick={onAddRecipient}>
              Add the first number
            </Button>
          }
        />
      ) : null}

      <ul className="flex max-h-[30rem] flex-col gap-1 overflow-y-auto">
        {visible.map((recipient) => {
          const Icon = CHANNEL_ICON[recipient.channel]
          const targeted = selectedIds.has(recipient.id)
          return (
            <li
              key={recipient.id}
              className={cx(
                'rounded-sm border border-line bg-surface px-2.5 py-1.5',
                !recipient.active && 'opacity-55',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-xs font-medium text-ink">
                      {recipient.name}
                    </span>
                    {!recipient.active ? (
                      <StatusChip tone="neutral">Inactive</StatusChip>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-faint">
                    <span className="truncate">{recipient.zone_name ?? 'All zones'}</span>
                    <span className="flex items-center gap-1">
                      <Icon size={11} strokeWidth={1.75} aria-hidden />
                      {CHANNEL_LABEL[recipient.channel]}
                    </span>
                    <span className="tabular-nums">
                      {recipient.language.toUpperCase()} · {maskPhone(recipient.phone_e164)}
                    </span>
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-0.5">
                  {recipient.active ? (
                    hasAlert ? (
                      <Button
                        size="sm"
                        variant={targeted ? 'secondary' : 'ghost'}
                        icon={targeted ? Check : Plus}
                        title={targeted ? 'Remove from this alert' : 'Add to this alert'}
                        onClick={() => onToggle(recipient.id)}
                      >
                        {targeted ? 'Added' : 'Add'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Send}
                        title={`Write an alert for ${recipient.name}`}
                        onClick={() => onSendTo(recipient)}
                      >
                        Send
                      </Button>
                    )
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Pencil}
                    aria-label={`Edit ${recipient.name}`}
                    title={`Edit ${recipient.name}`}
                    onClick={() => onEdit(recipient)}
                  >
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`Deactivate ${recipient.name}`}
                    title={`Deactivate ${recipient.name}`}
                    disabled={!recipient.active || deactivate.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Deactivate ${recipient.name}? This keeps delivery history.`,
                        )
                      ) {
                        deactivate.mutate(recipient.id)
                      }
                    }}
                  >
                    <span className="sr-only">Deactivate</span>
                  </Button>
                </span>
              </div>
            </li>
          )
        })}
        {recipients.length > 0 && visible.length === 0 ? (
          <li className="py-1 text-2xs text-faint">Nobody matches “{query}”.</li>
        ) : null}
      </ul>

      {hasAlert ? (
        <p className="text-2xs text-faint">
          Anyone active can be added, including contacts outside this alert's zone — a
          neighbouring chief often needs the same warning.
        </p>
      ) : null}
    </>
  )
}
