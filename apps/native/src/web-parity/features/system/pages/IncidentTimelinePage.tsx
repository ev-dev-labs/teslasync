// Native parity port of web/src/features/system/pages/IncidentTimelinePage.tsx.
//
// The web source is the per-incident post-mortem page at
// /system-status/incidents/:id. It renders, in order: a header GlassPanel
// (severity icon + status/severity/source badges + an open/resolved duration
// badge + description + affected-components line + a started/resolved timestamp
// line + a Resolve CTA when not yet resolved), the AIIncidentTimelineSummarizer
// (a gated AI section positioned AFTER the header and BEFORE the deterministic
// list), a Timeline GlassPanel (the full updates list, newest first), an
// append-update form GlassPanel (a Textarea + a status Select + an "Add update"
// submit, hidden once the incident is resolved), and a ConfirmDialog gating the
// Resolve action. It is driven by useIncident / useAppendIncidentUpdate /
// usePatchIncident from @/api/hooks/useIncidents. The page deliberately never
// deletes; resolving is the canonical close-out.
//
// This is a SELF-CONTAINED native port: the shared web chrome (PageContainer /
// GlassPanel / Button / Badge / Textarea / Select / ConfirmDialog / Toast) is
// rebuilt inline with React Native primitives + the existing native
// tokens/components — mirroring the sibling system/admin page ports (ChatbotPage,
// ApiLogsPage, AlertStudioPage). Already-ported native pieces are reused:
// GlassPanel, AppText, SemanticIcon, the design tokens, the useIncidents
// TanStack hooks (+ the IncidentSeverity / IncidentStatus types), and the
// already-ported AIIncidentTimelineSummarizer (itself withAiFeature-gated, so it
// renders null when the AI feature is off, exactly like the web wrapper).
//
// Native-safe adaptations (each documented in the parity sidecar):
//   * react-router useParams<{ id }> -> an optional `id` prop (the host wires the
//     route param); useNavigate -> an optional `onNavigate?(to)` callback; the
//     <Link to="/system-status"> back affordance -> a Pressable calling
//     onNavigate (the Explore/QuickStats/Settings port convention). No
//     react-router import.
//   * <PageContainer title subtitle actions> -> an inline PageContainerView (a
//     ScrollView with a title/subtitle header + an actions slot, then the body).
//   * useToast (a transient 4s popup) -> useNativeToast: an in-memory toast with
//     the same { success, error } surface, auto-dismissing after 4s and surfaced
//     as an inline accessible banner (accessibilityRole="alert") so the feedback
//     intent is preserved with native primitives rather than silently dropped.
//   * useDateFormat().formatDateTime -> useNativeDateFormat().formatDateTime, an
//     Intl toLocaleString('en-US', { year, month, day, hour:2-digit,
//     minute:2-digit }) matching the web @/lib/dateFormat formatDateTime
//     ("Jun 26, 2026, 9:42 AM"); '—' for null/invalid. The user tz/locale
//     binding has no native settings surface here; the device locale/zone is
//     used.
//   * <Textarea rows maxLength required> -> a multiline RN TextInput
//     (rows -> numberOfLines, maxLength + placeholder preserved; the `required`
//     contract stays in handleAppend, which toasts when the message is blank).
//   * <Select options> -> an inline SelectField (a field trigger that opens a RN
//     Modal option list), the native analogue of an HTML <select>.
//   * <Badge variant> / <Button variant size> -> inline Badge / Button built on
//     the token surfaces (same approach as the ApiLogsPage / AlertStudioPage
//     ports); the Button's `loading` prop shows an ActivityIndicator.
//   * <ConfirmDialog> -> an inline ConfirmDialog on the native Modal, preserving
//     open / onConfirm / onCancel / title / message / confirmLabel / cancelLabel
//     / loading.
//   * The lucide-react glyphs (ArrowLeft, AlertCircle, AlertTriangle,
//     AlertOctagon, CheckCircle2, Clock, MessageSquare) map to the nearest repo
//     SemanticIcon names (back, alertCircle, warning, severityCritical, confirm,
//     clock, history). cn (clsx) -> StyleSheet arrays.
//
// fmtDuration is ported verbatim (pure Date math). All state names (message,
// nextStatus, confirmResolve), the API field reads (snake_case started_at /
// resolved_at / affected_components / updates[].at/status/message/author), the
// handler logic (handleAppend / handleResolve), and the i18n English copy are
// preserved. No DOM, no lucide-react, no Recharts/Leaflet, no react-router, and
// no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useAppendIncidentUpdate,
  useIncident,
  usePatchIncident,
  type IncidentSeverity,
  type IncidentStatus,
} from '../../../api/hooks/useIncidents';
import {AIIncidentTimelineSummarizer} from '../../../components/ai/AIIncidentTimelineSummarizer';

