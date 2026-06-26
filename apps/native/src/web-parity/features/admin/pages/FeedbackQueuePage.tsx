// Native parity port of web/src/features/admin/pages/FeedbackQueuePage.tsx.
//
// The web source is the admin "Feedback queue" page: a filter row (status +
// category <Select>s and a Refresh button, plus a "GitHub bridge disabled" hint
// when the server-side forwarding bridge is not configured), then a paginated,
// expandable <DataTable> of user_feedback rows. Each row's columns are
// created-at, a category Badge, the title, the page route (mono), a reporter
// <UserCell>, a status Badge, and a GitHub issue link. Clicking a row expands a
// detail panel that shows the report body, an app-version / user-agent /
// submitter / reporter-email meta grid (the email behind a <MaskedValue>),
// collapsible recent_errors JSON and console_tail blocks, and inline triage
// controls (status <Select>, GitHub URL <Input>, Save URL + Forward-to-GitHub
// buttons), with the opt-in <AIFeedbackQueueTriage> advisor beneath. It is
// driven by `useFeedbackList` (admin GET /admin/feedback) + `useUpdateFeedback`
// (admin PATCH /admin/feedback/{id}).
//
// Mirroring the sibling admin parity ports (ApiLogsPage inlines its
// PageContainer / StatCard / Badge / Select / Input chrome), this self-contained
// port rebuilds each DOM/web-only piece with React Native primitives + the
// existing native tokens/components:
//   * `<PageContainer title>` -> an inline `PageContainerView` (a `ScrollView`
//     with a title header, then the page body stack).
//   * `<GlassPanel>` -> the shared native `GlassPanel`.
//   * `<FadeIn>` (framer-motion) -> a passthrough `View`; the web entrance
//     animation carries no behavioural contract.
//   * `<Select>` -> an inline `SelectField` (a field-styled trigger that opens a
//     React Native `Modal` list of options; picking one fires `onChange`) — the
//     native analogue of an HTML <select>, with the web Select's `label`.
//   * `<Input>` -> an inline `InputField` (a bordered row with a `TextInput`).
//   * `<Button>` (ghost / primary, size="sm") -> an inline `ActionButton`
//     (Pressable) with an optional leading icon/spinner slot.
//   * `<Badge>` (danger/info/neutral/success/warning) -> an inline `Badge` pill
//     using the matching token surfaces — the same approach as ApiLogsPage.
//   * `<DataTable expandable>` -> the web `columns` array is preserved verbatim
//     as a native `FeedbackColumn[]` (key / header / render / sortable). A native
//     table has no DOM <table>, so each row renders the same columns as a
//     labelled card and a Pressable toggles its expansion. `expandedIds`
//     (`Set<number>`) preserves the DataTable's independent per-row expansion;
//     `sortable` flags are preserved structurally (the native list is not
//     interactively re-sorted — documented native-safe adaptation).
//   * `<Spinner>` -> RN `ActivityIndicator`.
//   * `<QueryError error onRetry>` -> an inline `QueryErrorView` (alert icon +
//     message + a Retry `ActionButton`).
//   * `<EmptyState icon title message>` -> the shared native `EmptyState`
//     (title + message) beneath a `bug` `SemanticIcon`, preserving the icon.
//   * `<UserCell user={{id,email}}>` -> an inline `UserCellView` reproducing the
//     web display priority (email local-part -> id -> "Unknown user") with an
//     initials avatar in place of the DOM `<Avatar>`.
//   * `<MaskedValue variant="email" copyable auditOnReveal>` -> an inline
//     `MaskedValue` reproducing the email mask (`j•••@example.com`), the
//     tap-to-reveal + 30s auto-hide, and the fire-and-forget POST
//     `/audit/reveal` on reveal. "Copyable" maps to the RN `Share` API (the
//     native "get this value out" affordance; there is no DOM clipboard) —
//     documented native-safe adaptation.
//   * `<details>/<summary>` (recent_errors / console_tail) -> an inline
//     `Collapsible` (a Pressable summary toggling a body), and the `<pre>` JSON /
//     text -> a `CodeBlock` (a scrollable monospace GlassPanel).
//   * The GitHub `<a href target=_blank>` link -> a `Pressable` that opens the
//     URL via RN `Linking.openURL`.
//   * `Icons.refresh` / `Icons.bug` (lucide) -> the `refresh` / `bug`
//     `SemanticIcon` names; no lucide / DOM import.
//   * `usePageTitle` -> a no-op `useNativePageTitle` (no `document.title`).
//   * `useDateFormat().formatDateTime` -> the shared native
//     `lib/format.formatDateTime` (the repo's default short datetime formatter).
//   * react-i18next `useTranslation` -> a self-contained
//     `useNativeTranslationFallback` returning each English fallback and
//     reproducing i18next `{{var}}` interpolation (used by `feedback.queue.pageOf`).
//
// `useFeedbackList` / `useUpdateFeedback` and the `FeedbackCategory` /
// `FeedbackEntry` / `FeedbackStatus` types are reused from the existing native
// api/hooks/useFeedback port (the same shapes + endpoints the web imported from
// @/api/hooks/useFeedback + @/api/types). The native request() preserves the
// snake_case keys, so every `row.created_at` / `row.page_route` /
// `row.submitter_subject` / `data.github_bridge_enabled` access reads identically.
// `<AIFeedbackQueueTriage>` is reused from the existing native components/ai port.
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-router, no
// framer-motion, and no web UI components are imported.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { EmptyState } from '../../../../components/feedback/EmptyState';
import { colors, spacing } from '../../../../theme/tokens';
import { formatDateTime } from '../../../../lib/format';
import { apiUrl } from '../../../api/client';
import { AIFeedbackQueueTriage } from '../../../components/ai/AIFeedbackQueueTriage';
import {
  useFeedbackList,
  useUpdateFeedback,
  type FeedbackCategory,
  type FeedbackEntry,
  type FeedbackStatus,
} from '../../../api/hooks/useFeedback';

