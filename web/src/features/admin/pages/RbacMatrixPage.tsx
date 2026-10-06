import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, RefreshCw, ShieldCheck, Unlock } from 'lucide-react';
import { PageLayout, LayoutCard } from '@/components/layout';
import { Badge, Button, Card, Heading, HelperText, PanelTitle } from '@/components/ui';
import { AlertBanner, EmptyState, QueryError, TableSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { diffMatrices, isRbacOpenMode, useRbacMatrix, useUpsertRbacCells } from '@/api/hooks/useRbacMatrix';
import { isApiError } from '@/api/client';
import { deriveDataState } from '@/api/dataState';
import { RbacMatrixGrid } from '../components/continuation-admin-2/RbacMatrixGrid';
import { RbacOperationalBrief } from '../components/operationalbrief-r-z/RbacOperationalBrief';
import { RbacAccessSummary } from '../components/continuation-admin-2/RbacAccessSummary';
import { snapshotToDraft, type MatrixDraft } from '../components/continuation-admin-2/rbacPresentation';

export default function RbacMatrixPage() {
  const { t } = useTranslation();
  usePageTitle(t('rbac.title', 'RBAC matrix'));
  const matrixQuery = useRbacMatrix();
  const matrixState = deriveDataState(matrixQuery);
  const upsert = useUpsertRbacCells();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MatrixDraft>({ cells: {} });
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Never replace an in-progress draft with a polling snapshot.
  useEffect(() => {
    if (!matrixQuery.data || isRbacOpenMode(matrixQuery.data) || editing) return;
    setDraft(snapshotToDraft(matrixQuery.data.matrix));
  }, [matrixQuery.data, editing]);

  const dirtyCount = useMemo(() => {
    const live = matrixQuery.data;
    if (!live || isRbacOpenMode(live)) return 0;
    return diffMatrices(live.matrix, draft.cells).length;
  }, [matrixQuery.data, draft.cells]);
  const briefState = {
    known: matrixState.hasData,
    loading: matrixState.status === 'initial',
    retained: matrixState.hasData && (matrixState.isRefreshing || matrixState.status === 'stale'),
    failed: matrixState.fatalError != null,
  };

  if (matrixQuery.isLoading && !matrixState.hasData) {
    return (
      <PageLayout
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <div className="space-y-4" data-testid="rbac-loading">
          <RbacOperationalBrief source={briefState} />
          <Card padding="none" className="p-5"><TableSkeleton rows={7} cols={4} /></Card>
        </div>
      </PageLayout>
    );
  }

  if (isRbacOpenMode(matrixQuery.data)) {
    return (
      <PageLayout
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <Card padding="none" className="p-6" data-testid="rbac-open-mode">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden />
                <Heading level="section">{t('rbac.openMode.title', 'RBAC requires forward-auth mode')}</Heading>
              </div>
              <HelperText className="max-w-3xl">
                {t('rbac.openMode.message',
                  'The RBAC matrix is meaningful only when an upstream proxy (Authentik, Authelia, oauth2-proxy, Keycloak, etc.) injects an authenticated subject header. Configure FORWARD_AUTH_HEADER and TESLASYNC_RBAC_GROUPS_HEADER on the API service then reload.')}
              </HelperText>
            </div>
          </Card>
        </FadeIn>
      </PageLayout>
    );
  }

  if (matrixState.fatalError || !matrixQuery.data) {
    return (
      <PageLayout
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <RbacOperationalBrief source={briefState} />
          <Card padding="none" className="p-4 sm:p-5" data-testid="rbac-load-error">
            <PanelTitle className="mb-3">{t('rbac.errors.loadTitle', 'Failed to load RBAC matrix')}</PanelTitle>
            <QueryError error={matrixState.fatalError} onRetry={() => matrixQuery.refetch()} />
          </Card>
        </FadeIn>
      </PageLayout>
    );
  }

  const payload = matrixQuery.data;
  const handleToggle = (roleID: string, permID: string, next: boolean) => {
    setDraft((prev) => {
      const row = { ...(prev.cells[roleID] ?? {}) };
      row[permID] = next;
      return { cells: { ...prev.cells, [roleID]: row } };
    });
  };
  const handleEnterEdit = () => {
    setSubmitError(null);
    setDraft(snapshotToDraft(payload.matrix));
    setEditing(true);
  };
  const handleCancelEdit = () => {
    setEditing(false);
    setDraft(snapshotToDraft(payload.matrix));
    setSubmitError(null);
  };
  const handleSave = async () => {
    setSubmitError(null);
    const cells = diffMatrices(payload.matrix, draft.cells);
    if (cells.length === 0) {
      setEditing(false);
      return;
    }
    try {
      await upsert.mutateAsync(cells);
      setEditing(false);
    } catch (err) {
      const code = isApiError(err) ? err.code : undefined;
      setSubmitError(code ?? t('rbac.errors.saveGeneric', 'The matrix endpoint rejected the update.'));
    }
  };

  if ((payload.roles ?? []).length === 0) {
    return (
      <PageLayout
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <RbacOperationalBrief payload={payload} source={briefState} />
          <Card padding="none" className="p-4 sm:p-5" data-testid="rbac-empty">
            <EmptyState icon={<ShieldCheck className="h-8 w-8" aria-hidden />}
              title={t('rbac.empty.title', 'No roles configured')}
              action={{ label: t('rbac.actions.refresh', 'Refresh'), onClick: () => { void matrixQuery.refetch(); } }}
              message={t('rbac.empty.message',
                'No roles have been forwarded by the upstream proxy and no bindings exist in the database. Configure TESLASYNC_RBAC_GROUPS_HEADER on the API service and reload.')} />
          </Card>
        </FadeIn>
      </PageLayout>
    );
  }

  const actions = editing ? (
    <div className="flex flex-wrap items-center gap-2">
      {dirtyCount > 0 && <Badge variant="warning" data-testid="rbac-dirty-badge">
        {t('rbac.pending.count', '{{count}} pending', { count: dirtyCount })}
      </Badge>}
      <Button variant="ghost" onClick={handleCancelEdit} disabled={upsert.isPending} data-testid="rbac-cancel-button">
        {t('rbac.actions.cancel', 'Cancel')}
      </Button>
      <Button onClick={handleSave} disabled={upsert.isPending || dirtyCount === 0} data-testid="rbac-save-button">
        <Lock className="h-4 w-4" aria-hidden />
        {upsert.isPending ? t('rbac.actions.saving', 'Saving…') : t('rbac.actions.save', 'Save ({{count}})', { count: dirtyCount })}
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" onClick={() => matrixQuery.refetch()} disabled={matrixQuery.isFetching}
        aria-label={t('rbac.actions.refresh', 'Refresh')} title={t('rbac.actions.refresh', 'Refresh')}>
        <RefreshCw className={cn('h-4 w-4', matrixQuery.isFetching && 'animate-spin')} aria-hidden />
      </Button>
      <Button variant="secondary" onClick={handleEnterEdit} data-testid="rbac-edit-button">
        <Unlock className="h-4 w-4" aria-hidden />{t('rbac.actions.edit', 'Edit')}
      </Button>
    </div>
  );

  return (
    <PageLayout title={t('rbac.title', 'RBAC matrix')} subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      secondaryActions={actions} query={matrixQuery}
      dataSources={[{ id: 'rbac-matrix', label: t('rbac.title', 'RBAC matrix'), query: matrixQuery }]}>
      {submitError && <AlertBanner variant="danger" data-testid="rbac-save-error">{submitError}</AlertBanner>}
      <FadeIn><RbacOperationalBrief payload={payload} source={briefState} /></FadeIn>
      <FadeIn delay={0.1}><RbacAccessSummary payload={payload} editing={editing} /></FadeIn>
      <FadeIn delay={0.2}>
        <LayoutCard title={t('rbac.matrix.title', 'Permission matrix')}
          actions={editing && <Badge variant="warning">{t('rbac.matrix.editing', 'Editing')}</Badge>}>
          <RbacMatrixGrid payload={payload} draft={draft} editing={editing} onToggle={handleToggle} />
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
