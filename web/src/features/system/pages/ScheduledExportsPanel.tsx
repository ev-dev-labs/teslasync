// Scheduled exports panel mounted on the /data-export page.
//
// Responsibilities
// ----------------
// * Render a table of the authenticated user's recurring exports.
// * Open an inline "New schedule" form that POSTs to the API.
// * Surface per-row Run-now / Edit / Delete / Toggle actions.
//
// Auth
// ----
// The whole panel is wrapped in <RequiresAuth capability="session_list">
// at the call site (DataExportPage). In open mode the panel is
// replaced by a placeholder; in forward-auth mode it mounts as
// usual.
//
// Validation
// ----------
// Client-side validation is deliberately minimal — the server
// validates everything in NormalizeScheduledExportInput and returns
// 400 with a useful message that we surface via toast. Doubling the
// validators would only invite drift.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  Button,
  Code,
  ConfirmDialog,
  GlassPanel,
  Heading,
  Input,
  Select,
  Table,
  Text,
} from '@/components/ui';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { TimeStamp } from '@/components/data-display';
import { Icons } from '@/lib/icons';
import { getErrorMessage } from '@/lib/errorMessage';
import {
  useScheduledExports,
  useCreateScheduledExport,
  useUpdateScheduledExport,
  useDeleteScheduledExport,
  useRunScheduledExportNow,
  type ScheduledExport,
  type ScheduledExportInput,
} from '@/api/hooks/useExports';

const EXPORT_TYPES: ScheduledExport['export_type'][] = [
  'drives',
  'charging',
  'trips',
  'positions',
  'signals',
];

const FORMATS: ScheduledExport['format'][] = ['csv', 'json'];

const DELIVERY_KINDS: ScheduledExport['delivery']['kind'][] = [
  'download',
  'email',
  'webhook',
];

function emptyInput(): ScheduledExportInput {
  return {
    name: '',
    export_type: 'drives',
    format: 'csv',
    schedule_cron: '0 9 * * 0',
    delivery: { kind: 'download' },
    range_window: '7d',
    enabled: true,
  };
}

function inputFromRow(row: ScheduledExport): ScheduledExportInput {
  return {
    name: row.name,
    export_type: row.export_type,
    format: row.format,
    vehicle_id: row.vehicle_id ?? undefined,
    columns: row.columns ?? undefined,
    schedule_cron: row.schedule_cron,
    delivery: { ...row.delivery },
    range_window: row.range_window,
    enabled: row.enabled,
  };
}

