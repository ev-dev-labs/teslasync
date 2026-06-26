// Native parity port of web/src/features/admin/pages/RbacMatrixPage.tsx.
//
// The web source is the admin "RBAC matrix" page: a provider-agnostic
// "who can do what" grid whose columns are roles (resolved from the upstream
// proxy's groups header) and whose rows are permissions (grouped by category).
// Each cell is a check (allow) / dash (deny) in read mode, and a checkbox in
// edit mode. An "Edit" toggle flips the cells into checkboxes; "Save" diffs the
// draft against the snapshot and PUTs only the changed cells (the PUT route is
// RequireSudo-gated upstream, so the reauth dialog pops on Save). When
// forward-auth is not configured (AUTH_MODE_OPEN) the matrix is meaningless and
// the page renders an inline "configure forward-auth then reload" placeholder
// instead of a 401 toast loop. It is driven by `useRbacMatrix`
// (GET /admin/rbac/matrix) + `useUpsertRbacCells` (PUT /admin/rbac/matrix), with
// the snapshot/draft diffing done by `diffMatrices` and the open-mode narrowing
// by `isRbacOpenMode` — all reused verbatim from the existing native
// api/hooks/useRbacMatrix port (identical types + endpoints the web imported).
//
// Mirroring the sibling admin parity ports (ApiLogsPage / FeedbackQueuePage
// inline their PageContainer / Badge / Button / Select chrome on RN primitives),
// this self-contained port rebuilds each DOM/web-only piece with React Native
// primitives + the existing native tokens/components:
//   * `<PageContainer title subtitle>` -> an inline `PageContainerView` (a
//     `ScrollView` with a title/subtitle header, then the page body stack).
//   * `<Stack gap={n}>` -> an inline `Stack` (a column `View` whose gap is the
//     Tailwind `gap-{n}` pixel value, n*4).
//   * `<GlassPanel className="p-4|p-6|p-0">` -> the shared native `GlassPanel`
//     with the matching padding style.
//   * `<Heading level>` / `<Text>` / `<Caption>` / `<HelperText>` (Typography) ->
//     inline `Heading` / `BodyText` / `Caption` / `HelperText` on `AppText`.
//   * `<Badge variant>` (neutral/info/success) -> an inline `Badge` pill using
//     the matching token surfaces — the same approach as the sibling ports.
//   * `<Button>` (secondary / ghost / primary) -> an inline `ActionButton`
//     (Pressable) with an optional leading icon slot.
//   * `<Spinner>` -> RN `ActivityIndicator`.
//   * `<EmptyState icon title message>` -> the shared native `EmptyState`
//     (title + message) beneath a `securityCheck` `SemanticIcon`, preserving the
//     web ShieldCheck icon.
//   * `<AlertBanner variant="danger">` -> an inline `DangerBanner` (rose
//     translucent bordered notice with an alert icon, matching the sibling ports).
//   * `<FadeIn>` (framer-motion) -> a passthrough `View`; the web entrance
//     animation carries no behavioural contract.
//   * The lucide-react glyphs (Lock, ShieldCheck, Unlock) map to the nearest repo
//     `SemanticIcon` names (`locked`, `securityCheck`, `unlocked`); no lucide /
//     DOM import. The decorative 12px ShieldCheck inside the small EffectivePill
//     is rendered as text-only (the native SemanticIcon is a boxed glyph not
//     suited to a tiny in-pill mark); the shield intent is preserved via the
//     EmptyState icon — documented native-safe adaptation.
//   * The DOM `<table>/<thead>/<tbody>/<tr>/<th>/<td>` matrix -> a
//     horizontally-scrollable column grid (`<ScrollView horizontal>` wrapping a
//     header row + per-category header rows + per-permission rows of fixed-width
//     role cells), preserving the web `overflow-x-auto` (the permission column
//     scrolls with the roles). The sticky `position` of the header is dropped
//     (no native analogue) — documented.
//   * The DOM `<input type="checkbox">` cell -> a Pressable checkbox toggle
//     (accessibilityRole="checkbox", accessibilityState.checked), and the read
//     cell's `✓` / `–` glyph is preserved verbatim.
//   * `usePageTitle` -> a no-op `useNativePageTitle` (no `document.title`).
//   * Every `data-testid` is preserved as a native `testID`.
//   * react-i18next `useTranslation` -> a self-contained
//     `useNativeTranslationFallback` returning each English fallback and
//     reproducing i18next `{{var}}` interpolation (used by rbac.cell.toggle,
//     rbac.effective.count, rbac.myRoles.label, rbac.groupsHeader.label,
//     rbac.actions.save, and the dynamic rbac.category.{cat} key).
//
// The native request() port keeps snake_case keys, so every
// `payload.effective_for_me` / `payload.my_roles` / `payload.groups_header_name`
// / `role.id` / `role.name` / `perm.id` / `perm.name` / `perm.category` access
// reads identically to the web source.
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-router, no
// framer-motion, and no web UI components are imported.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { EmptyState } from '../../../../components/feedback/EmptyState';
import { colors, spacing } from '../../../../theme/tokens';
import { isApiError } from '../../../api/client';
import {
  diffMatrices,
  isRbacOpenMode,
  useRbacMatrix,
  useUpsertRbacCells,
  type RbacMatrixSessionResponse,
  type RbacPermission,
  type RbacRole,
} from '../../../api/hooks/useRbacMatrix';

