/**
 * RbacMatrixPage.
 *
 * Provider-agnostic "who can do what" admin cockpit. Columns = roles
 * (resolved from the upstream proxy's groups header), rows =
 * permissions (hand-maintained catalog in internal/auth/permissions.go),
 * cells = allow (✓) / deny (–).
 *
 * Read-only by default. The "Edit" toggle flips cells into checkboxes;
 * "Save" diffs the draft against the snapshot and PUTs only the changed
 * cells. The PUT route is RequireSudo-gated upstream so the SPA's reauth
 * dialog pops transparently on Save in forward-auth mode — there is no
 * preemptive sudo challenge when entering edit mode, which would be a
 * worse UX (the operator may toggle a few cells and then change their
 * mind without ever submitting).
 *
 * AUTH_MODE_OPEN: when forward-auth is not configured the matrix is
 * meaningless (one implicit subject, one implicit role). The page renders
 * an inline "configure forward-auth then reload" placeholder instead of a
 * 401/501 toast loop.
 *
 * Modern-UI: the matrix is a single CSS grid (display:contents rows) so
 * columns stay perfectly aligned while the grid — not the page — scrolls
 * horizontally on narrow viewports. A KPI band + access-summary panel sit
 * above it and reflow into more columns on wide monitors.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCheck,
  KeyRound,
  Layers,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlock,
  UserCircle,
  Users,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import {
  Badge,
  Button,
  Caption,
  Checkbox,
  GlassPanel,
  Heading,
  HelperText,
  PanelTitle,
  Text,
} from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { Spinner, EmptyState, AlertBanner, QueryError } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import {
  diffMatrices,
  isRbacOpenMode,
  useRbacMatrix,
  useUpsertRbacCells,
  type RbacMatrixSessionResponse,
  type RbacPermission,
  type RbacRole,
} from '@/api/hooks/useRbacMatrix'
import { isApiError } from '@/api/client'

interface MatrixDraft {
  // [role_id][perm_id] → allowed. Mirrors the server shape so diffing
  // against the snapshot stays straightforward.
  cells: Record<string, Record<string, boolean>>
}

function snapshotToDraft(matrix: Record<string, Record<string, boolean>>): MatrixDraft {
  const cells: Record<string, Record<string, boolean>> = {}
  for (const [roleID, row] of Object.entries(matrix)) {
    cells[roleID] = { ...row }
  }
  return { cells }
}

function permsByCategory(permissions: RbacPermission[]): Map<string, RbacPermission[]> {
  const out = new Map<string, RbacPermission[]>()
  for (const p of permissions) {
    const bucket = out.get(p.category) ?? []
    bucket.push(p)
    out.set(p.category, bucket)
  }
  return out
}

/** Count the allowed (`true`) bindings across every role row in the matrix. */
function countGrants(matrix: Record<string, Record<string, boolean>>): number {
  let total = 0
  for (const row of Object.values(matrix ?? {})) {
    for (const allowed of Object.values(row ?? {})) {
      if (allowed) total += 1
    }
  }
  return total
}

interface MatrixCellProps {
  roleID: string
  permID: string
  allowed: boolean
  editing: boolean
  onToggle: (roleID: string, permID: string, next: boolean) => void
}

/** A single matrix cell — read-only allow/deny glyph or an editable checkbox. */
function MatrixCell({ roleID, permID, allowed, editing, onToggle }: MatrixCellProps) {
  const { t } = useTranslation()
  if (editing) {
    return (
      <Checkbox
        checked={allowed}
        onChange={(next) => onToggle(roleID, permID, next)}
        aria-label={t('rbac.cell.toggle', 'Toggle {{role}} / {{perm}}', {
          role: roleID,
          perm: permID,
        })}
        data-testid={`rbac-cell-edit-${roleID}-${permID}`}
      />
    )
  }
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md px-1 tabular-nums leading-none',
        allowed
          ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25'
          : 'text-[var(--text-muted)]',
      )}
      aria-label={allowed ? t('rbac.cell.allowed', 'Allowed') : t('rbac.cell.denied', 'Denied')}
      data-testid={`rbac-cell-${roleID}-${permID}`}
    >
      {allowed ? '✓' : '–'}
    </span>
  )
}