export function ScheduledExportsPanel() {
  const { t } = useTranslation();
  const query = useScheduledExports();
  const { refetch } = query;
  const state = useDataState(query);
  const error = state.fatalError;
  const isError = !!error;
  const create = useCreateScheduledExport();
  const update = useUpdateScheduledExport();
  const remove = useDeleteScheduledExport();
  const runNow = useRunScheduledExportNow();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ScheduledExportInput>(emptyInput);
  const [pendingDelete, setPendingDelete] = useState<ScheduledExport | null>(null);
  const [saving, setSaving] = useState(false);
  const saveRequest = useRef<object | null>(null);
  const deleteRequest = useRef<object | null>(null);
  const formInstance = useRef<object>({});
  const currentForm = useRef(form);
  currentForm.current = form;
  const savePending = saving || create.isPending || update.isPending;

  useEffect(() => () => {
    formInstance.current = {};
    saveRequest.current = null;
    deleteRequest.current = null;
  }, []);

  const rows = state.data ?? [];

  // Stable identity so QueryError's offline auto-retry effect doesn't
  // re-subscribe on every render.
  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  function startCreate() {
    if (saveRequest.current) return;
    formInstance.current = {};
    setForm(emptyInput());
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(row: ScheduledExport) {
    if (saveRequest.current) return;
    formInstance.current = {};
    setForm(inputFromRow(row));
    setEditingId(row.id);
    setShowForm(true);
  }

  function closeForm() {
    if (saveRequest.current) return;
    formInstance.current = {};
    setShowForm(false);
    setEditingId(null);
    setForm(emptyInput());
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!showForm || saveRequest.current || create.isPending || update.isPending) return;
    const request = {};
    const instance = formInstance.current;
    const draft = form;
    saveRequest.current = request;
    setSaving(true);
    const payload: ScheduledExportInput = {
      ...form,
      // Drop the optional target field for download deliveries so we
      // don't round-trip an unused string.
      delivery:
        form.delivery.kind === 'download'
          ? { kind: 'download' }
          : { kind: form.delivery.kind, target: (form.delivery.target ?? '').trim() },
    };
    try {
      if (editingId == null) {
        await create.mutateAsync(payload);
      } else {
        await update.mutateAsync({ id: editingId, payload });
      }
      if (saveRequest.current === request && formInstance.current === instance &&
          currentForm.current === draft) {
        saveRequest.current = null;
        setSaving(false);
        closeForm();
      }
    } catch {
      /* toast surfaced by mutation hook */
    } finally {
      if (saveRequest.current === request) {
        saveRequest.current = null;
        setSaving(false);
      }
    }
  }

  async function toggleEnabled(row: ScheduledExport) {
    if (saveRequest.current || update.isPending) return;
    try {
      await update.mutateAsync({
        id: row.id,
        payload: { ...inputFromRow(row), enabled: !row.enabled },
      });
    } catch {
      /* toast surfaced by mutation hook */
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleteRequest.current || remove.isPending) return;
    const request = {};
    const selected = pendingDelete;
    deleteRequest.current = request;
    try {
      await remove.mutateAsync(selected.id);
      if (deleteRequest.current === request) {
        setPendingDelete(current => current === selected ? null : current);
      }
    } catch {
      /* toast surfaced by mutation hook; retain confirmation for retry */
    } finally {
      if (deleteRequest.current === request) deleteRequest.current = null;
    }
  }

  return (
    <GlassPanel className="min-w-0 p-4 md:p-6" data-testid="scheduled-exports-panel">
      <StaleRefreshWarning
        state={state}
        label={t('dataExport.scheduled.title', 'Scheduled exports')}
        message={getErrorMessage(state.refreshError, '') || undefined}
      />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Heading level="section">
            {t('dataExport.scheduled.title', 'Scheduled exports')}
          </Heading>
          <Text as="p" size="sm" color="secondary">
            {t(
              'dataExport.scheduled.subtitle',
              "Cron-driven recurring exports. The server runs each schedule on its cadence and delivers the result via download, email, or webhook.",
            )}
          </Text>
        </div>
        <Button
          variant="primary"
          size="sm"
          wrapLabel
          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
          onClick={startCreate}
          disabled={saving}
          icon={<Icons.add className="h-4 w-4" />}
          data-testid="scheduled-exports-new-button"
        >
          {t('dataExport.scheduled.newSchedule', 'New schedule')}
        </Button>
      </div>

      {showForm ? (
        <form
          onSubmit={submit}
          className="mt-6 space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
          data-testid="scheduled-exports-form"
          aria-busy={savePending}
        >
          <fieldset disabled={savePending} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <Text as="span" size="xs" color="secondary" className="tracking-wide">
                {t('dataExport.scheduled.form.name', 'Name')}
              </Text>
              <Input
                className="min-h-11 md:min-h-10"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t(
                  'dataExport.scheduled.form.namePlaceholder',
                  'Drives weekly',
                )}
                required
              />
            </label>
            <label className="block">
              <Text as="span" size="xs" color="secondary" className="tracking-wide">
                {t('dataExport.scheduled.form.scheduleCron', 'Cron expression')}
              </Text>
              <Input
                className="min-h-11 md:min-h-10"
                value={form.schedule_cron}
                onChange={(e) => setForm({ ...form, schedule_cron: e.target.value })}
                placeholder="0 9 * * 0"
                required
              />
              <Text as="span" variant="helper" className="mt-1 block">
                {t(
                  'dataExport.scheduled.form.scheduleCronHelp',
                  "Standard 5-field cron, e.g. '0 9 * * 0' for 09:00 every Sunday.",
                )}
              </Text>
            </label>
            <label className="block">
              <Text as="span" size="xs" color="secondary" className="tracking-wide">
                {t('dataExport.scheduled.form.exportType', 'Export type')}
              </Text>
              <Select
                value={form.export_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    export_type: e.target.value as ScheduledExport['export_type'],
                  })
                }
                options={EXPORT_TYPES.map((opt) => ({ value: opt, label: opt }))}
              />
            </label>
            <label className="block">
              <Text as="span" size="xs" color="secondary" className="tracking-wide">
                {t('dataExport.scheduled.form.format', 'Format')}
              </Text>
              <Select
                value={form.format}
                onChange={(e) =>
                  setForm({
                    ...form,
                    format: e.target.value as ScheduledExport['format'],
                  })
                }
                options={FORMATS.map((opt) => ({ value: opt, label: opt }))}
              />
            </label>
            <label className="block">
              <Text as="span" size="xs" color="secondary" className="tracking-wide">
                {t('dataExport.scheduled.form.rangeWindow', 'Range window')}
              </Text>
              <Input
                className="min-h-11 md:min-h-10"
                value={form.range_window ?? ''}
                onChange={(e) => setForm({ ...form, range_window: e.target.value })}
                placeholder="7d"
              />
              <Text as="span" variant="helper" className="mt-1 block">
                {t(
                  'dataExport.scheduled.form.rangeWindowHelp',
                  "Relative window applied at run time. Format: number + m/h/d (e.g. 7d).",
                )}
              </Text>
            </label>
            <label className="block">
              <Text as="span" size="xs" color="secondary" className="tracking-wide">
                {t('dataExport.scheduled.form.deliveryKind', 'Delivery kind')}
              </Text>
              <Select
                value={form.delivery.kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    delivery: {
                      ...form.delivery,
                      kind: e.target.value as ScheduledExport['delivery']['kind'],
                    },
                  })
                }
                options={DELIVERY_KINDS.map((opt) => ({ value: opt, label: opt }))}
              />
            </label>
            {form.delivery.kind !== 'download' ? (
              <label className="block md:col-span-2">
                <Text as="span" size="xs" color="secondary" className="tracking-wide">
                  {t('dataExport.scheduled.form.deliveryTarget', 'Delivery target')}
                </Text>
                <Input
                  className="min-h-11 md:min-h-10"
                  value={form.delivery.target ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      delivery: { ...form.delivery, target: e.target.value },
                    })
                  }
                  placeholder={
                    form.delivery.kind === 'email'
                      ? 'you@example.com'
                      : 'https://example.com/hook'
                  }
                  required
                />
                <Text as="span" variant="helper" className="mt-1 block">
                  {t(
                    'dataExport.scheduled.form.deliveryTargetHelp',
                    "Email address (email kind) or HTTPS URL (webhook kind). Ignored for download.",
                  )}
                </Text>
              </label>
            ) : null}
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeForm}
              disabled={savePending}
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            >
              {t('dataExport.scheduled.form.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savePending}
              data-testid="scheduled-exports-form-submit"
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            >
              {t('dataExport.scheduled.form.submit', 'Save schedule')}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-6">
        {state.status === 'initial' && state.isRefreshBlocked ? (
          <Text color="secondary" role="status">{t('dataSources.status.paused', 'Refresh paused')}</Text>
        ) : state.status === 'initial' ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError && rows.length === 0 ? (
          // A failed load must not masquerade as "no schedules yet" — surface
          // an actionable error with retry instead of the empty placeholder.
          <QueryError
            error={error}
            message={getErrorMessage(error, '') || undefined}
            onRetry={handleRetry}
            resourceName={t('dataExport.scheduled.resourceName', 'Scheduled exports')}
          />
        ) : rows.length === 0 ? (
          // no-action: panel header already exposes a "New schedule" button
          <EmptyState
            title={t('dataExport.scheduled.empty', 'No schedules yet')}
            message={t(
              'dataExport.scheduled.emptyMessage',
              'Create a schedule to receive recurring exports automatically.',
            )}
          />
        ) : (
          <div className="max-w-full overflow-x-auto" data-testid="scheduled-exports-table">
            <Table>
              <thead>
                <tr>
                  <th scope="col">{t('dataExport.scheduled.table.name', 'Name')}</th>
                  <th scope="col">{t('dataExport.scheduled.table.type', 'Type')}</th>
                  <th scope="col">{t('dataExport.scheduled.table.cron', 'Cron')}</th>
                  <th scope="col">{t('dataExport.scheduled.table.delivery', 'Delivery')}</th>
                  <th scope="col">{t('dataExport.scheduled.table.nextRun', 'Next run')}</th>
                  <th scope="col">{t('dataExport.scheduled.table.lastRun', 'Last run')}</th>
                  <th scope="col">{t('dataExport.scheduled.table.status', 'Status')}</th>
                  <th scope="col" className="text-right">{t('dataExport.scheduled.table.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`scheduled-exports-row-${row.id}`}
                    className={row.enabled ? '' : 'opacity-50'}
                  >
                    <td className="font-medium">{row.name}</td>
                    <td>{row.export_type} ({row.format})</td>
                    <td><Code>{row.schedule_cron}</Code></td>
                    <td>
                      {row.delivery.kind}
                      {row.delivery.target ? ` → ${row.delivery.target}` : ''}
                    </td>
                    <td>
                      {row.next_run_at ? (
                        <TimeStamp value={row.next_run_at} />
                      ) : (
                        <Text as="span" color="muted">—</Text>
                      )}
                    </td>
                    <td>
                      {row.last_run_at ? (
                        <TimeStamp value={row.last_run_at} />
                      ) : (
                        <Text as="span" color="muted">
                          {t('dataExport.scheduled.status.never', 'Never')}
                        </Text>
                      )}
                    </td>
                    <td>
                      {row.last_status === 'ok' ? (
                        <Badge variant="success">{t('dataExport.scheduled.status.ok', 'OK')}</Badge>
                      ) : row.last_status === 'failed' ? (
                        <Badge variant="danger">{t('dataExport.scheduled.status.failed', 'Failed')}</Badge>
                      ) : (
                        <Text as="span" color="muted">—</Text>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-2 md:gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => runNow.mutate(row.id)}
                          loading={runNow.isPending && runNow.variables === row.id}
                          data-testid={`scheduled-exports-run-${row.id}`}
                          wrapLabel
                          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                        >
                          {t('dataExport.scheduled.actions.runNow', 'Run now')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleEnabled(row)}
                          disabled={savePending}
                          wrapLabel
                          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                        >
                          {row.enabled
                            ? t('dataExport.scheduled.actions.disable', 'Disable')
                            : t('dataExport.scheduled.actions.enable', 'Enable')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(row)}
                          disabled={saving}
                          wrapLabel
                          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                        >
                          {t('dataExport.scheduled.actions.edit', 'Edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (!deleteRequest.current) setPendingDelete(row);
                          }}
                          data-testid={`scheduled-exports-delete-${row.id}`}
                          wrapLabel
                          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                        >
                          {t('dataExport.scheduled.actions.delete', 'Delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('dataExport.scheduled.deleteConfirmTitle', 'Delete schedule?')}
        message={t(
          'dataExport.scheduled.deleteConfirmBody',
          "This will stop future runs of {{name}}. Past download artifacts are not affected.",
          { name: pendingDelete?.name ?? '' },
        )}
        variant="danger"
        loading={remove.isPending}
        confirmLabel={t('dataExport.scheduled.actions.delete', 'Delete')}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleteRequest.current && !remove.isPending) setPendingDelete(null);
        }}
      />
    </GlassPanel>
  );
}
