/**
 * Audit-log browser and hash-chain verification surface.
 *
 * Full-width modern-ui cockpit: a derived KPI band, a controls bento
 * (filters + hash-chain integrity), and a full-bleed entries table with
 * expandable rows and CSV export. Filters are page state so the query
 * URL reproduces the view.
 *
 * Backed by:
 *   GET /admin/audit-log            (filtered list)
 *   GET /admin/audit-log/categories (filter dropdown)
 *   GET /admin/audit-log/actions    (filter dropdown)
 *   GET /admin/audit-log/verify     (chain re-derivation)
 *
 * The shared request() client prepends /api/v1, so the hook URLs above
 * carry no prefix. See internal/handler/v1/admin_audit_handler.go and
 * internal/api/router.go (~L3867).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Search,
  X as XIcon,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  Users,
  Tags,
  Activity,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  Input,
  Select,
  DataTable,
  CopyButton,
  SectionTitle,
  Caption,
  Text,
  type Column,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState,
  AlertBanner,
  DataStateNotice,
  QueryError,
  Skeleton,
  SectionErrorBoundary,
} from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import {
  useAuditLog,
  useAuditCategories,
  useAuditActions,
  useAuditChainVerify,
} from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type { AuditLogQueryParams, AuditLogRow } from '@/types/admin-operator-confidence';

const LIMIT_OPTIONS = [
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '250', label: '250' },
  { value: '500', label: '500' },
];

export default function AuditLogPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.auditLog.pageTitle', 'Audit Log'));

  // Filter state — string fields are empty=unset, never undefined,
  // so the controlled inputs stay controlled.
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState('100');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<(string | number)[]>([]);

  const queryParams = useMemo<AuditLogQueryParams>(() => {
    const p: AuditLogQueryParams = { limit: Number(limit), offset };
    const sinceIso = toIsoOrUndefined(since);
    const untilIso = toIsoOrUndefined(until);
    if (sinceIso) p.since = sinceIso;
    if (untilIso) p.until = untilIso;
    if (category) p.categories = [category];
    if (action) p.actions = [action];
    if (actor) p.actors = [actor];
    if (entityType) p.entity_type = entityType;
    return p;
  }, [since, until, category, action, actor, entityType, limit, offset]);

  const logQuery = useAuditLog(queryParams);
  const categoriesQuery = useAuditCategories();
  const actionsQuery = useAuditActions();
  const verifyQuery = useAuditChainVerify(null, 1000, false);

  const subsystemMissing = isApiError(logQuery.error) && logQuery.error.status === 503;
  const tableError = logQuery.error && !subsystemMissing ? logQuery.error : null;

  const rows = logQuery.data?.rows ?? [];
  const verifyData = verifyQuery.data;

  // Derived, null-safe KPIs. "In view" metrics describe the current page of
  // rows (honest framing — the ledger is append-only and unbounded).
  const failedCount = useMemo(() => rows.filter((r) => r.success === false).length, [rows]);
  const okCount = useMemo(() => rows.filter((r) => r.success === true).length, [rows]);
  const distinctActors = useMemo(
    () => new Set(rows.map((r) => r.actor).filter(Boolean)).size,
    [rows],
  );
  const categoriesCount = categoriesQuery.data?.categories?.length ?? 0;
  const actionsCount = actionsQuery.data?.actions?.length ?? 0;

  // KPI honesty: only trust a derived count once its source query has
  // actually returned. While a query is loading or has errored, a raw 0
  // would read as "there are genuinely zero entries" when in truth we just
  // couldn't load them — surface the universal "—" placeholder instead so
  // the header never reports a fabricated zero (mirrors the
  // RedisSignalViewerPage error-honesty contract).
  const countsReady = logQuery.data !== undefined && !logQuery.error;
  const categoriesReady = categoriesQuery.data !== undefined && !categoriesQuery.error;
  const actionsReady = actionsQuery.data !== undefined && !actionsQuery.error;

  const categoryOptions = useMemo<{ value: string; label: string }[]>(() => {
    const list = categoriesQuery.data?.categories ?? [];
    return [
      { value: '', label: t('admin.auditLog.allCategories', 'All categories') },
      ...list.map((c) => ({ value: c, label: c })),
    ];
  }, [categoriesQuery.data, t]);

  const actionOptions = useMemo<{ value: string; label: string }[]>(() => {
    const list = actionsQuery.data?.actions ?? [];
    return [
      { value: '', label: t('admin.auditLog.allActions', 'All actions') },
      ...list.map((a) => ({ value: a, label: a })),
    ];
  }, [actionsQuery.data, t]);

  const handleReset = () => {
    setSince('');
    setUntil('');
    setCategory('');
    setAction('');
    setActor('');
    setEntityType('');
    setOffset(0);
  };

  const toggleExpanded = (id: number) => {
    setExpanded((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    );
  };

  const columns = useMemo<Column<AuditLogRow>[]>(
    () => [
      {
        key: 'ts',
        header: t('admin.auditLog.colTs', 'Timestamp'),
        render: (r) => (
          <div>
            <Text as="div" variant="body">{formatDateTime(r.ts)}</Text>
            <Caption>{formatRelative(r.ts)}</Caption>
          </div>
        ),
      },
      {
        key: 'actor',
        header: t('admin.auditLog.colActor', 'Actor'),
        render: (r) => <Text variant="body">{r.actor || '—'}</Text>,
      },
      {
        key: 'category',
        header: t('admin.auditLog.colCategory', 'Category'),
        render: (r) =>
          r.category ? (
            <Badge variant="neutral">{r.category}</Badge>
          ) : (
            <Text color="muted">—</Text>
          ),
      },
      {
        key: 'action',
        header: t('admin.auditLog.colAction', 'Action'),
        render: (r) => <Text weight="medium" color="primary">{r.action}</Text>,
      },
      {
        key: 'entity',
        header: t('admin.auditLog.colEntity', 'Entity'),
        render: (r) => (
          <div>
            <Text variant="body">{r.entity_type}</Text>
            {r.entity_id !== null && r.entity_id !== undefined && (
              <Caption>{`#${r.entity_id}`}</Caption>
            )}
          </div>
        ),
      },
      {
        key: 'detail',
        header: t('admin.auditLog.colDetail', 'Detail'),
        render: (r) => (
          <Text color="secondary" className="line-clamp-2">{r.detail ?? '—'}</Text>
        ),
      },
      {
        key: 'trace',
        header: t('admin.auditLog.colTrace', 'Trace'),
        render: (r) =>
          r.trace_id ? (
            <div className="flex items-center gap-1">
              <Text mono size="xs" color="secondary">
                {r.trace_id.slice(0, 8)}…
              </Text>
              <CopyButton text={r.trace_id} iconOnly variant="ghost" size="sm" />
            </div>
          ) : (
            <Text color="muted">—</Text>
          ),
      },
      {
        key: 'success',
        header: t('admin.auditLog.colSuccess', 'Status'),
        align: 'right',
        render: (r) => {
          if (r.success === false)
            return (
              <Badge variant="danger">
                <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('admin.auditLog.statusFail', 'Fail')}
              </Badge>
            );
          if (r.success === true)
            return (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {t('admin.auditLog.statusOk', 'OK')}
              </Badge>
            );
          return <Badge variant="neutral">—</Badge>;
        },
      },
      {
        key: 'expand',
        header: '',
        align: 'right',
        render: (r) => (
          <Button variant="ghost" size="sm" onClick={() => toggleExpanded(r.id)}>
            {expanded.includes(r.id)
              ? t('admin.auditLog.hideDetails', 'Hide')
              : t('admin.auditLog.showDetails', 'Details')}
          </Button>
        ),
      },
    ],
    [t, expanded],
  );

  return (
    <PageContainer
      title={t('admin.auditLog.pageTitle', 'Audit Log')}
      subtitle={t(
        'admin.auditLog.subtitle',
        'Append-only audit ledger with SHA-256 hash chaining. Narrow the scope with the filter row and verify the chain to re-derive integrity on demand.',
      )}
      query={logQuery}
    >
      {subsystemMissing && (
        <DataStateNotice
          state="unsupported"
          title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}
        >
          {t(
            'admin.auditLog.notConfigured',
            'The audit log subsystem is not configured on this deployment.',
          )}
        </DataStateNotice>
      )}

      {/* 1 — KPI band: derived, full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('admin.auditLog.kpis', 'Audit overview')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          <MetricCard
            label={t('admin.auditLog.kpiEntries', 'Entries shown')}
            value={countsReady ? rows.length : '—'}
            icon={<ListChecks className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('admin.auditLog.kpiOk', 'OK (in view)')}
            value={countsReady ? okCount : '—'}
            icon={<CheckCircle2 className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('admin.auditLog.kpiFailed', 'Failed (in view)')}
            value={countsReady ? failedCount : '—'}
            icon={<AlertTriangle className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('admin.auditLog.kpiActors', 'Actors (in view)')}
            value={countsReady ? distinctActors : '—'}
            icon={<Users className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('admin.auditLog.kpiCategories', 'Categories')}
            value={categoriesReady ? categoriesCount : '—'}
            icon={<Tags className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('admin.auditLog.kpiActions', 'Action types')}
            value={actionsReady ? actionsCount : '—'}
            icon={<Activity className="h-5 w-5" />}
            color="amber"
          />
        </section>
      </FadeIn>

      {/* 2 — Controls bento: filters (hero) + hash-chain integrity side panel */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <SectionTitle className="mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.auditLog.filtersTitle', 'Filters')}
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 3xl:grid-cols-3">
              <Input
                type="datetime-local"
                label={t('admin.auditLog.sinceLabel', 'Since')}
                value={since}
                onChange={(e) => {
                  setSince(e.target.value);
                  setOffset(0);
                }}
              />
              <Input
                type="datetime-local"
                label={t('admin.auditLog.untilLabel', 'Until')}
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  setOffset(0);
                }}
              />
              <Select
                label={t('admin.auditLog.categoryLabel', 'Category')}
                options={categoryOptions}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setOffset(0);
                }}
              />
              <Select
                label={t('admin.auditLog.actionLabel', 'Action')}
                options={actionOptions}
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setOffset(0);
                }}
              />
              <Input
                label={t('admin.auditLog.actorLabel', 'Actor')}
                placeholder={t('admin.auditLog.actorPlaceholder', 'e.g. admin@local')}
                value={actor}
                onChange={(e) => {
                  setActor(e.target.value);
                  setOffset(0);
                }}
              />
              <Input
                label={t('admin.auditLog.entityTypeLabel', 'Entity type')}
                placeholder={t('admin.auditLog.entityTypePlaceholder', 'e.g. vehicle, alert_rule')}
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setOffset(0);
                }}
              />
              <Select
                label={t('admin.auditLog.limitLabel', 'Rows per page')}
                options={LIMIT_OPTIONS}
                value={limit}
                onChange={(e) => {
                  setLimit(e.target.value);
                  setOffset(0);
                }}
              />
              <div className="flex items-end gap-2 sm:col-span-2 3xl:col-span-1">
                <Button variant="ghost" size="md" className="min-h-11" onClick={handleReset}>
                  <XIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('admin.auditLog.resetFilters', 'Reset')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="min-h-11"
                  onClick={() => logQuery.refetch()}
                >
                  <Search className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('admin.auditLog.applyFilters', 'Search')}
                </Button>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('admin.auditLog.integrityTitle', 'Hash chain integrity')}
              </SectionTitle>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => verifyQuery.refetch()}
                disabled={verifyQuery.isFetching}
              >
                {verifyQuery.isFetching
                  ? t('admin.auditLog.verifying', 'Verifying…')
                  : t('admin.auditLog.verifyButton', 'Verify chain')}
              </Button>
            </div>

            {verifyQuery.isFetching ? (
              <Skeleton height={72} />
            ) : verifyQuery.error ? (
              <AlertBanner
                variant="danger"
                title={t('admin.auditLog.verifyErrorTitle', 'Verification failed')}
              >
                {verifyQuery.error.message}
              </AlertBanner>
            ) : verifyData ? (
              <div className="space-y-3">
                {verifyData.intact ? (
                  <Badge variant="success" size="lg">
                    <ShieldCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.chainIntact', 'Chain intact')}
                  </Badge>
                ) : (
                  <Badge variant="danger" size="lg">
                    <ShieldAlert className="mr-1 inline h-4 w-4" aria-hidden="true" />
                    {t('admin.auditLog.chainBroken', 'Chain broken')}
                  </Badge>
                )}
                <Caption className="block">
                  {t('admin.auditLog.rowsChecked', '{{count}} rows checked', {
                    count: verifyData.rows_checked,
                  })}
                </Caption>
                {!verifyData.intact && verifyData.first_bad_id > 0 && (
                  <Caption className="block">
                    {t('admin.auditLog.firstBadId', 'First bad row: #{{id}}', {
                      id: verifyData.first_bad_id,
                    })}
                  </Caption>
                )}
              </div>
            ) : (
              <EmptyState
                /* no-action: verification is an explicit, read-only operator action via the button above */
                icon={<ShieldQuestion className="h-8 w-8" />}
                message={t(
                  'admin.auditLog.verifyHint',
                  'Re-derive every row_hash server-side. No data is sent or written — this is read-only.',
                )}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Detail band: full-width entries table */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.auditLog.tableTitle', 'Entries')}
            </SectionTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOffset(Math.max(0, offset - Number(limit)))}
                disabled={offset === 0}
              >
                {t('admin.auditLog.prevPage', 'Previous')}
              </Button>
              <Caption>
                {t('admin.auditLog.pageInfo', 'Showing {{from}}–{{to}}', {
                  from: rows.length === 0 ? 0 : offset + 1,
                  to: offset + rows.length,
                })}
              </Caption>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOffset(offset + Number(limit))}
                disabled={rows.length < Number(limit)}
              >
                {t('admin.auditLog.nextPage', 'Next')}
              </Button>
            </div>
          </div>
          <SectionErrorBoundary name="audit-log-table">
            {tableError ? (
              <QueryError error={tableError} onRetry={() => logQuery.refetch()} />
            ) : logQuery.isLoading && rows.length === 0 ? (
              <Skeleton height={320} />
            ) : rows.length === 0 && !subsystemMissing ? (
              // no-action: filter controls live in the panel above; the message guides users to widen or clear them
              <EmptyState
                icon={<History className="h-8 w-8" />}
                title={t('admin.auditLog.emptyTitle', 'No audit entries')}
                message={t(
                  'admin.auditLog.emptyMessage',
                  'No rows match the current filter. Try widening the time range or clearing the filters.',
                )}
              />
            ) : (
              <DataTable
                tableId="admin:audit-log"
                columns={columns}
                data={rows}
                keyExtractor={(r) => r.id}
                emptyMessage={t('admin.auditLog.emptyTable', 'No entries')}
                expandable
                expandedKeys={expanded}
                onExpandedChange={(next) => setExpanded(next)}
                renderExpanded={(r) => <ExpandedDetail row={r} />}
                exportable
                exportFilename={`audit-log-${new Date().toISOString().slice(0, 10)}`}
                exportRow={(row) => ({
                  id: row.id,
                  ts: row.ts,
                  actor: row.actor,
                  category: row.category ?? '',
                  action: row.action,
                  entity_type: row.entity_type,
                  entity_id: row.entity_id ?? '',
                  detail: row.detail ?? '',
                  ip: row.ip ?? '',
                  user_agent: row.user_agent ?? '',
                  trace_id: row.trace_id ?? '',
                  success:
                    row.success === null || row.success === undefined ? '' : String(row.success),
                  prev_row_hash: row.prev_row_hash ?? '',
                  row_hash: row.row_hash ?? '',
                })}
              />
            )}
          </SectionErrorBoundary>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

