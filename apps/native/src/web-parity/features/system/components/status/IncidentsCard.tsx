// Native parity port of
// web/src/features/system/components/status/IncidentsCard.tsx.
//
// IncidentsCard is the active-incidents block on /system-status. When one or
// more incidents are active it renders a tinted GlassPanel: a header (warning
// icon + "Active incidents" + a count Badge + a "Log incident" CTA) over a list
// of compact incident rows. Each row links to the per-incident post-mortem
// timeline at /system-status/incidents/:id. When there are NO active incidents
// the card collapses entirely (returns null) — preserved verbatim. The CTA opens
// the IncidentForm dialog so operators can record manual incidents.
//
// State names (open), the `incidents` memo (active?.incidents ?? []), the
// `now` prop driving relative timestamps, the SEVERITY_TONE / STATUS_BADGE maps,
// the relativeFrom() buckets, the snake_case response fields
// (affected_components, started_at, updates) and the /system-status/incidents/:id
// link target are all preserved.
//
// Web -> native adaptations (documented in the sidecar):
//   - react-router-dom `<Link to={`/system-status/incidents/${inc.id}`}>` (web
//     L14, L88-91) has no native DOM router, so each row is an accessible link
//     Pressable (accessibilityRole="link") that preserves the destination path
//     via accessibilityValue.text for the navigation layer — the established
//     ChargingSessionCard HistoryListRow idiom. The hover/focus-ring classes
//     collapse to a pressed background.
//   - lucide-react icons (web L15): the header `AlertTriangle` -> a small amber
//     `▲` glyph (warning intent, sized inline rather than SemanticIcon's header
//     box); the per-row severity icons `AlertCircle`/`AlertTriangle`/
//     `AlertOctagon` -> a severity-coloured dot (the BackendStatusSection
//     "inline h-4 w-4 lucide -> status dot" idiom — severity is carried by the
//     dot colour AND the adjacent text label, exactly the three web tones);
//     `Plus` -> a literal "+" in the CTA label; `ChevronRight` -> a "\u203A"
//     glyph (the HistoryListRow chevron idiom).
//   - The shared `@/components/ui` GlassPanel (web L16) -> the shared native
//     GlassPanel; the amber ring (`ring-1 ring-amber-400/30`) maps to an amber
//     border, the near-invisible `bg-amber-500/[0.03]` keeps the glass surface.
//     `Button` (web L16) -> a ghost Pressable; `Badge` (web L16) -> an inline
//     tinted <Badge> pill with the same four variants (warning/danger/info/
//     success) the web STATUS_BADGE map produces.
//   - `cn` (web L17) is dropped — className merges resolve to RN style arrays.
//   - The NOT-yet-converted sibling `./IncidentForm` (web L24) is reproduced
//     inline as a native modal form (RN Modal + overlay/backdrop Pressable, the
//     CommandSelectDialog/FeedbackModal idiom), preserving its state
//     (title/severity/status/message/components), its 3-char title validation,
//     and its `useCreateIncident` POST payload (title, severity, status,
//     initial_message, affected_components). The web `useToast` has no native
//     analog, so the failure path surfaces an inline error message instead of a
//     toast; the success path closes the modal exactly as web (where the success
//     toast fires immediately before onClose). The web <Select> drop-downs
//     become segmented radio rows and the two-column severity/status grid stacks
//     vertically on the narrow native dialog.
//   - i18n: the web source renders literal English (no useTranslation here), so
//     the same English copy is preserved verbatim.
//
// No DOM, react-router-dom, lucide-react, Recharts, Leaflet, @/lib/cn, or old
// web @/components/ui modules are imported — only React Native primitives + the
// shared native AppText/GlassPanel + theme tokens + the native web-parity
// useIncidents/useCreateIncident hooks (API paths unchanged).

import React, {useCallback, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import {
  useCreateIncident,
  useIncidents,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
} from '../../../../api/hooks/useIncidents';

/* ─── severity + status maps (web L26-37) ───────────────────────────────── */

// web SEVERITY_TONE { Icon: lucide, cls: Tailwind, label }. The lucide Icon ->
// a severity-coloured dot; cls (text-amber-300 / text-orange-300 / text-red-400)
// -> its literal hex; label preserved verbatim.
const SEVERITY_TONE: Record<IncidentSeverity, {color: string; label: string}> = {
  minor: {color: '#fcd34d', label: 'minor'}, // amber-300
  major: {color: '#fdba74', label: 'major'}, // orange-300
  critical: {color: '#f87171', label: 'critical'}, // red-400
};

type BadgeVariant = 'warning' | 'danger' | 'info' | 'success';

// web STATUS_BADGE: IncidentStatus -> shared Badge variant. Preserved verbatim.
const STATUS_BADGE: Record<IncidentStatus, BadgeVariant> = {
  investigating: 'danger',
  identified: 'warning',
  monitoring: 'info',
  resolved: 'success',
};

/* ─── relativeFrom (web L39-47, ported verbatim) ────────────────────────── */

function relativeFrom(now: number, iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return '';
  }
  const secs = Math.max(0, Math.floor((now - t) / 1000));
  if (secs < 60) {
    return 'just now';
  }
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m ago`;
  }
  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h ago`;
  }
  return `${Math.floor(secs / 86400)}d ago`;
}

