import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import {
  createFieldReport,
  dismissFieldReport,
  queryKeys,
  verifyFieldReport,
} from '../../lib/api'
import { fmtDate, titleCase } from '../../lib/format'
import {
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Select,
  StatusChip,
  TextInput,
} from '../../components/ui'
import { FieldReportModal } from '../../features/situations'
import { cx } from '../../lib/cx'
import type { FieldReport } from '../../lib/types'

const REPORT_CATEGORIES = [
  'water_dispute',
  'pasture_dispute',
  'livestock_raid',
  'migration_influx',
  'market_disruption',
  'road_blockage',
  'armed_presence',
  'peace_meeting',
]
const REPORTER_ROLES = ['field_monitor', 'peace_committee', 'drm_officer', 'chief']

/**
 * Field reports and their verification gate. Verification is a human decision:
 * an unverified or dismissed report contributes exactly zero to the combined score, so
 * the status is the most prominent thing on each row.
 */
export function ZoneFieldReports({
  zoneId,
  reports,
}: {
  zoneId: string
  reports: FieldReport[]
}) {
  const queryClient = useQueryClient()
  const [signer, setSigner] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedReport, setSelectedReport] = useState<FieldReport | null>(null)
  const [form, setForm] = useState({
    reporter_role: REPORTER_ROLES[0],
    category: REPORT_CATEGORIES[0],
    severity: 2,
    narrative: '',
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.zoneProfile(zoneId) })
    void queryClient.invalidateQueries({ queryKey: ['field-reports'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.zones })
  }

  const verifyMutation = useMutation({
    mutationFn: (reportId: string) => verifyFieldReport(reportId, signer.trim()),
    onSuccess: invalidate,
  })
  const dismissMutation = useMutation({
    mutationFn: (reportId: string) => dismissFieldReport(reportId, signer.trim()),
    onSuccess: invalidate,
  })
  const createMutation = useMutation({
    mutationFn: () =>
      createFieldReport({
        zone_id: zoneId,
        reporter_role: form.reporter_role,
        category: form.category,
        severity: form.severity,
        narrative: form.narrative.trim(),
      }),
    onSuccess: () => {
      setForm((current) => ({ ...current, narrative: '' }))
      setShowForm(false)
      invalidate()
    },
  })

  const canGate = signer.trim().length > 0
  const sorted = [...reports].sort((a, b) => b.reported_at.localeCompare(a.reported_at))
  const unverified = sorted.filter((report) => report.status === 'unverified')

  return (
    <Card
      title="Field reports"
      subtitle="Monitor reports from the ground. Verification is a human decision."
      actions={
        <Button
          size="sm"
          icon={showForm ? X : Plus}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? 'Cancel' : 'New report'}
        </Button>
      }
    >
      {unverified.length > 0 ? (
        <Callout tone="warning" className="mb-4">
          {unverified.length} report{unverified.length === 1 ? '' : 's'} awaiting
          verification. Until verified they contribute exactly zero to the combined score.
        </Callout>
      ) : null}
      <Callout tone="info" className="mb-4">
        Field reports are observations filed by monitors, peace committees, DRM officers, or chiefs.
        Only a human-verified report affects corroboration; unverified and dismissed reports
        contribute zero.
      </Callout>

      {showForm ? (
        <form
          className="mb-5 grid gap-3 rounded-md border border-line bg-surface-2 p-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (form.narrative.trim()) createMutation.mutate()
          }}
        >
          <Field label="Reporter role">
            <Select
              value={form.reporter_role}
              onChange={(event) => setForm({ ...form, reporter_role: event.target.value })}
            >
              {REPORTER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {titleCase(role)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              {REPORT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {titleCase(category)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severity">
            <Select
              value={form.severity}
              onChange={(event) => setForm({ ...form, severity: Number(event.target.value) })}
            >
              <option value={1}>1 — Low</option>
              <option value={2}>2 — Medium</option>
              <option value={3}>3 — High</option>
            </Select>
          </Field>
          <Field label="What was observed" className="sm:col-span-3">
            <textarea
              rows={3}
              value={form.narrative}
              onChange={(event) => setForm({ ...form, narrative: event.target.value })}
              placeholder="What was observed, where, and by whom…"
              className="w-full resize-y rounded-sm border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink transition-colors duration-[120ms] placeholder:text-faint hover:border-faint focus:border-accent focus:ring-2 focus:ring-accent-ring focus:outline-none"
            />
          </Field>
          <div className="sm:col-span-3">
            <Button
              type="submit"
              variant="primary"
              loading={createMutation.isPending}
              disabled={form.narrative.trim().length === 0}
            >
              Submit — starts unverified
            </Button>
          </div>
          {createMutation.isError ? (
            <div className="sm:col-span-3">
              <ErrorNote error={createMutation.error} />
            </div>
          ) : null}
        </form>
      ) : null}

      {unverified.length > 0 ? (
        <div className="mb-4 max-w-sm">
          <Field label="Reviewer name (required)" hint="Enter your name before verifying or dismissing any report">
            <TextInput
              value={signer}
              placeholder="Who is reviewing these?"
              onChange={(event) => setSigner(event.target.value)}
            />
          </Field>
        </div>
      ) : null}

      {sorted.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {sorted.map((report) => (
            <li
              key={report.id}
              className="rounded-md border border-line bg-surface px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  tone={
                    report.status === 'verified'
                      ? 'success'
                      : report.status === 'dismissed'
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {report.status}
                </StatusChip>
                <span className="text-sm font-medium text-ink">
                  {titleCase(report.category)}
                </span>
                <span
                  className="flex gap-0.5"
                  aria-label={`Severity ${report.severity} of 3`}
                >
                  {[1, 2, 3].map((pip) => (
                    <span
                      key={pip}
                      aria-hidden
                      className={cx(
                        'size-1.5 rounded-full',
                        pip <= report.severity ? 'bg-band-elevated' : 'bg-line',
                      )}
                    />
                  ))}
                </span>
                <span className="ml-auto text-2xs text-faint">
                  {fmtDate(report.reported_at)}
                </span>
              </div>

              <p className="mt-1.5 text-sm text-muted">{report.narrative}</p>
              <p className="mt-1 text-2xs text-faint">
                {titleCase(report.reporter_role)}
                {report.verified_by ? ` · ${report.status} by ${report.verified_by}` : ''}
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelectedReport(report)}>
                  Full context
                </Button>
                {report.status === 'unverified' ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Check}
                      disabled={!canGate}
                      loading={verifyMutation.isPending}
                      title={canGate ? undefined : 'Enter your name first'}
                      onClick={() => verifyMutation.mutate(report.id)}
                    >
                      Verify report
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={X}
                      disabled={!canGate}
                      loading={dismissMutation.isPending}
                      title={canGate ? undefined : 'Enter your name first'}
                      onClick={() => dismissMutation.mutate(report.id)}
                    >
                      Dismiss report
                    </Button>
                  </>
                ) : null}
              </div>
              {report.status === 'unverified' && !canGate ? (
                <p className="mt-2 text-xs text-warn-fg">
                  Enter your reviewer name above to enable the verification controls.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No field reports">
          Nothing has been reported from this zone yet.
        </EmptyState>
      )}

      {verifyMutation.isError ? (
        <ErrorNote error={verifyMutation.error} className="mt-3" />
      ) : null}
      {dismissMutation.isError ? (
        <ErrorNote error={dismissMutation.error} className="mt-3" />
      ) : null}
      {selectedReport ? (
        <FieldReportModal report={selectedReport} onClose={() => setSelectedReport(null)} />
      ) : null}
    </Card>
  )
}