/* ------------------------------------------------------------------ */
/*  i18n + native-safe helpers                                         */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web page read `t` from react-i18next. Native parity has no i18n runtime
// wired yet, so this returns the English fallback string and reproduces
// i18next's `{{name}}` interpolation, preserving every key + fallback (the
// pagination copy uses the page / total / count substitutions).
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

// Inlined error normaliser (the web QueryError owns this internally). Turns an
// unknown React Query error into a human-readable string.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

const BULLET = '\u2022';

// Inlined from web `@/lib/maskValue` (maskEmail, showLast default 1): the local
// part is masked while the domain stays visible (`j•••@example.com`), with at
// least one bullet so a one-character local part is never fully exposed.
function maskEmail(value: string, showLast: number): string {
  const at = value.indexOf('@');
  if (at <= 0) {
    const visible = Math.max(0, Math.min(showLast, value.length));
    const hidden = value.length - visible;
    return BULLET.repeat(Math.max(hidden, 0)) + value.slice(value.length - visible);
  }
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = Math.max(0, Math.min(showLast, local.length));
  const masked =
    local.slice(0, visible) + BULLET.repeat(Math.max(local.length - visible, 1));
  return masked + domain;
}

// Fire-and-forget audit POST mirroring web `MaskedValue.postRevealAudit`. Plain
// fetch (not the resilient pipeline) so a missing endpoint or transient backend
// failure never blocks the reveal UX. Errors are swallowed by design.
function postRevealAudit(variant: string): void {
  try {
    void fetch(apiUrl('/audit/reveal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'masked_reveal', variant }),
      credentials: 'include',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* silent: audit is defense-in-depth; never block reveal UX */
  }
}

const PAGE_SIZE = 25;
const MASK_AUTO_HIDE_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Inline native chrome                                               */
/* ------------------------------------------------------------------ */

// FadeIn: web framer-motion entrance wrapper. The animation carries no
// behavioural contract, so this preserves the wrapper structurally.
function FadeIn({ children }: { children: ReactNode }) {
  return <View style={styles.fadeIn}>{children}</View>;
}

// Native parity for the web <PageContainer title>: a scrollable page with a
// title header, then the body stack.
function PageContainerView({
  title,
  children,
}: {
  title: string;
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
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

type BadgeVariant = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

interface SelectOption {
  value: string;
  label: string;
}

// Native parity for the shared web Badge.
function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeToneStyles[variant]]}>
      <AppText style={badgeTextStyles[variant]} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// Native parity for the web <Button> (ghost / primary, size="sm").
function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'ghost',
  leading,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'ghost' | 'primary';
  leading?: ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? styles.btnPrimary : styles.btnGhost,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      {leading ?? null}
      <AppText
        style={variant === 'primary' ? styles.btnPrimaryText : styles.btnGhostText}
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the web <Select>: a field-styled trigger that opens a Modal
// list of options. Picking one fires onChange and closes the sheet. Renders the
// web Select's `label` above the field.
function SelectField({
  label,
  value,
  options,
  onChange,
  accessibilityLabel,
  disabled = false,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected =
    options.find((o) => o.value === value) ?? options[0] ?? { value: '', label: '' };
  return (
    <View style={styles.fieldGroup}>
      {label ? (
        <AppText
          style={styles.fieldLabel}
          tone="muted"
          variant="caption"
          weight="semibold"
        >
          {label}
        </AppText>
      ) : null}
      <Pressable
        accessibilityLabel={accessibilityLabel ?? label ?? ''}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          disabled && styles.fieldDisabled,
          pressed && !disabled && styles.fieldPressed,
        ]}
      >
        <AppText style={styles.fieldText} numberOfLines={1}>
          {selected.label}
        </AppText>
        <SemanticIcon decorative name="expand" size="sm" />
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <ScrollView>
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={o.value || '__all__'}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.optionRow,
                      active && styles.optionRowActive,
                      pressed && styles.optionRowPressed,
                    ]}
                  >
                    <AppText
                      style={active ? styles.optionTextActive : styles.optionText}
                    >
                      {o.label}
                    </AppText>
                    {active ? (
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

// Native parity for the web <Input>: a labelled bordered TextInput row.
function InputField({
  label,
  value,
  placeholder,
  onChangeText,
  disabled = false,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  onChangeText: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      {label ? (
        <AppText
          style={styles.fieldLabel}
          tone="muted"
          variant="caption"
          weight="semibold"
        >
          {label}
        </AppText>
      ) : null}
      <View style={[styles.field, disabled && styles.fieldDisabled]}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.textInput}
          value={value}
        />
      </View>
    </View>
  );
}

// Native parity for the web <MaskedValue variant="email" copyable auditOnReveal>.
function MaskedValue({
  value,
  ariaLabel,
  copyable = false,
  auditOnReveal = false,
}: {
  value: string | null | undefined;
  ariaLabel: string;
  copyable?: boolean;
  auditOnReveal?: boolean;
}) {
  const t = useNativeTranslationFallback();
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raw = value ?? '';
  const masked = useMemo(() => maskEmail(raw, 1), [raw]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const reveal = useCallback(() => {
    if (raw.length === 0) {
      return;
    }
    setRevealed(true);
    clearTimer();
    if (auditOnReveal) {
      postRevealAudit('email');
    }
    if (MASK_AUTO_HIDE_MS > 0) {
      timerRef.current = setTimeout(() => {
        setRevealed(false);
        timerRef.current = null;
      }, MASK_AUTO_HIDE_MS);
    }
  }, [auditOnReveal, clearTimer, raw]);

  const hide = useCallback(() => {
    setRevealed(false);
    clearTimer();
  }, [clearTimer]);

  const copy = useCallback(() => {
    void Share.share({ message: raw }).catch(() => undefined);
  }, [raw]);

  if (raw.length === 0) {
    return (
      <AppText accessibilityLabel={ariaLabel} tone="muted" variant="caption">
        —
      </AppText>
    );
  }

  const toggleLabel = revealed
    ? t('mask.hide', 'Hide value')
    : t('mask.reveal', 'Reveal value');

  return (
    <View accessibilityLabel={ariaLabel} style={styles.maskedRow}>
      <AppText
        style={revealed ? styles.maskedValueRevealed : styles.maskedValue}
        variant="caption"
      >
        {revealed ? raw : masked}
      </AppText>
      <Pressable
        accessibilityLabel={toggleLabel}
        accessibilityRole="button"
        onPress={revealed ? hide : reveal}
        style={({ pressed }) => [styles.maskedButton, pressed && styles.fieldPressed]}
      >
        <SemanticIcon decorative name={revealed ? 'hide' : 'show'} size="sm" />
      </Pressable>
      {copyable ? (
        <Pressable
          accessibilityLabel={t('mask.copy', 'Copy value')}
          accessibilityRole="button"
          onPress={copy}
          style={({ pressed }) => [styles.maskedButton, pressed && styles.fieldPressed]}
        >
          <SemanticIcon decorative name="copy" size="sm" />
        </Pressable>
      ) : null}
    </View>
  );
}

// Native parity for the web <UserCell user={{id,email}}>. Display priority
// (matching the web component): email local-part -> id -> "Unknown user", with
// an initials avatar in place of the DOM <Avatar>.
function UserCellView({
  user,
}: {
  user: { id: string | null; email: string | null };
}) {
  const t = useNativeTranslationFallback();
  if (!user.id && !user.email) {
    return (
      <AppText tone="muted" variant="caption">
        —
      </AppText>
    );
  }
  const displayName =
    user.email?.split('@')[0] || user.id || t('avatar.unknown', 'Unknown user');
  return (
    <View style={styles.userCell}>
      <View style={styles.avatar}>
        <AppText style={styles.avatarText} variant="caption" weight="bold">
          {displayName.charAt(0).toUpperCase()}
        </AppText>
      </View>
      <AppText numberOfLines={1} variant="caption">
        {displayName}
      </AppText>
    </View>
  );
}

// Native parity for the web GitHub <a href target=_blank>: opens the issue URL
// via RN Linking.
function GithubLink({ url, label }: { url: string; label: string }) {
  const open = useCallback(() => {
    void Linking.openURL(url).catch(() => undefined);
  }, [url]);
  return (
    <Pressable accessibilityRole="link" onPress={open}>
      <AppText style={styles.link} variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the web <details>/<summary>: a Pressable summary toggling a
// body.
function Collapsible({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.collapsible}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.summaryRow}
      >
        <SemanticIcon decorative name={open ? 'collapse' : 'expand'} size="sm" />
        <AppText tone="secondary" variant="caption">
          {summary}
        </AppText>
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

// Native parity for the web <pre>: a scrollable monospace block.
function CodeBlock({ text }: { text: string }) {
  return (
    <GlassPanel style={styles.codePanel}>
      <ScrollView nestedScrollEnabled style={styles.codeScrollV}>
        <ScrollView horizontal nestedScrollEnabled>
          <AppText style={styles.codeText}>{text}</AppText>
        </ScrollView>
      </ScrollView>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Category / status badges (ported verbatim from the web source)     */
/* ------------------------------------------------------------------ */

function CategoryBadge({ category }: { category: FeedbackCategory }) {
  const t = useNativeTranslationFallback();
  const variant: Record<FeedbackCategory, BadgeVariant> = {
    bug: 'danger',
    feature: 'info',
    other: 'neutral',
  };
  const label: Record<FeedbackCategory, string> = {
    bug: t('feedback.category.bug', 'Bug report'),
    feature: t('feedback.category.feature', 'Feature request'),
    other: t('feedback.category.other', 'Other / question'),
  };
  return <Badge variant={variant[category]}>{label[category]}</Badge>;
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const t = useNativeTranslationFallback();
  const variant: Record<FeedbackStatus, BadgeVariant> = {
    new: 'warning',
    triaged: 'success',
    closed: 'neutral',
  };
  const label: Record<FeedbackStatus, string> = {
    new: t('feedback.queue.status.new', 'New'),
    triaged: t('feedback.queue.status.triaged', 'Triaged'),
    closed: t('feedback.queue.status.closed', 'Closed'),
  };
  return <Badge variant={variant[status]}>{label[status]}</Badge>;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

// Native analogue of the web `columns` array (Column<FeedbackEntry>[]). The DOM
// <table> is gone, but each column's key / header / render / sortable is
// preserved so the per-row card renders exactly the same fields.
interface FeedbackColumn {
  key: string;
  header: string;
  render: (row: FeedbackEntry) => ReactNode;
  sortable?: boolean;
}

type UpdateFeedbackMutate = ReturnType<typeof useUpdateFeedback>['mutate'];

export default function FeedbackQueuePage() {
  const t = useNativeTranslationFallback();
  useNativePageTitle(t('feedback.queue.title', 'Feedback queue'));

  const [statusFilter, setStatusFilter] = useState<'' | FeedbackStatus>('');
  const [categoryFilter, setCategoryFilter] = useState<'' | FeedbackCategory>('');
  const [page, setPage] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());

  const { data, isLoading, isError, error, refetch, isFetching } = useFeedbackList({
    status: statusFilter || undefined,
    category: categoryFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const update = useUpdateFeedback();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const bridgeEnabled = Boolean(data?.github_bridge_enabled);

  const statusOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('feedback.queue.filter.allStatuses', 'All statuses') },
      { value: 'new', label: t('feedback.queue.status.new', 'New') },
      { value: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged') },
      { value: 'closed', label: t('feedback.queue.status.closed', 'Closed') },
    ],
    [t],
  );
  const categoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('feedback.queue.filter.allCategories', 'All categories') },
      { value: 'bug', label: t('feedback.category.bug', 'Bug report') },
      { value: 'feature', label: t('feedback.category.feature', 'Feature request') },
      { value: 'other', label: t('feedback.category.other', 'Other / question') },
    ],
    [t],
  );

  const columns = useMemo<FeedbackColumn[]>(
    () => [
      {
        key: 'created_at',
        header: t('feedback.queue.col.created', 'Created'),
        render: (row: FeedbackEntry) => (
          <AppText tone="secondary" variant="caption">
            {formatDateTime(row.created_at)}
          </AppText>
        ),
        sortable: true,
      },
      {
        key: 'category',
        header: t('feedback.queue.col.category', 'Category'),
        render: (row: FeedbackEntry) => <CategoryBadge category={row.category} />,
        sortable: true,
      },
      {
        key: 'title',
        header: t('feedback.queue.col.title', 'Title'),
        render: (row: FeedbackEntry) => (
          <AppText style={styles.titleValue}>{row.title || '—'}</AppText>
        ),
        sortable: true,
      },
      {
        key: 'page_route',
        header: t('feedback.queue.col.pageRoute', 'Page'),
        render: (row: FeedbackEntry) =>
          row.page_route ? (
            <AppText style={styles.mono} tone="secondary" variant="caption">
              {row.page_route}
            </AppText>
          ) : (
            <AppText tone="muted" variant="caption">
              —
            </AppText>
          ),
      },
      {
        key: 'reporter',
        header: t('feedback.queue.col.reporter', 'Reporter'),
        render: (row: FeedbackEntry) => (
          <UserCellView
            user={{
              id: row.submitter_subject || null,
              email: row.user_email || null,
            }}
          />
        ),
      },
      {
        key: 'status',
        header: t('feedback.queue.col.status', 'Status'),
        render: (row: FeedbackEntry) => <StatusBadge status={row.status} />,
        sortable: true,
      },
      {
        key: 'github_issue_url',
        header: t('feedback.queue.col.github', 'GitHub'),
        render: (row: FeedbackEntry) =>
          row.github_issue_url ? (
            <GithubLink
              url={row.github_issue_url}
              label={t('feedback.queue.openIssue', 'Open issue')}
            />
          ) : (
            <AppText tone="muted" variant="caption">
              —
            </AppText>
          ),
      },
    ],
    [t],
  );

  const toggleExpanded = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainerView title={t('feedback.queue.title', 'Feedback queue')}>
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.filterRow}>
            <View style={styles.filterItem}>
              <SelectField
                label={t('feedback.queue.filter.status', 'Status')}
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v as '' | FeedbackStatus);
                  setPage(0);
                }}
                options={statusOptions}
              />
            </View>
            <View style={styles.filterItem}>
              <SelectField
                label={t('feedback.queue.filter.category', 'Category')}
                value={categoryFilter}
                onChange={(v) => {
                  setCategoryFilter(v as '' | FeedbackCategory);
                  setPage(0);
                }}
                options={categoryOptions}
              />
            </View>
            <ActionButton
              accessibilityLabel={t('common.refresh', 'Refresh')}
              disabled={isFetching}
              label={t('common.refresh', 'Refresh')}
              leading={
                isFetching ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <SemanticIcon decorative name="refresh" size="sm" />
                )
              }
              onPress={() => refetch()}
            />
            {!bridgeEnabled ? (
              <AppText style={styles.bridgeNote} tone="muted" variant="caption">
                {t(
                  'feedback.queue.bridgeDisabled',
                  'GitHub Issues bridge is not configured on this server (set TESLASYNC_GITHUB_REPO + TESLASYNC_GITHUB_TOKEN to enable forwarding).',
                )}
              </AppText>
            ) : null}
          </View>

          {isLoading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : isError ? (
            <QueryErrorView error={error} onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            // no-action: feedback arrives by user submission, no admin CTA possible
            <View style={styles.emptyWrap}>
              <SemanticIcon decorative name="bug" size="lg" />
              <EmptyState
                title={t('feedback.queue.empty', 'No feedback yet')}
                message={t(
                  'feedback.queue.emptyMessage',
                  'User-submitted bug reports and feature requests will appear here.',
                )}
              />
            </View>
          ) : (
            <>
              <View style={styles.list}>
                {items.map((row) => (
                  <FeedbackRow
                    key={row.id}
                    bridgeEnabled={bridgeEnabled}
                    columns={columns}
                    expanded={expandedIds.has(row.id)}
                    onToggle={() => toggleExpanded(row.id)}
                    onUpdate={update.mutate}
                    row={row}
                    updating={update.isPending}
                  />
                ))}
              </View>
              <View style={styles.paginationRow}>
                <AppText tone="secondary" variant="caption">
                  {t(
                    'feedback.queue.pageOf',
                    'Page {{page}} of {{total}} ({{count}} entries)',
                    {
                      page: page + 1,
                      total: totalPages,
                      count: total,
                    },
                  )}
                </AppText>
                <View style={styles.paginationButtons}>
                  <ActionButton
                    disabled={page === 0 || isFetching}
                    label={t('common.previous', 'Previous')}
                    onPress={() => setPage((p) => Math.max(0, p - 1))}
                  />
                  <ActionButton
                    disabled={page + 1 >= totalPages || isFetching}
                    label={t('common.next', 'Next')}
                    onPress={() => setPage((p) => p + 1)}
                  />
                </View>
              </View>
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainerView>
  );
}
FeedbackQueuePage.displayName = 'FeedbackQueuePage';