/* ─── inline Badge (web @/components/ui Badge) ──────────────────────────── */

function Badge({variant, label}: {variant: BadgeVariant; label: string}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        variant="caption"
        weight="semibold"
        style={badgeTextStyles[variant]}>
        {label}
      </AppText>
    </View>
  );
}

/* ─── inline IncidentForm (NOT-yet-converted sibling ./IncidentForm) ─────── */

const SEVERITY_OPTIONS: {value: IncidentSeverity; label: string}[] = [
  {value: 'minor', label: 'Minor'},
  {value: 'major', label: 'Major'},
  {value: 'critical', label: 'Critical'},
];

const STATUS_OPTIONS: {value: IncidentStatus; label: string}[] = [
  {value: 'investigating', label: 'Investigating'},
  {value: 'identified', label: 'Identified'},
  {value: 'monitoring', label: 'Monitoring'},
  {value: 'resolved', label: 'Resolved'},
];

function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: {value: T; label: string}[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="caption" weight="semibold" style={styles.fieldLabel}>
        {label}
      </AppText>
      <View style={styles.segmented}>
        {options.map(opt => {
          const selected = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{selected, disabled: !!disabled}}
              disabled={disabled}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.segment,
                selected && styles.segmentSelected,
                pressed && !disabled && styles.pressed,
              ]}>
              <AppText
                variant="caption"
                weight="semibold"
                style={selected ? styles.segmentTextSelected : styles.segmentText}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function IncidentForm({onClose}: {onClose: () => void}) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('minor');
  const [status, setStatus] = useState<IncidentStatus>('investigating');
  const [message, setMessage] = useState('');
  const [components, setComponents] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const create = useCreateIncident();

  // Mirrors web handleSubmit: trim title, enforce min 3 chars client-side, then
  // POST /status/incidents with the same snake_case payload via useCreateIncident.
  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setErrorText('Title must be at least 3 characters.');
      return;
    }
    setErrorText(null);
    try {
      await create.mutateAsync({
        title: trimmed,
        severity,
        status,
        initial_message: message.trim() || undefined,
        affected_components: components
          .split(',')
          .map(c => c.trim())
          .filter(Boolean),
      });
      onClose();
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : 'Failed to log incident',
      );
    }
  }, [components, create, message, onClose, severity, status, title]);

  const pending = create.isPending;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.dialog}>
          <AppText variant="title" weight="bold" style={styles.dialogTitle}>
            Log an incident
          </AppText>
          <ScrollView
            contentContainerStyle={styles.formContent}
            style={styles.form}
            testID="incident-form">
            <View style={styles.field}>
              <AppText
                variant="caption"
                weight="semibold"
                style={styles.fieldLabel}>
                Title
              </AppText>
              <TextInput
                accessibilityLabel="Title"
                editable={!pending}
                maxLength={200}
                onChangeText={setTitle}
                placeholder="e.g. Wall connector restart at 14:00"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={title}
              />
            </View>

            <SegmentedField
              disabled={pending}
              label="Severity"
              onChange={setSeverity}
              options={SEVERITY_OPTIONS}
              value={severity}
            />
            <SegmentedField
              disabled={pending}
              label="Status"
              onChange={setStatus}
              options={STATUS_OPTIONS}
              value={status}
            />

            <View style={styles.field}>
              <AppText
                variant="caption"
                weight="semibold"
                style={styles.fieldLabel}>
                Affected components (comma-separated, optional)
              </AppText>
              <TextInput
                accessibilityLabel="Affected components"
                editable={!pending}
                onChangeText={setComponents}
                placeholder="e.g. tesla, telemetry"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={components}
              />
            </View>

            <View style={styles.field}>
              <AppText
                variant="caption"
                weight="semibold"
                style={styles.fieldLabel}>
                Initial timeline message (optional)
              </AppText>
              <TextInput
                accessibilityLabel="Initial timeline message"
                editable={!pending}
                maxLength={4000}
                multiline
                numberOfLines={3}
                onChangeText={setMessage}
                placeholder="What's the situation?"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.textarea]}
                textAlignVertical="top"
                value={message}
              />
            </View>

            {errorText ? (
              <AppText variant="caption" style={styles.errorText}>
                {errorText}
              </AppText>
            ) : null}
          </ScrollView>

          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onClose}
              style={({pressed}) => [
                styles.actionBtn,
                styles.actionGhost,
                pressed && !pending && styles.pressed,
                pending && styles.actionDisabled,
              ]}>
              <AppText weight="semibold" style={styles.actionGhostText}>
                Cancel
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={handleSubmit}
              style={({pressed}) => [
                styles.actionBtn,
                styles.actionPrimary,
                pressed && !pending && styles.pressed,
                pending && styles.actionDisabled,
              ]}>
              <AppText weight="semibold" style={styles.actionPrimaryText}>
                {pending ? 'Logging…' : 'Log incident'}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── IncidentsCard (web L49-118) ───────────────────────────────────────── */

