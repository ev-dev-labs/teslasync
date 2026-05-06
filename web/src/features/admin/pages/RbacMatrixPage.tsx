/**
 * RbacMatrixPage — Phase-46 / Prompt 44.
 *
 * Provider-agnostic "who can do what" admin page. Columns = roles
 * (resolved from the upstream proxy's groups header), rows =
 * permissions (hand-maintained catalog in internal/auth/permissions.go),
 * cells = check (allow) / dash (deny).
 *
 * Read-only by default. The "Edit" toggle flips cells into checkboxes;
 * "Save" diffs the draft against the snapshot and PUTs only the
 * changed cells. The PUT route is RequireSudo-gated upstream so the
 * SPA's reauth dialog will pop transparently on Save in forward-auth
 * mode — there is no preemptive sudo challenge when entering edit
 * mode, which would be a worse UX (the operator may toggle a few
 * cells and then change their mind without ever submitting).
 *
 * AUTH_MODE_OPEN: when forward-auth is not configured the matrix is
 * meaningless (one implicit subject, one implicit role). The page
 * renders an inline "configure forward-auth then reload" placeholder
 * instead of a 401/501 toast loop.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, ShieldCheck, Unlock } from 'lucide-react'

import { PageContainer, Stack } from '@/components/layout'
import { Badge, Button, GlassPanel } from '@/components/ui'
import { Heading, Text, Caption, HelperText } from '@/components/ui/Typography'
import { Spinner, EmptyState, AlertBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
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

interface MatrixGridProps {
  payload: RbacMatrixSessionResponse
  draft: MatrixDraft
  editing: boolean
  onToggle: (roleID: string, permID: string, next: boolean) => void
}

function MatrixGrid({ payload, draft, editing, onToggle }: MatrixGridProps) {
  const { t } = useTranslation()
  const grouped = useMemo(() => permsByCategory(payload.permissions), [payload.permissions])
  const orderedCategories = payload.categories.length
    ? payload.categories
    : Array.from(grouped.keys())

  const renderCell = (roleID: string, permID: string) => {
    const allowed = draft.cells[roleID]?.[permID] ?? false
    if (editing) {
      return (
        <input
          type="checkbox"
          checked={allowed}
          onChange={(e) => onToggle(roleID, permID, e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-[var(--border-subtle)] bg-transparent accent-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
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
        className={
          allowed
            ? 'inline-flex h-5 w-5 items-center justify-center text-emerald-300'
            : 'inline-flex h-5 w-5 items-center justify-center text-[var(--text-muted)]'
        }
        aria-label={
          allowed
            ? t('rbac.cell.allowed', 'Allowed')
            : t('rbac.cell.denied', 'Denied')
        }
        data-testid={`rbac-cell-${roleID}-${permID}`}
      >
        {allowed ? '✓' : '–'}
      </span>
    )
  }

  return (
    <div className="overflow-x-auto" data-testid="rbac-matrix-grid">
      <table className="min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[var(--bg-panel)]">
          <tr className="border-b border-[var(--border-subtle)]">
            <th
              scope="col"
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
              {t('rbac.permissionColumn', 'Permission')}
            </th>
            {payload.roles.map((role: RbacRole) => (
              <th
                key={role.id}
                scope="col"
                className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
                data-testid={`rbac-col-${role.id}`}
              >
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedCategories.map((cat) => {
            const items = grouped.get(cat) ?? []
            if (items.length === 0) return null
            return (
              <Fragment key={`cat-${cat}`}>
                <tr
                  className="bg-[var(--bg-app)]/40"
                  data-testid={`rbac-category-row-${cat}`}
                >
                  <th
                    colSpan={1 + payload.roles.length}
                    scope="colgroup"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]"
                  >
                    {t(`rbac.category.${cat}`, cat)}
                  </th>
                </tr>
                {items.map((perm) => (
                  <tr
                    key={perm.id}
                    className="border-b border-[var(--border-subtle)]/50"
                    data-testid={`rbac-row-${perm.id}`}
                  >
                    <th
                      scope="row"
                      className="px-3 py-2 text-sm font-normal text-[var(--text-primary)]"
                    >
                      <div className="flex flex-col">
                        <span>{perm.name}</span>
                        <Caption>{perm.id}</Caption>
                      </div>
                    </th>
                    {payload.roles.map((role: RbacRole) => (
                      <td key={role.id} className="px-3 py-2 text-center">
                        {renderCell(role.id, perm.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EffectivePill({
  payload,
}: {
  payload: RbacMatrixSessionResponse
}) {
  const { t } = useTranslation()
  const allowedCount = Object.values(payload.effective_for_me).filter(Boolean).length
  const total = payload.permissions.length
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

function MyRolesPill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const { t } = useTranslation()
  if (payload.my_roles.length === 0) {
    return (
      <Badge variant="neutral" data-testid="rbac-my-roles-pill">
        {t('rbac.myRoles.none', 'No roles claimed')}
      </Badge>
    )
  }
  return (
    <Badge variant="info" data-testid="rbac-my-roles-pill">
      {t('rbac.myRoles.label', 'My roles: {{roles}}', {
        roles: payload.my_roles.join(', '),
      })}
    </Badge>
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

  // Resync the draft whenever a fresh snapshot lands. Keeping this in
  // an effect (rather than deriving inline) means the operator's
  // checkbox toggles are not clobbered on every TanStack refetch
  // unless they explicitly cancel edit mode.
  useEffect(() => {
    if (!matrixQuery.data || isRbacOpenMode(matrixQuery.data)) return
    if (editing) return
    setDraft(snapshotToDraft(matrixQuery.data.matrix))
  }, [matrixQuery.data, editing])

  // Compute the dirty-cell count BEFORE any early returns so the
  // useMemo call order stays stable across renders (hooks rule).
  // Payload may be absent during loading / open-mode / error — fall
  // back to an empty matrix so the computation is a no-op rather than
  // a conditional hook.
  const dirtyCount = useMemo(() => {
    const live = matrixQuery.data
    if (!live || isRbacOpenMode(live)) return 0
    return diffMatrices(live.matrix, draft.cells).length
  }, [matrixQuery.data, draft.cells])

  if (matrixQuery.isLoading) {
    return (
      <PageContainer title={t('rbac.title', 'RBAC matrix')}>
        <div
          className="flex min-h-[200px] items-center justify-center"
          data-testid="rbac-loading"
        >
          <Spinner />
        </div>
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
            <Stack gap={3}>
              <Heading level="section">
                {t('rbac.openMode.title', 'RBAC requires forward-auth mode')}
              </Heading>
              <HelperText>
                {t(
                  'rbac.openMode.message',
                  'The RBAC matrix is meaningful only when an upstream proxy (Authentik, Authelia, oauth2-proxy, Keycloak, etc.) injects an authenticated subject header. Configure FORWARD_AUTH_HEADER and TESLASYNC_RBAC_GROUPS_HEADER on the API service then reload.',
                )}
              </HelperText>
            </Stack>
          </GlassPanel>
        </FadeIn>
      </PageContainer>
    )
  }

  if (matrixQuery.isError || !matrixQuery.data) {
    const code = isApiError(matrixQuery.error) ? matrixQuery.error.code : undefined
    return (
      <PageContainer title={t('rbac.title', 'RBAC matrix')}>
        <FadeIn>
          <AlertBanner variant="danger" data-testid="rbac-load-error">
            <Stack gap={2}>
              <Heading level="panel">
                {t('rbac.errors.loadTitle', 'Failed to load RBAC matrix')}
              </Heading>
              <Text>
                {code ?? t('rbac.errors.loadGeneric', 'The matrix endpoint returned an error.')}
              </Text>
              <Button onClick={() => matrixQuery.refetch()}>
                {t('rbac.actions.retry', 'Retry')}
              </Button>
            </Stack>
          </AlertBanner>
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

  if (payload.roles.length === 0) {
    return (
      <PageContainer
        title={t('rbac.title', 'RBAC matrix')}
        subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
      >
        <FadeIn>
          <div data-testid="rbac-empty">
            {/* no-action: requires API env var change + restart. */}
            <EmptyState
              icon={<ShieldCheck className="h-8 w-8" />}
              title={t('rbac.empty.title', 'No roles configured')}
              message={t(
                'rbac.empty.message',
                'No roles have been forwarded by the upstream proxy and no bindings exist in the database. Configure TESLASYNC_RBAC_GROUPS_HEADER on the API service and reload.',
              )}
            />
          </div>
        </FadeIn>
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={t('rbac.title', 'RBAC matrix')}
      subtitle={t('rbac.subtitle', 'Provider-agnostic role-permission bindings')}
    >
      <FadeIn>
        <Stack gap={4}>
          <GlassPanel className="p-4" data-testid="rbac-summary">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
              <div className="flex items-center gap-2">
                {!editing ? (
                  <Button
                    variant="secondary"
                    onClick={handleEnterEdit}
                    data-testid="rbac-edit-button"
                  >
                    <Unlock className="h-4 w-4" aria-hidden="true" />
                    {t('rbac.actions.edit', 'Edit')}
                  </Button>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </GlassPanel>

          {submitError && (
            <AlertBanner variant="danger" data-testid="rbac-save-error">
              <Text>{submitError}</Text>
            </AlertBanner>
          )}

          <GlassPanel className="p-0">
            <MatrixGrid
              payload={payload}
              draft={draft}
              editing={editing}
              onToggle={handleToggle}
            />
          </GlassPanel>
        </Stack>
      </FadeIn>
    </PageContainer>
  )
}
