/**
 * Audit Log Page — Phase-45 admin observability surface.
 *
 * Filtered audit-log browser plus a "Verify chain" action that
 * re-derives the SHA-256 hash chain server-side. Filters are
 * persisted via search params so a link reproduces the view.
 *
 * Backed by:
 *   GET /api/v1/admin/audit-log            (filtered list)
 *   GET /api/v1/admin/audit-log/categories (filter dropdown)
 *   GET /api/v1/admin/audit-log/actions    (filter dropdown)
 *   GET /api/v1/admin/audit-log/verify     (chain re-derivation)
 *
 * See internal/handler/v1/admin_audit_handler.go.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, ShieldCheck, ShieldAlert, Search, X as XIcon } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  Input,
  Select,
  DataTable,
  CopyButton,
  type Column,
} from '@/components/ui';
import { PanelTitle, Caption } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
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
    if (since) p.since = new Date(since).toISOString();
    if (until) p.until = new Date(until).toISOString();
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

  const rows = logQuery.data?.rows ?? [];

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

  const handleVerify = () => {
    verifyQuery.refetch();
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
            <div className="text-[var(--text-primary)]">{formatDateTime(r.ts)}</div>
            <Caption>{formatRelative(r.ts)}</Caption>
          </div>
        ),
      },
      {
        key: 'actor',
        header: t('admin.auditLog.colActor', 'Actor'),
        render: (r) => <span className="text-[var(--text-primary)]">{r.actor || '—'}</span>,
      },
      {
        key: 'category',
        header: t('admin.auditLog.colCategory', 'Category'),
        render: (r) => (r.category ? <Badge variant="neutral">{r.category}</Badge> : <span className="text-[var(--text-muted)]">—</span>),
      },
      {
        key: 'action',
        header: t('admin.auditLog.colAction', 'Action'),
        render: (r) => <span className="font-medium text-[var(--text-primary)]">{r.action}</span>,
      },
      {
        key: 'entity',
        header: t('admin.auditLog.colEntity', 'Entity'),
        render: (r) => (
          <div>
            <span className="text-[var(--text-primary)]">{r.entity_type}</span>
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
          <span className="line-clamp-2 text-[var(--text-secondary)]">{r.detail ?? '—'}</span>
        ),
      },
      {
        key: 'trace',
        header: t('admin.auditLog.colTrace', 'Trace'),
        render: (r) =>
          r.trace_id ? (
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs text-[var(--text-secondary)]">
                {r.trace_id.slice(0, 8)}…
              </span>
              <CopyButton text={r.trace_id} iconOnly variant="ghost" size="sm" />
            </div>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
      {
        key: 'success',
        header: t('admin.auditLog.colSuccess', 'Status'),
        align: 'right',
        render: (r) => {
          if (r.success === false) return <Badge variant="danger">Fail</Badge>;
          if (r.success === true) return <Badge variant="success">OK</Badge>;
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

  const verifyData = verifyQuery.data;

  return (
    <PageContainer
      title={t('admin.auditLog.pageTitle', 'Audit Log')}
      subtitle={t(
        'admin.auditLog.subtitle',
        'Append-only audit ledger with SHA-256 hash chaining. Use the filter row to narrow scope and Verify Chain to re-derive integrity on demand.',
      )}
      query={logQuery}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.auditLog.notConfigured',
                'The audit log subsystem is not configured on this deployment.',
              )}
            </AlertBanner>
          )}

          <GlassPanel className="p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <PanelTitle>{t('admin.auditLog.integrityTitle', 'Hash chain integrity')}</PanelTitle>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleVerify}
                disabled={verifyQuery.isFetching}
              >
                {verifyQuery.isFetching
                  ? t('admin.auditLog.verifying', 'Verifying…')
                  : t('admin.auditLog.verifyButton', 'Verify chain')}
              </Button>
            </div>
            {!verifyData && !verifyQuery.isFetching && (
              <Caption>
                {t(
                  'admin.auditLog.verifyHint',
                  'Triggers a server-side re-derivation of every row_hash. No data is sent or written; this is read-only.',
                )}
              </Caption>
            )}
            {verifyQuery.error && (
              <AlertBanner variant="danger" title={t('admin.auditLog.verifyErrorTitle', 'Verification failed')}>
                {verifyQuery.error.message}
              </AlertBanner>
            )}
            {verifyData && (
              <div className="flex flex-wrap items-center gap-3">
                {verifyData.intact ? (
                  <Badge variant="success" size="lg">
                    <ShieldCheck className="mr-1 inline h-4 w-4" />
                    {t('admin.auditLog.chainIntact', 'Chain intact')}
                  </Badge>
                ) : (
                  <Badge variant="danger" size="lg">
                    <ShieldAlert className="mr-1 inline h-4 w-4" />
                    {t('admin.auditLog.chainBroken', 'Chain broken')}
                  </Badge>
                )}
                <Caption>
                  {t('admin.auditLog.rowsChecked', '{{count}} rows checked', {
                    count: verifyData.rows_checked,
                  })}
                </Caption>
                {!verifyData.intact && verifyData.first_bad_id > 0 && (
                  <Caption>
                    {t('admin.auditLog.firstBadId', 'First bad row: #{{id}}', {
                      id: verifyData.first_bad_id,
                    })}
                  </Caption>
                )}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-6">
            <PanelTitle className="mb-4">{t('admin.auditLog.filtersTitle', 'Filters')}</PanelTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
              <div className="flex items-end gap-2">
                <Button variant="ghost" size="md" onClick={handleReset}>
                  <XIcon className="mr-1 h-4 w-4" />
                  {t('admin.auditLog.resetFilters', 'Reset')}
                </Button>
                <Button variant="primary" size="md" onClick={() => logQuery.refetch()}>
                  <Search className="mr-1 h-4 w-4" />
                  {t('admin.auditLog.applyFilters', 'Search')}
                </Button>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <PanelTitle>{t('admin.auditLog.tableTitle', 'Entries')}</PanelTitle>
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
              {rows.length === 0 && !logQuery.isLoading && !subsystemMissing ? (
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
                  columns={columns}
                  data={rows}
                  keyExtractor={(r) => r.id}
                  emptyMessage={t('admin.auditLog.emptyTable', 'No entries')}
                  expandable
                  expandedKeys={expanded}
                  onExpandedChange={(next) => setExpanded(next)}
                  renderExpanded={(r) => <ExpandedDetail row={r} />}
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </div>
      </FadeIn>
    </PageContainer>
  );
}

function ExpandedDetail({ row }: { row: AuditLogRow }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
      <div>
        <Caption>{t('admin.auditLog.detailIp', 'IP')}</Caption>
        <div className="font-mono text-sm text-[var(--text-primary)]">{row.ip ?? '—'}</div>
      </div>
      <div>
        <Caption>{t('admin.auditLog.detailUa', 'User-agent')}</Caption>
        <div className="break-all text-sm text-[var(--text-primary)]">{row.user_agent ?? '—'}</div>
      </div>
      {row.trace_id && (
        <div className="md:col-span-2">
          <Caption>{t('admin.auditLog.detailTrace', 'Trace ID')}</Caption>
          <div className="flex items-center gap-2">
            <span className="break-all font-mono text-sm text-[var(--text-primary)]">{row.trace_id}</span>
            <CopyButton text={row.trace_id} iconOnly variant="ghost" size="sm" />
          </div>
        </div>
      )}
      {row.before && (
        <div>
          <Caption>{t('admin.auditLog.detailBefore', 'Before')}</Caption>
          <pre className="max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-3 font-mono text-xs text-[var(--text-primary)]">
            {formatJSON(row.before)}
          </pre>
        </div>
      )}
      {row.after && (
        <div>
          <Caption>{t('admin.auditLog.detailAfter', 'After')}</Caption>
          <pre className="max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-3 font-mono text-xs text-[var(--text-primary)]">
            {formatJSON(row.after)}
          </pre>
        </div>
      )}
      {row.row_hash && (
        <div className="md:col-span-2">
          <Caption>{t('admin.auditLog.detailHash', 'Row hash')}</Caption>
          <div className="flex items-center gap-2">
            <span className="break-all font-mono text-xs text-[var(--text-secondary)]">{row.row_hash}</span>
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