/* ------------------------------------------------------------------ */
/*  i18n + native-safe helpers                                         */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web page read `t` from react-i18next. Native parity has no i18n runtime
// wired yet, so this returns the English fallback string and reproduces
// i18next's `{{name}}` interpolation, preserving every key + fallback.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// Native no-op for the web `usePageTitle` (which set `document.title`). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

/* ------------------------------------------------------------------ */
/*  Draft model (ported verbatim from the web source)                  */
/* ------------------------------------------------------------------ */

interface MatrixDraft {
  // [role_id][perm_id] → allowed. Mirrors the server shape so diffing
  // against the snapshot stays straightforward.
  cells: Record<string, Record<string, boolean>>;
}

function snapshotToDraft(
  matrix: Record<string, Record<string, boolean>>,
): MatrixDraft {
  const cells: Record<string, Record<string, boolean>> = {};
  for (const [roleID, row] of Object.entries(matrix)) {
    cells[roleID] = { ...row };
  }
  return { cells };
}

function permsByCategory(
  permissions: RbacPermission[],
): Map<string, RbacPermission[]> {
  const out = new Map<string, RbacPermission[]>();
  for (const p of permissions) {
    const bucket = out.get(p.category) ?? [];
    bucket.push(p);
    out.set(p.category, bucket);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Inline native chrome                                               */
/* ------------------------------------------------------------------ */

const PERM_COL_W = 200;
const ROLE_COL_W = 96;

// FadeIn: web framer-motion entrance wrapper. The animation carries no
// behavioural contract, so this preserves the wrapper structurally.
function FadeIn({ children }: { children: ReactNode }) {
  return <View>{children}</View>;
}

// Native parity for the web <Stack gap={n}>: a column View whose gap is the
// Tailwind gap-{n} pixel value (n * 4).
function Stack({ gap = 2, children }: { gap?: number; children: ReactNode }) {
  return <View style={stackGapStyle(gap)}>{children}</View>;
}

function stackGapStyle(gap: number) {
  if (gap >= 4) {
    return styles.stackG4;
  }
  if (gap === 3) {
    return styles.stackG3;
  }
  return styles.stackG2;
}

// Native parity for the web <PageContainer title subtitle>: a scrollable page
// with a title (+ optional subtitle) header, then the body stack.
function PageContainerView({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}
    >
      <View style={styles.pageHeader}>
        <AppText variant="display" weight="bold">
          {title}
        </AppText>
        {subtitle ? <AppText tone="secondary">{subtitle}</AppText> : null}
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

// Native parity for the Typography <Heading level>.
function Heading({
  level,
  children,
}: {
  level: 'section' | 'panel';
  children: ReactNode;
}) {
  return (
    <AppText variant={level === 'section' ? 'title' : 'body'} weight="bold">
      {children}
    </AppText>
  );
}

// Native parity for the Typography <Text>.
function BodyText({ children }: { children: ReactNode }) {
  return <AppText>{children}</AppText>;
}

// Native parity for the Typography <Caption>.
function Caption({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  return (
    <AppText testID={testID} tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

// Native parity for the Typography <HelperText>.
function HelperText({ children }: { children: ReactNode }) {
  return (
    <AppText tone="secondary" variant="caption">
      {children}
    </AppText>
  );
}

type BadgeVariant = 'neutral' | 'info' | 'success';

// Native parity for the shared web Badge.
function Badge({
  variant = 'neutral',
  children,
  testID,
  accessibilityLabel,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.badge, badgeToneStyles[variant]]}
      testID={testID}
    >
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

// Native parity for the web <Button> (secondary / ghost / primary).
function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  leading,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  leading?: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
      testID={testID}
    >
      {leading ?? null}
      <AppText
        style={
          variant === 'primary' ? styles.btnPrimaryText : styles.btnGhostText
        }
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the web <AlertBanner variant="danger">: a rose translucent
// bordered notice with a leading alert icon.
function DangerBanner({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.dangerBanner} testID={testID}>
      <SemanticIcon
        decorative
        name="alertCircle"
        size="sm"
        style={styles.dangerIcon}
      />
      <View style={styles.dangerBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Matrix grid + summary pills                                        */
/* ------------------------------------------------------------------ */

interface MatrixGridProps {
  payload: RbacMatrixSessionResponse;
  draft: MatrixDraft;
  editing: boolean;
  onToggle: (roleID: string, permID: string, next: boolean) => void;
}

function MatrixGrid({ payload, draft, editing, onToggle }: MatrixGridProps) {
  const t = useNativeTranslationFallback();
  const grouped = useMemo(
    () => permsByCategory(payload.permissions),
    [payload.permissions],
  );
  const orderedCategories = payload.categories.length
    ? payload.categories
    : Array.from(grouped.keys());

  const renderCell = (roleID: string, permID: string) => {
    const allowed = draft.cells[roleID]?.[permID] ?? false;
    if (editing) {
      return (
        <Pressable
          accessibilityLabel={t(
            'rbac.cell.toggle',
            'Toggle {{role}} / {{perm}}',
            {
              role: roleID,
              perm: permID,
            },
          )}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allowed }}
          onPress={() => onToggle(roleID, permID, !allowed)}
          style={({ pressed }) => [
            styles.checkbox,
            allowed && styles.checkboxChecked,
            pressed && styles.checkboxPressed,
          ]}
          testID={`rbac-cell-edit-${roleID}-${permID}`}
        >
          {allowed ? (
            <AppText style={styles.checkboxGlyph} weight="bold">
              ✓
            </AppText>
          ) : null}
        </Pressable>
      );
    }
    return (
      <View
        accessible
        accessibilityLabel={
          allowed
            ? t('rbac.cell.allowed', 'Allowed')
            : t('rbac.cell.denied', 'Denied')
        }
        testID={`rbac-cell-${roleID}-${permID}`}
      >
        <AppText style={allowed ? styles.cellAllow : styles.cellDeny}>
          {allowed ? '✓' : '–'}
        </AppText>
      </View>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      testID="rbac-matrix-grid"
    >
      <View>
        <View style={styles.matrixHeaderRow}>
          <View style={styles.permHeaderCell}>
            <AppText
              style={styles.uppercase}
              tone="muted"
              variant="caption"
              weight="semibold"
            >
              {t('rbac.permissionColumn', 'Permission')}
            </AppText>
          </View>
          {payload.roles.map((role: RbacRole) => (
            <View
              key={role.id}
              style={styles.roleHeaderCell}
              testID={`rbac-col-${role.id}`}
            >
              <AppText
                numberOfLines={2}
                style={[styles.uppercase, styles.center]}
                tone="secondary"
                variant="caption"
                weight="semibold"
              >
                {role.name}
              </AppText>
            </View>
          ))}
        </View>
        {orderedCategories.map(cat => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) {
            return null;
          }
          return (
            <Fragment key={`cat-${cat}`}>
              <View
                style={styles.categoryRow}
                testID={`rbac-category-row-${cat}`}
              >
                <AppText
                  style={styles.uppercaseWide}
                  tone="muted"
                  variant="caption"
                  weight="semibold"
                >
                  {t(`rbac.category.${cat}`, cat)}
                </AppText>
              </View>
              {items.map(perm => (
                <View
                  key={perm.id}
                  style={styles.permRow}
                  testID={`rbac-row-${perm.id}`}
                >
                  <View style={styles.permCell}>
                    <AppText>{perm.name}</AppText>
                    <Caption>{perm.id}</Caption>
                  </View>
                  {payload.roles.map((role: RbacRole) => (
                    <View key={role.id} style={styles.roleCell}>
                      {renderCell(role.id, perm.id)}
                    </View>
                  ))}
                </View>
              ))}
            </Fragment>
          );
        })}
      </View>
    </ScrollView>
  );
}

function EffectivePill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const t = useNativeTranslationFallback();
  const allowedCount = Object.values(payload.effective_for_me).filter(
    Boolean,
  ).length;
  const total = payload.permissions.length;
  const variant: BadgeVariant = allowedCount === 0 ? 'neutral' : 'success';
  return (
    <Badge
      accessibilityLabel={t(
        'rbac.effective.tooltip',
        'Permissions effective for your current roles',
      )}
      testID="rbac-effective-pill"
      variant={variant}
    >
      {t('rbac.effective.count', '{{count}} / {{total}} effective', {
        count: allowedCount,
        total,
      })}
    </Badge>
  );
}

function MyRolesPill({ payload }: { payload: RbacMatrixSessionResponse }) {
  const t = useNativeTranslationFallback();
  if (payload.my_roles.length === 0) {
    return (
      <Badge testID="rbac-my-roles-pill" variant="neutral">
        {t('rbac.myRoles.none', 'No roles claimed')}
      </Badge>
    );
  }
  return (
    <Badge testID="rbac-my-roles-pill" variant="info">
      {t('rbac.myRoles.label', 'My roles: {{roles}}', {
        roles: payload.my_roles.join(', '),
      })}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function RbacMatrixPage() {
  const t = useNativeTranslationFallback();
  useNativePageTitle(t('rbac.title', 'RBAC matrix'));

  const matrixQuery = useRbacMatrix();
  const upsert = useUpsertRbacCells();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MatrixDraft>({ cells: {} });
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Resync the draft whenever a fresh snapshot lands. Keeping this in an effect
  // (rather than deriving inline) means the operator's checkbox toggles are not
  // clobbered on every TanStack refetch unless they explicitly cancel edit mode.
  useEffect(() => {
    if (!matrixQuery.data || isRbacOpenMode(matrixQuery.data)) {
      return;
    }
    if (editing) {
      return;
    }
    setDraft(snapshotToDraft(matrixQuery.data.matrix));
  }, [matrixQuery.data, editing]);

  // Compute the dirty-cell count BEFORE any early returns so the useMemo call
  // order stays stable across renders (hooks rule). Payload may be absent during
  // loading / open-mode / error — fall back to an empty matrix so the
  // computation is a no-op rather than a conditional hook.
  const dirtyCount = useMemo(() => {
    const live = matrixQuery.data;
    if (!live || isRbacOpenMode(live)) {
      return 0;
    }
    return diffMatrices(live.matrix, draft.cells).length;
  }, [matrixQuery.data, draft.cells]);

  if (matrixQuery.isLoading) {
    return (
      <PageContainerView title={t('rbac.title', 'RBAC matrix')}>
        <View style={styles.loadingBlock} testID="rbac-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      </PageContainerView>
    );
  }

  // AUTH_MODE_OPEN — render an inline placeholder explaining the forward-auth
  // requirement. Mirrors the TOTPEnrollmentSection / ActiveSessionsSection
  // convention.
  if (isRbacOpenMode(matrixQuery.data)) {
    return (
      <PageContainerView
        subtitle={t(
          'rbac.subtitle',
          'Provider-agnostic role-permission bindings',
        )}
        title={t('rbac.title', 'RBAC matrix')}
      >
        <FadeIn>
          <GlassPanel style={styles.panelP6} testID="rbac-open-mode">
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
      </PageContainerView>
    );
  }

  if (matrixQuery.isError || !matrixQuery.data) {
    const code = isApiError(matrixQuery.error)
      ? matrixQuery.error.code
      : undefined;
    return (
      <PageContainerView title={t('rbac.title', 'RBAC matrix')}>
        <FadeIn>
          <DangerBanner testID="rbac-load-error">
            <Stack gap={2}>
              <Heading level="panel">
                {t('rbac.errors.loadTitle', 'Failed to load RBAC matrix')}
              </Heading>
              <BodyText>
                {code ??
                  t(
                    'rbac.errors.loadGeneric',
                    'The matrix endpoint returned an error.',
                  )}
              </BodyText>
              <ActionButton
                label={t('rbac.actions.retry', 'Retry')}
                onPress={() => {
                  void matrixQuery.refetch();
                }}
              />
            </Stack>
          </DangerBanner>
        </FadeIn>
      </PageContainerView>
    );
  }

  const payload = matrixQuery.data;

  const handleToggle = (roleID: string, permID: string, next: boolean) => {
    setDraft(prev => {
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
      setSubmitError(
        code ??
          t(
            'rbac.errors.saveGeneric',
            'The matrix endpoint rejected the update.',
          ),
      );
    }
  };

  if (payload.roles.length === 0) {
    return (
      <PageContainerView
        subtitle={t(
          'rbac.subtitle',
          'Provider-agnostic role-permission bindings',
        )}
        title={t('rbac.title', 'RBAC matrix')}
      >
        <FadeIn>
          {/* no-action: requires API env var change + restart. */}
          <View style={styles.emptyWrap} testID="rbac-empty">
            <SemanticIcon decorative name="securityCheck" size="lg" />
            <EmptyState
              message={t(
                'rbac.empty.message',
                'No roles have been forwarded by the upstream proxy and no bindings exist in the database. Configure TESLASYNC_RBAC_GROUPS_HEADER on the API service and reload.',
              )}
              title={t('rbac.empty.title', 'No roles configured')}
            />
          </View>
        </FadeIn>
      </PageContainerView>
    );
  }

  return (
    <PageContainerView
      subtitle={t(
        'rbac.subtitle',
        'Provider-agnostic role-permission bindings',
      )}
      title={t('rbac.title', 'RBAC matrix')}
    >
      <FadeIn>
        <Stack gap={4}>
          <GlassPanel style={styles.panelP4} testID="rbac-summary">
            <View style={styles.summaryRow}>
              <View style={styles.summaryPills}>
                <MyRolesPill payload={payload} />
                <EffectivePill payload={payload} />
                {payload.groups_header_name ? (
                  <Caption testID="rbac-groups-header-name">
                    {t('rbac.groupsHeader.label', 'Groups header: {{name}}', {
                      name: payload.groups_header_name,
                    })}
                  </Caption>
                ) : null}
              </View>
              <View style={styles.summaryActions}>
                {!editing ? (
                  <ActionButton
                    label={t('rbac.actions.edit', 'Edit')}
                    leading={
                      <SemanticIcon decorative name="unlocked" size="sm" />
                    }
                    onPress={handleEnterEdit}
                    testID="rbac-edit-button"
                    variant="secondary"
                  />
                ) : (
                  <>
                    <ActionButton
                      disabled={upsert.isPending}
                      label={t('rbac.actions.cancel', 'Cancel')}
                      onPress={handleCancelEdit}
                      testID="rbac-cancel-button"
                      variant="ghost"
                    />
                    <ActionButton
                      disabled={upsert.isPending || dirtyCount === 0}
                      label={
                        upsert.isPending
                          ? t('rbac.actions.saving', 'Saving…')
                          : t('rbac.actions.save', 'Save ({{count}})', {
                              count: dirtyCount,
                            })
                      }
                      leading={
                        <SemanticIcon decorative name="locked" size="sm" />
                      }
                      onPress={() => {
                        void handleSave();
                      }}
                      testID="rbac-save-button"
                      variant="primary"
                    />
                  </>
                )}
              </View>
            </View>
          </GlassPanel>

          {submitError ? (
            <DangerBanner testID="rbac-save-error">
              <BodyText>{submitError}</BodyText>
            </DangerBanner>
          ) : null}

          <GlassPanel style={styles.panelP0}>
            <MatrixGrid
              draft={draft}
              editing={editing}
              onToggle={handleToggle}
              payload={payload}
            />
          </GlassPanel>
        </Stack>
      </FadeIn>
    </PageContainerView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  // Page container
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageBody: {
    gap: spacing.lg,
  },

  // Stack gaps (Tailwind gap-{n} = n * 4 px)
  stackG2: {
    gap: 8,
  },
  stackG3: {
    gap: 12,
  },
  stackG4: {
    gap: 16,
  },

  // Glass panel padding variants
  panelP4: {
    padding: 16,
  },
  panelP6: {
    padding: 24,
  },
  panelP0: {
    padding: 0,
  },

  // Loading / empty
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },

  // Summary row
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  summaryPills: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Badge
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },

  // Buttons
  btn: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  btnGhost: {
    borderColor: colors.border,
    borderWidth: 1,
  },
  btnSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnDisabled: {
    opacity: 0.48,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnGhostText: {
    color: colors.textPrimary,
  },
  btnPrimaryText: {
    color: colors.background,
  },

  // Danger banner
  dangerBanner: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dangerIcon: {
    marginTop: 2,
  },
  dangerBody: {
    flex: 1,
    gap: spacing.sm,
  },

  // Matrix grid
  matrixHeaderRow: {
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  permHeaderCell: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: PERM_COL_W,
  },
  roleHeaderCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    width: ROLE_COL_W,
  },
  categoryRow: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  permRow: {
    alignItems: 'stretch',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  permCell: {
    gap: 2,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: PERM_COL_W,
  },
  roleCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    width: ROLE_COL_W,
  },
  center: {
    textAlign: 'center',
  },
  uppercase: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  uppercaseWide: {
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cellAllow: {
    color: colors.success,
    fontSize: 16,
  },
  cellDeny: {
    color: colors.textMuted,
    fontSize: 16,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  checkboxPressed: {
    opacity: 0.7,
  },
  checkboxGlyph: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 16,
  },
});

const badgeToneStyles = StyleSheet.create({
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  neutral: {
    color: colors.textSecondary,
  },
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
});