function ExpandedDetail({ row }: { row: AuditLogRow }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3">
      <div>
        <Caption>{t('admin.auditLog.detailIp', 'IP')}</Caption>
        <Text as="div" mono size="sm" color="primary">{row.ip ?? '—'}</Text>
      </div>
      <div>
        <Caption>{t('admin.auditLog.detailUa', 'User-agent')}</Caption>
        <Text as="div" size="sm" color="primary" className="break-all">{row.user_agent ?? '—'}</Text>
      </div>
      {row.trace_id && (
        <div className="md:col-span-2 2xl:col-span-1">
          <Caption>{t('admin.auditLog.detailTrace', 'Trace ID')}</Caption>
          <div className="flex items-center gap-2">
            <Text mono size="sm" color="primary" className="break-all">
              {row.trace_id}
            </Text>
            <CopyButton text={row.trace_id} iconOnly variant="ghost" size="sm" />
          </div>
        </div>
      )}
      {row.before && (
        <div>
          <Caption>{t('admin.auditLog.detailBefore', 'Before')}</Caption>
          <Text as="pre" variant="code" className="max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-3">
            {formatJSON(row.before)}
          </Text>
        </div>
      )}
      {row.after && (
        <div>
          <Caption>{t('admin.auditLog.detailAfter', 'After')}</Caption>
          <Text as="pre" variant="code" className="max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-3">
            {formatJSON(row.after)}
          </Text>
        </div>
      )}
      {row.row_hash && (
        <div className="md:col-span-2 2xl:col-span-3">
          <Caption>{t('admin.auditLog.detailHash', 'Row hash')}</Caption>
          <div className="flex items-center gap-2">
            <Text mono size="xs" color="secondary" className="break-all">
              {row.row_hash}
            </Text>
            <CopyButton text={row.row_hash} iconOnly variant="ghost" size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Convert a `datetime-local` input value (`YYYY-MM-DDTHH:mm`, local time) to
 * an ISO-8601 UTC string for the API query. Returns `undefined` for empty or
 * unparseable input so a malformed value can never throw
 * `RangeError: Invalid time value` while `queryParams` is derived mid-render.
 */
function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