// Native parity for the web QueryError (error + onRetry).
function QueryErrorView({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const t = useNativeTranslationFallback();
  return (
    <View style={styles.errorBlock}>
      <SemanticIcon decorative name="alertCircle" size="md" />
      <AppText style={styles.errorBlockText} tone="danger" variant="caption">
        {getErrorMessage(error)}
      </AppText>
      <ActionButton label={t('common.retry', 'Retry')} onPress={onRetry} />
    </View>
  );
}

// One feedback row: renders the columns as a labelled card and toggles its
// expanded detail. Native analogue of the web DataTable row + renderExpanded.
function FeedbackRow({
  row,
  columns,
  expanded,
  onToggle,
  bridgeEnabled,
  onUpdate,
  updating,
}: {
  row: FeedbackEntry;
  columns: FeedbackColumn[];
  expanded: boolean;
  onToggle: () => void;
  bridgeEnabled: boolean;
  onUpdate: UpdateFeedbackMutate;
  updating: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.rowInner, pressed && styles.rowPressed]}
      >
        <View style={styles.rowCells}>
          {columns.map((col) => (
            <View key={col.key} style={styles.cell}>
              <AppText
                style={styles.cellLabel}
                tone="muted"
                variant="caption"
                weight="semibold"
              >
                {col.header}
              </AppText>
              {col.render(row)}
            </View>
          ))}
        </View>
        <View style={styles.rowChevron}>
          <SemanticIcon
            decorative
            name={expanded ? 'collapse' : 'expand'}
            size="sm"
          />
        </View>
      </Pressable>
      {expanded ? (
        <FeedbackExpansion
          bridgeEnabled={bridgeEnabled}
          onUpdate={onUpdate}
          row={row}
          updating={updating}
        />
      ) : null}
    </View>
  );
}