/* ------------------------------------------------------------------ */
/*  Constants (web SEVERITY_TONE / STATUS_BADGE / STATUS_LABEL)        */
/* ------------------------------------------------------------------ */

// web SEVERITY_TONE { Icon, cls }: the lucide icon + a text colour. The lucide
// glyphs map to SemanticIcon names; the Tailwind text-* colours map to the
// matching toned-down hexes (amber-300 / orange-300 / red-400) used for the
// severity label.
const SEVERITY_TONE: Record<
  IncidentSeverity,
  {icon: SemanticIconName; color: string}
> = {
  minor: {icon: 'alertCircle', color: '#fcd34d'},
  major: {icon: 'warning', color: '#fdba74'},
  critical: {icon: 'severityCritical', color: '#f87171'},
};

type BadgeVariant = 'info' | 'warning' | 'neutral' | 'success' | 'danger';

const STATUS_BADGE: Record<IncidentStatus, BadgeVariant> = {
  investigating: 'danger',
  identified: 'warning',
  monitoring: 'info',
  resolved: 'success',
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                        */
/* ------------------------------------------------------------------ */

// Ported verbatim from the web source (pure Date math, no DOM).
function fmtDuration(startIso: string, endIso?: string): string {
  const s = Date.parse(startIso);
  const e = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return '';
  }
  const secs = Math.max(0, Math.floor((e - s) / 1000));
  if (secs < 60) {
    return `${secs}s`;
  }
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m`;
  }
  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

// @/hooks/useDateFormat().formatDateTime parity: matches @/lib/dateFormat
// formatDateTime ("Jun 26, 2026, 9:42 AM"), '—' for null/invalid.
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  try {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

function useNativeDateFormat(): {
  formatDateTime: (value: string | null | undefined) => string;
} {
  const fmt = useCallback(
    (value: string | null | undefined) => formatDateTime(value),
    [],
  );
  return {formatDateTime: fmt};
}

/* ------------------------------------------------------------------ */
/*  useToast parity                                                    */
/* ------------------------------------------------------------------ */

type ToastKind = 'success' | 'error';

interface ActiveToast {
  kind: ToastKind;
  message: string;
}

// @/components/feedback/Toast useToast parity: a transient toast that
// auto-dismisses after 4s (matching the web Toast lifetime) and exposes the same
// { success, error } surface the page calls. Surfaced as an inline banner.
function useNativeToast(): {
  toast: {success: (m: string) => void; error: (m: string) => void};
  toastBanner: ReactNode;
} {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((kind: ToastKind, message: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setActive({kind, message});
    timerRef.current = setTimeout(() => setActive(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const toast = useMemo(
    () => ({
      success: (m: string) => show('success', m),
      error: (m: string) => show('error', m),
    }),
    [show],
  );

  const toastBanner = active ? (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        s.toast,
        active.kind === 'error' ? s.toastError : s.toastSuccess,
      ]}>
      <SemanticIcon
        decorative
        name={active.kind === 'error' ? 'error' : 'success'}
        size="sm"
      />
      <AppText style={s.toastText}>{active.message}</AppText>
    </View>
  ) : null;

  return {toast, toastBanner};
}

/* ------------------------------------------------------------------ */
/*  Native UI primitives (web @/components/* parity)                   */
/* ------------------------------------------------------------------ */

const badgeColors: Record<
  BadgeVariant,
  {surface: string; border: string; fg: string}
> = {
  info: {surface: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  warning: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  neutral: {
    surface: colors.surfaceRaised,
    border: colors.border,
    fg: colors.textSecondary,
  },
  success: {
    surface: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  danger: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
  },
};

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  const c = badgeColors[variant];
  return (
    <View style={[s.badge, {backgroundColor: c.surface, borderColor: c.border}]}>
      {typeof children === 'string' ? (
        <AppText style={[s.badgeText, {color: c.fg}]} weight="semibold">
          {children}
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: SemanticIconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{disabled: !!isDisabled, busy: !!loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        s.btn,
        size === 'sm' ? s.btnSm : s.btnMd,
        variant === 'ghost' ? s.btnGhost : s.btnPrimary,
        isDisabled && s.btnDisabled,
        pressed && !isDisabled && s.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'ghost' ? colors.textPrimary : colors.background}
          size="small"
        />
      ) : (
        <>
          {icon ? <SemanticIcon decorative name={icon} size="sm" /> : null}
          <AppText
            style={[
              s.btnText,
              size === 'sm' && s.btnTextSm,
              variant === 'ghost' ? s.btnTextGhost : s.btnTextPrimary,
            ]}
            weight="semibold">
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

// web @/components/ui <Select>: a field-styled trigger opening a Modal option
// list. Picking one fires onChange and closes the sheet.
function SelectField({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected =
    options.find(o => o.value === value) ??
    options[0] ?? {value: '', label: ''};
  return (
    <View style={s.selectWrap}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({pressed}) => [s.field, pressed && s.fieldPressed]}>
        <AppText numberOfLines={1} style={s.fieldText}>
          {selected.label}
        </AppText>
        <SemanticIcon decorative name="expand" size="sm" />
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={s.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={s.modalSheet}>
            <ScrollView>
              {options.map(o => {
                const activeOpt = o.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{selected: activeOpt}}
                    key={o.value || '__keep__'}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      s.optionRow,
                      activeOpt && s.optionRowActive,
                      pressed && s.optionRowPressed,
                    ]}>
                    <AppText
                      style={activeOpt ? s.optionTextActive : s.optionText}>
                      {o.label}
                    </AppText>
                    {activeOpt ? (
                      <SemanticIcon decorative name="confirm" size="sm" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function PageContainerView({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      style={s.pageRoot}>
      <View style={s.pageHeader}>
        <View style={s.pageHeaderCopy}>
          <AppText numberOfLines={2} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={s.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={s.pageActions}>{actions}</View> : null}
      </View>
      <View style={s.pageBody}>{children}</View>
    </ScrollView>
  );
}

// web @/components/ui <ConfirmDialog>: open/onConfirm/onCancel/title/message/
// confirmLabel/cancelLabel/loading on the native Modal.
function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  cancelLabel,
  loading,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
}) {
  if (!open) {
    return null;
  }
  return (
    <Modal
      animationType="fade"
      onRequestClose={loading ? undefined : onCancel}
      transparent
      visible={open}>
      <View
        accessibilityRole="alert"
        accessibilityLabel={title}
        accessible
        style={s.dialogOverlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={loading}
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={s.dialogBackdrop}
        />
        <GlassPanel style={s.dialogCard}>
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          <AppText style={s.dialogMessage} tone="secondary">
            {message}
          </AppText>
          <View style={s.dialogActions}>
            <Button
              disabled={loading}
              label={cancelLabel ?? 'Cancel'}
              onPress={onCancel}
              size="sm"
              variant="ghost"
            />
            <Button
              label={confirmLabel ?? 'Confirm'}
              loading={loading}
              onPress={onConfirm}
              size="sm"
              variant="primary"
            />
          </View>
        </GlassPanel>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export interface IncidentTimelinePageProps {
  /** Route `:id` param. The web read this via react-router useParams. */
  id?: string;
  /** react-router useNavigate / <Link> sink. Native hosts wire routing. */
  onNavigate?: (to: string) => void;
}

export default function IncidentTimelinePage({
  id,
  onNavigate,
}: IncidentTimelinePageProps = {}) {
  const navigate = useCallback(
    (to: string) => {
      onNavigate?.(to);
    },
    [onNavigate],
  );
  const {toast, toastBanner} = useNativeToast();
  const {formatDateTime: fmtAbs} = useNativeDateFormat();
  const numericId = useMemo(() => {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [id]);

  const {data: incident, isLoading, error} = useIncident(numericId);
  const appendUpdate = useAppendIncidentUpdate();
  const patch = usePatchIncident();

  const [message, setMessage] = useState('');
  const [nextStatus, setNextStatus] = useState<IncidentStatus | ''>('');
  const [confirmResolve, setConfirmResolve] = useState(false);

  const handleAppend = async () => {
    if (!incident) {
      return;
    }
    const m = message.trim();
    if (!m) {
      toast.error('Update message is required.');
      return;
    }
    try {
      await appendUpdate.mutateAsync({
        id: incident.id,
        payload: {
          message: m,
          status: (nextStatus || undefined) as IncidentStatus | undefined,
        },
      });
      setMessage('');
      setNextStatus('');
      toast.success('Update added.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to append update');
    }
  };

  const handleResolve = async () => {
    if (!incident) {
      return;
    }
    try {
      await patch.mutateAsync({id: incident.id, payload: {resolved: true}});
      toast.success('Incident resolved.');
      setConfirmResolve(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve');
    }
  };

  if (isLoading) {
    return (
      <PageContainerView subtitle="Loading…" title="Incident">
        <AppText style={s.loading} tone="muted" variant="caption">
          Loading incident…
        </AppText>
      </PageContainerView>
    );
  }

  if (error || !incident) {
    return (
      <PageContainerView subtitle="Not found" title="Incident">
        <GlassPanel style={s.panel}>
          <AppText tone="secondary">
            Incident {id} not found or you don't have access.
          </AppText>
          <Pressable
            accessibilityRole="link"
            onPress={() => navigate('/system-status')}
            style={({pressed}) => [s.backLink, pressed && s.btnPressed]}>
            <SemanticIcon decorative name="back" size="sm" />
            <AppText style={s.backLinkText} weight="semibold">
              Back to System Status
            </AppText>
          </Pressable>
        </GlassPanel>
      </PageContainerView>
    );
  }

  const tone = SEVERITY_TONE[incident.severity];
  const isResolved = incident.status === 'resolved';

  return (
    <PageContainerView
      actions={
        <Button
          icon="back"
          label="Back"
          onPress={() => navigate('/system-status')}
          size="sm"
          variant="ghost"
        />
      }
      subtitle={`Incident #${incident.id}`}
      title={incident.title}>
      <View style={s.stack}>
        {toastBanner}

        {/* Header */}
        <GlassPanel style={s.panel}>
          <View style={s.headerRow}>
            <SemanticIcon decorative name={tone.icon} size="sm" />
            <View style={s.headerBody}>
              <View style={s.badgeRow}>
                <Badge variant={STATUS_BADGE[incident.status]}>
                  {STATUS_LABEL[incident.status]}
                </Badge>
                <AppText
                  style={[s.severityLabel, {color: tone.color}]}
                  variant="caption"
                  weight="semibold">
                  {incident.severity}
                </AppText>
                <AppText style={s.metaMuted} tone="muted" variant="caption">
                  {incident.source}
                </AppText>
                {isResolved ? (
                  <Badge variant="success">
                    {`Resolved · ${fmtDuration(
                      incident.started_at,
                      incident.resolved_at,
                    )}`}
                  </Badge>
                ) : (
                  <Badge variant="neutral">
                    {`Open · ${fmtDuration(incident.started_at)}`}
                  </Badge>
                )}
              </View>
              {incident.description ? (
                <AppText style={s.description} tone="secondary">
                  {incident.description}
                </AppText>
              ) : null}
              {incident.affected_components.length > 0 ? (
                <AppText style={s.metaMuted} tone="muted" variant="caption">
                  Affects: {incident.affected_components.join(', ')}
                </AppText>
              ) : null}
              <View style={s.timeRow}>
                <SemanticIcon decorative name="clock" size="sm" />
                <AppText style={s.metaMuted} tone="muted" variant="caption">
                  Started {fmtAbs(incident.started_at)}
                  {incident.resolved_at
                    ? ` · Resolved ${fmtAbs(incident.resolved_at)}`
                    : ''}
                </AppText>
              </View>
            </View>
            {!isResolved ? (
              <Button
                disabled={patch.isPending}
                icon="confirm"
                label="Resolve"
                onPress={() => setConfirmResolve(true)}
                size="sm"
                variant="primary"
              />
            ) : null}
          </View>
        </GlassPanel>

        {/*
          AI incident timeline summarizer. Renders only when ai_mode is
          local|cloud AND the incident-timeline-summarizer toggle is on (gated by
          withAiFeature). When off, the wrapper returns null and the
          deterministic timeline below remains the canonical surface
          (ADR-015 §I3 + §I5). Positioned AFTER the incident header so the AI
          section has a resolved incident in scope, and BEFORE the deterministic
          timeline so users can compare the AI summary to the raw updates list
          directly below it.
        */}
        <AIIncidentTimelineSummarizer incidentId={incident.id} />

        {/* Timeline */}
        <GlassPanel style={s.panel}>
          <View style={s.sectionTitleRow}>
            <SemanticIcon decorative name="history" size="sm" />
            <AppText weight="semibold">Timeline</AppText>
            <AppText tone="muted" variant="caption">
              {incident.updates.length} entries
            </AppText>
          </View>
          <View style={s.timelineList}>
            {[...incident.updates].reverse().map((u, idx) => (
              <View key={`${u.at}-${idx}`} style={s.timelineItem}>
                <View style={s.badgeRow}>
                  <Badge variant={STATUS_BADGE[u.status]}>
                    {STATUS_LABEL[u.status]}
                  </Badge>
                  <AppText tone="muted" variant="caption">
                    {fmtAbs(u.at)}
                  </AppText>
                  {u.author ? (
                    <AppText tone="muted" variant="caption">
                      · {u.author}
                    </AppText>
                  ) : null}
                </View>
                <AppText style={s.updateMessage}>{u.message}</AppText>
              </View>
            ))}
          </View>
        </GlassPanel>

        {/* Append-update form */}
        {!isResolved ? (
          <GlassPanel style={s.panel}>
            <AppText style={s.addUpdateTitle} weight="semibold">
              Add update
            </AppText>
            <View style={s.form}>
              <TextInput
                accessibilityLabel="Update message"
                maxLength={4000}
                multiline
                numberOfLines={3}
                onChangeText={setMessage}
                placeholder="What's new? Investigation step, mitigation applied, hypothesis…"
                placeholderTextColor={colors.textMuted}
                style={s.textarea}
                value={message}
              />
              <View style={s.formRow}>
                <SelectField
                  accessibilityLabel="Change status with this update"
                  onChange={v => setNextStatus(v as IncidentStatus | '')}
                  options={[
                    {
                      value: '',
                      label: `Keep status as ${STATUS_LABEL[incident.status]}`,
                    },
                    {value: 'investigating', label: '→ Investigating'},
                    {value: 'identified', label: '→ Identified'},
                    {value: 'monitoring', label: '→ Monitoring'},
                    {value: 'resolved', label: '→ Resolved'},
                  ]}
                  value={nextStatus}
                />
                <Button
                  disabled={appendUpdate.isPending}
                  label={appendUpdate.isPending ? 'Adding…' : 'Add update'}
                  onPress={handleAppend}
                  variant="primary"
                />
              </View>
            </View>
          </GlassPanel>
        ) : null}
      </View>

      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Resolve"
        loading={patch.isPending}
        message="This will close the incident and stamp resolved_at. You can still view the timeline."
        onCancel={() => setConfirmResolve(false)}
        onConfirm={handleResolve}
        open={confirmResolve}
        title="Resolve incident?"
      />
    </PageContainerView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  page: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  pageSubtitle: {
    marginTop: 2,
  },
  pageActions: {
    flexShrink: 0,
  },
  pageBody: {
    gap: spacing.lg,
  },
  stack: {
    gap: spacing.lg,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  panel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  loading: {
    paddingVertical: spacing.sm,
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerBody: {
    flex: 1,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  severityLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metaMuted: {
    flexShrink: 1,
  },
  description: {
    lineHeight: 22,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Timeline
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timelineList: {
    gap: spacing.md,
  },
  timelineItem: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
    gap: spacing.xs,
  },
  updateMessage: {
    marginTop: 2,
  },
  // Form
  addUpdateTitle: {
    marginBottom: spacing.xs,
  },
  form: {
    gap: spacing.md,
  },
  textarea: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  // Button
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 14,
  },
  btnMd: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  btnSm: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnDisabled: {
    opacity: 0.48,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnText: {
    fontSize: 14,
  },
  btnTextSm: {
    fontSize: 13,
  },
  btnTextPrimary: {
    color: colors.background,
  },
  btnTextGhost: {
    color: colors.textPrimary,
  },
  // Back link (error state)
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  backLinkText: {
    color: colors.accent,
    fontSize: 13,
  },
  // Select field
  selectWrap: {
    flex: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
  },
  fieldPressed: {
    opacity: 0.82,
  },
  fieldText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 5, 10, 0.72)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
  },
  optionTextActive: {
    color: colors.textPrimary,
  },
  // Toast
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toastSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  toastError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  toastText: {
    flex: 1,
  },
  // Confirm dialog
  dialogOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 5, 10, 0.72)',
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dialogMessage: {
    lineHeight: 22,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