interface IncidentsCardProps {
  /** "now" tick from the page so relative timestamps re-render. */
  now: number;
}

export function IncidentsCard({now}: IncidentsCardProps) {
  const {data: active} = useIncidents({activeOnly: true});
  const [open, setOpen] = useState(false);
  const incidents = useMemo<Incident[]>(
    () => active?.incidents ?? [],
    [active],
  );

  // web L59-61: collapse the card entirely when there are no active incidents.
  if (incidents.length === 0) {
    return null;
  }

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <AppText allowFontScaling={false} style={styles.headerGlyph}>
            {'\u25B2'}
          </AppText>
          <AppText weight="semibold" style={styles.headerText}>
            Active incidents
          </AppText>
          <Badge variant="warning" label={String(incidents.length)} />
        </View>
        <Pressable
          accessibilityLabel="Log incident"
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={({pressed}) => [styles.logBtn, pressed && styles.pressed]}>
          <AppText weight="semibold" style={styles.logBtnText}>
            + Log incident
          </AppText>
        </Pressable>
      </View>

      <View style={styles.list}>
        {incidents.map(inc => {
          const tone = SEVERITY_TONE[inc.severity];
          const startedLine = `Started ${relativeFrom(now, inc.started_at)}${
            inc.updates.length > 1 ? ` · ${inc.updates.length} updates` : ''
          }`;
          return (
            <Pressable
              key={inc.id}
              accessibilityRole="link"
              accessibilityValue={{text: `/system-status/incidents/${inc.id}`}}
              style={({pressed}) => [styles.row, pressed && styles.rowPressed]}>
              <View
                style={[styles.severityDot, {backgroundColor: tone.color}]}
              />
              <View style={styles.rowBody}>
                <View style={styles.rowTitleLine}>
                  <AppText
                    numberOfLines={1}
                    weight="semibold"
                    style={styles.rowTitle}>
                    {inc.title}
                  </AppText>
                  <Badge variant={STATUS_BADGE[inc.status]} label={inc.status} />
                  <AppText
                    variant="caption"
                    weight="semibold"
                    style={[styles.severityLabel, {color: tone.color}]}>
                    {tone.label}
                  </AppText>
                </View>
                {inc.affected_components.length > 0 ? (
                  <AppText variant="caption" tone="muted" style={styles.rowMeta}>
                    {`Affects: ${inc.affected_components.join(', ')}`}
                  </AppText>
                ) : null}
                <AppText variant="caption" tone="muted" style={styles.rowMeta}>
                  {startedLine}
                </AppText>
              </View>
              <AppText allowFontScaling={false} style={styles.chevron}>
                {'\u203A'}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {open ? <IncidentForm onClose={() => setOpen(false)} /> : null}
    </GlassPanel>
  );
}

IncidentsCard.displayName = 'IncidentsCard';

/* ─── styles ────────────────────────────────────────────────────────────── */

const AMBER_RING = 'rgba(251, 191, 36, 0.3)'; // ring-amber-400/30
const AMBER_TEXT = '#fde68a'; // amber-200

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderColor: AMBER_RING,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerGlyph: {
    fontSize: 13,
    lineHeight: 18,
    color: AMBER_TEXT,
  },
  headerText: {
    fontSize: 14,
    color: AMBER_TEXT,
  },
  logBtn: {
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  logBtnText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.82,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  rowBody: {
    flex: 1,
    flexShrink: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowTitle: {
    flexShrink: 1,
    color: colors.textPrimary,
  },
  severityLabel: {
    letterSpacing: 0.2,
  },
  rowMeta: {
    marginTop: 2,
  },
  chevron: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 4,
    color: colors.textMuted,
  },

  // Badge
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  // Modal / IncidentForm
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  form: {
    flexGrow: 0,
  },
  formContent: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    fontSize: typography.body,
  },
  textarea: {
    minHeight: 88,
  },
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  segment: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceRaised,
  },
  segmentSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  segmentText: {
    color: colors.textSecondary,
  },
  segmentTextSelected: {
    color: colors.accent,
  },
  errorText: {
    color: colors.danger,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  actionBtn: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
  },
  actionDisabled: {
    opacity: 0.48,
  },
  actionGhostText: {
    color: colors.textPrimary,
  },
  actionPrimaryText: {
    color: colors.background,
  },
});

const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
});

export default IncidentsCard;