function FeedbackExpansion({
  row,
  bridgeEnabled,
  onUpdate,
  updating,
}: {
  row: FeedbackEntry;
  bridgeEnabled: boolean;
  onUpdate: UpdateFeedbackMutate;
  updating: boolean;
}) {
  const t = useNativeTranslationFallback();
  const [issueUrl, setIssueUrl] = useState(row.github_issue_url ?? '');

  const statusOptions: SelectOption[] = [
    { value: 'new', label: t('feedback.queue.status.new', 'New') },
    { value: 'triaged', label: t('feedback.queue.status.triaged', 'Triaged') },
    { value: 'closed', label: t('feedback.queue.status.closed', 'Closed') },
  ];

  return (
    <View style={styles.expansion}>
      <View>
        <AppText style={styles.expansionHeading} weight="semibold" variant="caption">
          {t('feedback.queue.expand.body', 'Report body')}
        </AppText>
        <AppText style={styles.bodyText}>{row.body || '—'}</AppText>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <AppText style={styles.metaLabel} variant="caption" weight="semibold">
            {t('feedback.queue.expand.appVersion', 'App version')}:{' '}
          </AppText>
          <AppText style={styles.mono} variant="caption">
            {row.app_version || '—'}
          </AppText>
        </View>
        <View style={styles.metaItem}>
          <AppText style={styles.metaLabel} variant="caption" weight="semibold">
            {t('feedback.queue.expand.userAgent', 'User agent')}:{' '}
          </AppText>
          <AppText variant="caption">{row.user_agent || '—'}</AppText>
        </View>
        <View style={styles.metaItem}>
          <AppText style={styles.metaLabel} variant="caption" weight="semibold">
            {t('feedback.queue.expand.submitter', 'Submitter')}:{' '}
          </AppText>
          <AppText style={styles.mono} variant="caption">
            {row.submitter_subject || row.submitter_ip || '—'}
          </AppText>
        </View>
        <View style={styles.metaItem}>
          <AppText style={styles.metaLabel} variant="caption" weight="semibold">
            {t('feedback.queue.expand.userEmail', 'Email')}:{' '}
          </AppText>
          {row.user_email ? (
            <MaskedValue
              ariaLabel={t(
                'feedback.queue.maskedEmail',
                'Reporter email, click to reveal',
              )}
              auditOnReveal
              copyable
              value={row.user_email}
            />
          ) : (
            <AppText variant="caption">—</AppText>
          )}
        </View>
      </View>

      {row.recent_errors !== null && row.recent_errors !== undefined ? (
        <Collapsible
          summary={t('feedback.queue.expand.recentErrors', 'Recent frontend errors')}
        >
          <CodeBlock text={JSON.stringify(row.recent_errors, null, 2)} />
        </Collapsible>
      ) : null}

      {row.console_tail ? (
        <Collapsible summary={t('feedback.queue.expand.consoleTail', 'Console tail')}>
          <CodeBlock text={row.console_tail} />
        </Collapsible>
      ) : null}

      <View style={styles.actionsRow}>
        <View style={styles.actionStatus}>
          <SelectField
            disabled={updating}
            label={t('feedback.queue.action.changeStatus', 'Status')}
            onChange={(v) =>
              onUpdate({ id: row.id, update: { status: v as FeedbackStatus } })
            }
            options={statusOptions}
            value={row.status}
          />
        </View>
        <View style={styles.actionUrl}>
          <InputField
            disabled={updating}
            label={t('feedback.queue.action.githubUrl', 'GitHub issue URL')}
            onChangeText={setIssueUrl}
            placeholder="https://github.com/owner/repo/issues/123"
            value={issueUrl}
          />
        </View>
        <ActionButton
          disabled={updating || issueUrl === (row.github_issue_url ?? '')}
          label={t('feedback.queue.action.saveUrl', 'Save URL')}
          onPress={() =>
            onUpdate({ id: row.id, update: { github_issue_url: issueUrl } })
          }
        />
        {bridgeEnabled && !row.github_issue_url ? (
          <ActionButton
            label={t('feedback.queue.action.forward', 'Forward to GitHub')}
            leading={<SemanticIcon decorative name="bug" size="sm" />}
            onPress={() =>
              onUpdate({ id: row.id, update: { forward_to_github: true } })
            }
            variant="primary"
          />
        ) : null}
      </View>

      {/* Feedback queue triage AI advisor. Renders only when ai_mode is on AND
          the feedback-queue-triage toggle is enabled. Propose-only: never
          persists; the manual controls above remain the sole write path. */}
      <AIFeedbackQueueTriage feedbackId={row.id} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  fadeIn: {
    gap: spacing.md,
  },

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

  panel: {
    gap: spacing.md,
    padding: spacing.md,
  },

  // Filters
  filterRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  filterItem: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 160,
  },
  bridgeNote: {
    flexBasis: '100%',
  },

  // Field (select trigger + text input)
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    letterSpacing: 0.4,
  },
  field: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldPressed: {
    opacity: 0.82,
  },
  fieldText: {
    color: colors.textPrimary,
    flex: 1,
  },
  textInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },

  // Select modal
  modalBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  optionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textPrimary,
  },
  optionTextActive: {
    color: colors.accent,
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
    backgroundColor: colors.surface,
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

  // Badge
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },

  // Loading / error / empty
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  errorBlockText: {
    textAlign: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },

  // Row list
  list: {
    gap: spacing.sm,
  },
  row: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rowInner: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowCells: {
    flex: 1,
    gap: spacing.sm,
  },
  cell: {
    gap: 2,
  },
  cellLabel: {
    letterSpacing: 0.4,
  },
  rowChevron: {
    paddingTop: spacing.xs,
  },
  titleValue: {
    color: colors.textPrimary,
  },
  mono: {
    fontFamily: 'monospace',
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },

  // User cell
  userCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  avatarText: {
    color: colors.accent,
  },

  // Pagination
  paginationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  paginationButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Expansion
  expansion: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  expansionHeading: {
    marginBottom: spacing.xs,
  },
  bodyText: {
    color: colors.textPrimary,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaItem: {
    alignItems: 'center',
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    flexWrap: 'wrap',
    minWidth: 160,
  },
  metaLabel: {
    color: colors.textSecondary,
  },

  // Collapsible + code
  collapsible: {
    gap: spacing.xs,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  collapsibleBody: {
    marginTop: spacing.xs,
  },
  codePanel: {
    padding: spacing.sm,
  },
  codeScrollV: {
    maxHeight: 256,
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
  },

  // Masked value
  maskedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  maskedValue: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  maskedValueRevealed: {
    color: colors.accent,
    fontFamily: 'monospace',
  },
  maskedButton: {
    padding: 2,
  },

  // Action controls (expansion bottom)
  actionsRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  actionStatus: {
    minWidth: 160,
  },
  actionUrl: {
    minWidth: 0,
  },
});

const badgeToneStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  info: {
    color: colors.accent,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