interface MatrixGridProps {
  payload: RbacMatrixSessionResponse
  draft: MatrixDraft
  editing: boolean
  onToggle: (roleID: string, permID: string, next: boolean) => void
}

/**
 * The role × permission matrix. Rendered as one CSS grid — `role="table"`
 * with `display:contents` rowgroups/rows — so every column stays aligned
 * across category groups while the whole grid scrolls horizontally within
 * its own container (never the page) on small screens.
 */
function MatrixGrid({ payload, draft, editing, onToggle }: MatrixGridProps) {
  const { t } = useTranslation()
  const roles = payload.roles ?? []
  const grouped = useMemo(() => permsByCategory(payload.permissions ?? []), [payload.permissions])
  const orderedCategories = (payload.categories?.length
    ? payload.categories
    : Array.from(grouped.keys())
  ).filter((cat) => (grouped.get(cat)?.length ?? 0) > 0)

  // Dynamic column template: a wide permission column + one flexible,
  // min-sized column per role. Computed → an allowed inline style.
  const gridTemplateColumns = `minmax(11rem, 1.75fr) repeat(${roles.length}, minmax(4.75rem, 1fr))`

  if (roles.length === 0 || orderedCategories.length === 0) {
    return (
      // no-action: MatrixGrid has no onRetry — roles===0 is dead code (the
      // page guard above handles it); the catalog is hand-maintained, not stale.
      <EmptyState
        icon={<ShieldCheck className="h-8 w-8" aria-hidden="true" />}
        message={t('rbac.matrix.empty', 'No permissions to display for the current roles.')}
      />
    )
  }

  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5" data-testid="rbac-matrix-scroll">
      <div
        role="table"
        aria-label={t('rbac.matrix.aria', 'Role permission matrix')}
        data-testid="rbac-matrix-grid"
        className="grid min-w-full px-4 sm:px-5"
        style={{ gridTemplateColumns }}
      >
        <div role="rowgroup" className="contents">
          <div role="row" className="contents">
            <div
              role="columnheader"
              className="sticky left-0 z-[1] border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5"
            >
              <Text variant="label">{t('rbac.permissionColumn', 'Permission')}</Text>
            </div>
            {roles.map((role: RbacRole) => (
              <div
                key={role.id}
                role="columnheader"
                data-testid={`rbac-col-${role.id}`}
                className="flex items-center justify-center border-b border-[var(--border-subtle)] px-2 py-2.5 text-center"
              >
                <Text variant="label" className="truncate" title={role.name}>
                  {role.name}
                </Text>
              </div>
            ))}
          </div>
        </div>

        <div role="rowgroup" className="contents">
          {orderedCategories.map((cat) => {
            const items = grouped.get(cat) ?? []
            return (
              <Fragment key={`cat-${cat}`}>
                <div role="row" className="contents">
                  <div
                    role="cell"
                    data-testid={`rbac-category-row-${cat}`}
                    className="col-span-full border-b border-[var(--border-subtle)] bg-white/[0.02] px-3 py-1.5"
                  >
                    <Text variant="label" className="tracking-widest">
                      {t(`rbac.category.${cat}`, cat)}
                    </Text>
                  </div>
                </div>
                {items.map((perm) => (
                  <div
                    key={perm.id}
                    role="row"
                    data-testid={`rbac-row-${perm.id}`}
                    className="group/row contents"
                  >
                    <div
                      role="rowheader"
                      className="sticky left-0 z-[1] flex min-h-11 flex-col justify-center border-b border-[var(--border-subtle)]/60 bg-[var(--surface-2)] px-3 py-2.5 group-hover/row:bg-white/[0.03]"
                    >
                      <Text as="span" variant="body">
                        {perm.name}
                      </Text>
                      <Caption>{perm.id}</Caption>
                    </div>
                    {roles.map((role: RbacRole) => (
                      <div
                        key={role.id}
                        role="cell"
                        className="flex min-h-11 items-center justify-center border-b border-[var(--border-subtle)]/60 px-2 py-2 group-hover/row:bg-white/[0.03]"
                      >
                        <MatrixCell
                          roleID={role.id}
                          permID={perm.id}
                          allowed={draft.cells[role.id]?.[perm.id] ?? false}
                          editing={editing}
                          onToggle={onToggle}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** "N / M effective" chip summarising the caller's own merged grant map. */
function EffectivePill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation()
  const allowedCount = Object.values(payload.effective_for_me ?? {}).filter(Boolean).length
  const total = payload.permissions?.length ?? 0
  const variant = allowedCount === 0 ? 'neutral' : 'success'
  return (
    <Badge
      variant={variant}
      data-testid="rbac-effective-pill"
      title={t('rbac.effective.tooltip', 'Permissions effective for your current roles')}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      <span>
        {t('rbac.effective.count', '{{count}} / {{total}} effective', {
          count: allowedCount,
          total,
        })}
      </span>
    </Badge>
  )
}

/** Chip listing the roles the upstream proxy claimed for the caller. */
function MyRolesPill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation()
  const roles = payload.my_roles ?? []
  if (roles.length === 0) {
    return (
      <Badge variant="neutral" data-testid="rbac-my-roles-pill">
        <UserCircle className="h-3 w-3" aria-hidden="true" />
        {t('rbac.myRoles.none', 'No roles claimed')}
      </Badge>
    )
  }
  return (
    <Badge variant="info" data-testid="rbac-my-roles-pill">
      <UserCircle className="h-3 w-3" aria-hidden="true" />
      {t('rbac.myRoles.label', 'My roles: {{roles}}', { roles: roles.join(', ') })}
    </Badge>
  )
}

/** Full-width KPI band summarising the matrix at a glance. */
function KpiBand({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation()
  const roles = payload.roles ?? []
  const permissions = payload.permissions ?? []
  const categories = payload.categories?.length
    ? payload.categories
    : Array.from(permsByCategory(permissions).keys())
  const allowedForMe = Object.values(payload.effective_for_me ?? {}).filter(Boolean).length
  const myRoles = payload.my_roles ?? []
  const grants = countGrants(payload.matrix)

  return (
    <section
      aria-label={t('rbac.kpi.aria', 'Matrix summary metrics')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-6"
    >
      <MetricCard
        label={t('rbac.kpi.roles', 'Roles')}
        value={roles.length}
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('rbac.kpi.permissions', 'Permissions')}
        value={permissions.length}
        icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('rbac.kpi.categories', 'Categories')}
        value={categories.length}
        icon={<Layers className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('rbac.kpi.grants', 'Active grants')}
        value={grants}
        icon={<CheckCheck className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('rbac.kpi.myRoles', 'My roles')}
        value={myRoles.length}
        icon={<UserCircle className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('rbac.kpi.effective', 'Effective for me')}
        value={`${allowedForMe} / ${permissions.length}`}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
    </section>
  )
}

export default function RbacMatrixPage() {
  const { t } = useTranslation()
  usePageTitle(t('rbac.title', 'RBAC matrix'))

  const matrixQuery = useRbacMatrix()
  const upsert = useUpsertRbacCells()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MatrixDraft>({ cells: {} })
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Resync the draft whenever a fresh snapshot lands. Keeping this in an
  // effect (rather than deriving inline) means the operator's checkbox
  // toggles are not clobbered on every TanStack refetch unless they
  // explicitly cancel edit mode.
  useEffect(() => {
    if (!matrixQuery.data || isRbacOpenMode(matrixQuery.data)) return
    if (editing) return
    setDraft(snapshotToDraft(matrixQuery.data.matrix))
  }, [matrixQuery.data, editing])

  // Compute the dirty-cell count BEFORE any early returns so the useMemo
  // call order stays stable across renders (hooks rule). Payload may be
  // absent during loading / open-mode / error — fall back to an empty
  // matrix so the computation is a no-op rather than a conditional hook.
  const dirtyCount = useMemo(() => {
    const live = matrixQuery.data
    if (!live || isRbacOpenMode(live)) return 0
    return diffMatrices(live.matrix, draft.cells).length
  }, [matrixQuery.data, draft.cells])

  if (matrixQuery.isLoading) {
    return (
      <PageContainer
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <GlassPanel
          className="flex min-h-[240px] items-center justify-center p-6"
          data-testid="rbac-loading"
        >
          <Spinner size="lg" label={t('rbac.loading', 'Loading matrix…')} />
        </GlassPanel>
      </PageContainer>
    )
  }

  // AUTH_MODE_OPEN — render an inline placeholder explaining the
  // forward-auth requirement. Mirrors the TOTPEnrollmentSection /
  // ActiveSessionsSection convention.
  if (isRbacOpenMode(matrixQuery.data)) {
    return (
      <PageContainer
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <GlassPanel className="p-6" data-testid="rbac-open-mode">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                <Heading level="section">
                  {t('rbac.openMode.title', 'RBAC requires forward-auth mode')}
                </Heading>
              </div>
              <HelperText className="max-w-3xl">
                {t(
                  'rbac.openMode.message',
                  'The RBAC matrix is meaningful only when an upstream proxy (Authentik, Authelia, oauth2-proxy, Keycloak, etc.) injects an authenticated subject header. Configure FORWARD_AUTH_HEADER and TESLASYNC_RBAC_GROUPS_HEADER on the API service then reload.',
                )}
              </HelperText>
            </div>
          </GlassPanel>
        </FadeIn>
      </PageContainer>
    )
  }

  if (matrixQuery.isError || !matrixQuery.data) {
    return (
      <PageContainer
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5" data-testid="rbac-load-error">
            <PanelTitle className="mb-3">
              {t('rbac.errors.loadTitle', 'Failed to load RBAC matrix')}
            </PanelTitle>
            <QueryError error={matrixQuery.error} onRetry={() => matrixQuery.refetch()} />
          </GlassPanel>
        </FadeIn>
      </PageContainer>
    )
  }

  const payload = matrixQuery.data

  const handleToggle = (roleID: string, permID: string, next: boolean) => {
    setDraft((prev) => {
      const row = { ...(prev.cells[roleID] ?? {}) }
      row[permID] = next
      return { cells: { ...prev.cells, [roleID]: row } }
    })
  }

  const handleEnterEdit = () => {
    setSubmitError(null)
    setDraft(snapshotToDraft(payload.matrix))
    setEditing(true)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setDraft(snapshotToDraft(payload.matrix))
    setSubmitError(null)
  }

  const handleSave = async () => {
    setSubmitError(null)
    const cells = diffMatrices(payload.matrix, draft.cells)
    if (cells.length === 0) {
      setEditing(false)
      return
    }
    try {
      await upsert.mutateAsync(cells)
      setEditing(false)
    } catch (err) {
      const code = isApiError(err) ? err.code : undefined
      setSubmitError(
        code ?? t('rbac.errors.saveGeneric', 'The matrix endpoint rejected the update.'),
      )
    }
  }

  if ((payload.roles ?? []).length === 0) {
    return (
      <PageContainer
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5" data-testid="rbac-empty">
            {/* no-action: requires API env var change + restart. */}
            <EmptyState
              icon={<ShieldCheck className="h-8 w-8" aria-hidden="true" />}
              title={t('rbac.empty.title', 'No roles configured')}
              message={t(
                'rbac.empty.message',
                'No roles have been forwarded by the upstream proxy and no bindings exist in the database. Configure TESLASYNC_RBAC_GROUPS_HEADER on the API service and reload.',
              )}
            />
          </GlassPanel>
        </FadeIn>
      </PageContainer>
    )
  }

  const actions = editing ? (
    <div className="flex flex-wrap items-center gap-2">
      {dirtyCount > 0 && (
        <Badge variant="warning" data-testid="rbac-dirty-badge">
          {t('rbac.pending.count', '{{count}} pending', { count: dirtyCount })}
        </Badge>
      )}
      <Button
        variant="ghost"
        onClick={handleCancelEdit}
        disabled={upsert.isPending}
        data-testid="rbac-cancel-button"
      >
        {t('rbac.actions.cancel', 'Cancel')}
      </Button>
      <Button
        onClick={handleSave}
        disabled={upsert.isPending || dirtyCount === 0}
        data-testid="rbac-save-button"
      >
        <Lock className="h-4 w-4" aria-hidden="true" />
        {upsert.isPending
          ? t('rbac.actions.saving', 'Saving…')
          : t('rbac.actions.save', 'Save ({{count}})', { count: dirtyCount })}
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        onClick={() => matrixQuery.refetch()}
        disabled={matrixQuery.isFetching}
        aria-label={t('rbac.actions.refresh', 'Refresh')}
        title={t('rbac.actions.refresh', 'Refresh')}
      >
        <RefreshCw
          className={cn('h-4 w-4', matrixQuery.isFetching && 'animate-spin')}
          aria-hidden="true"
        />
      </Button>
      <Button variant="secondary" onClick={handleEnterEdit} data-testid="rbac-edit-button">
        <Unlock className="h-4 w-4" aria-hidden="true" />
        {t('rbac.actions.edit', 'Edit')}
      </Button>
    </div>
  )

  return (
    <PageContainer
      title={t('rbac.title', 'RBAC matrix')}
      subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      actions={actions}
      query={matrixQuery}
    >
      {submitError && (
        <AlertBanner variant="danger" data-testid="rbac-save-error">
          {submitError}
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <KpiBand payload={payload} />
      </FadeIn>

      {/* 2 — Access summary: caller context + legend + edit hint */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5" data-testid="rbac-summary">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
              <PanelTitle>{t('rbac.access.title', 'Your access')}</PanelTitle>
              <div className="flex flex-wrap items-center gap-2">
                <MyRolesPill payload={payload} />
                <EffectivePill payload={payload} />
                {payload.groups_header_name && (
                  <Caption data-testid="rbac-groups-header-name">
                    {t('rbac.groupsHeader.label', 'Groups header: {{name}}', {
                      name: payload.groups_header_name,
                    })}
                  </Caption>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/25 leading-none"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <Caption>{t('rbac.legend.allowed', 'Allowed')}</Caption>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-md leading-none text-[var(--text-muted)]"
                    aria-hidden="true"
                  >
                    –
                  </span>
                  <Caption>{t('rbac.legend.denied', 'Denied')}</Caption>
                </span>
              </div>
              <HelperText>
                {editing
                  ? t('rbac.legend.editHint', 'Toggle cells then Save to publish changes.')
                  : t('rbac.legend.readHint', 'Read-only view — choose Edit to change bindings.')}
              </HelperText>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* 3 — Matrix grid: full-width hero / detail band */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <PanelTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('rbac.matrix.title', 'Permission matrix')}
            </PanelTitle>
            {editing && (
              <Badge variant="warning">
                {t('rbac.matrix.editing', 'Editing')}
              </Badge>
            )}
          </div>
          <MatrixGrid
            payload={payload}
            draft={draft}
            editing={editing}
            onToggle={handleToggle}
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  )
}
