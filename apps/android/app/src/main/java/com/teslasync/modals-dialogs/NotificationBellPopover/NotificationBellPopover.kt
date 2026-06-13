// The native Jetpack Compose + Material 3 NotificationBellPopover modal/dialog — a parity port of the web
// `NotificationBellPopover` (web/src/components/layout/NotificationBellPopover.tsx). The web component is the
// header bell's in-place triage panel: a bell trigger + live unread badge, an anchored non-modal popover with
// the latest 10 unread notifications (severity dot, title, one-line message, relative time, vehicle name), a
// "Mark all read" action, and a "View all" escape hatch to the full inbox. On a compact viewport the bell
// navigates straight to the inbox instead of opening the popover.
//
// All derivation flows through the pure [NotificationBellPopoverProjection] (NotificationBellPopoverModel.kt);
// the composables are a thin render layer. Data binds through the shared P1/S8 state holders via
// [NotificationBellPopoverSource] (a `NotificationsStore`/`VehiclesStore` adapter) — the view performs NO HTTP.
// Every string resolves from the i18n catalog (P1/S10); there is no English literal in this file. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Overlay choice: the web is a NON-modal `role="dialog"` anchored popover that dismisses on Escape / outside
// tap, so it maps to the shared [Popover] (a focusable Compose `Popup` that dismisses on Back / outside tap),
// not the centered focus-trap [Modal] — the honest native idiom for an anchored, non-modal triage panel.
//
// Every lifecycle state the preview feed can carry is rendered (P3 "no hidden surfaces"): a loading spinner, a
// hard error with retry, the friendly empty state, the content list, and a stale/offline freshness chip with a
// silent auto-refresh — the freshness contract the sibling NotificationRow / InboxBody surfaces use.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/NotificationBellPopover) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.notificationbellpopover

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Below this viewport width the bell navigates to the inbox instead of opening the popover (web ≤ 640 px). */
private const val COMPACT_WIDTH_DP: Int = 640

/** Anchored panel width (web `POPOVER_WIDTH_PX = 360`, inset for the [Popover] surface padding). */
private val BELL_PANEL_WIDTH = 340.dp

/** Cap on the scrollable body so a full preview never overflows the screen (web `max-h-[calc(100vh-6rem)]`). */
private val BELL_PANEL_BODY_MAX_HEIGHT = 360.dp

/** Severity dot diameter + its top inset so it aligns with the title line (web `h-2 w-2 mt-1.5`). */
private val BELL_DOT_SIZE = 8.dp
private val BELL_DOT_TOP = 6.dp

/** Unread-badge minimum size + horizontal inset (web `h-4 min-w-4 px-1`). */
private val BELL_BADGE_MIN_SIZE = 16.dp
private val BELL_BADGE_INSET = 4.dp

private const val ROW_TITLE_MAX_LINES: Int = 1
private const val ROW_MESSAGE_MAX_LINES: Int = 1

/**
 * The popover's joined preview state — the latest unread rows (cache-then-network [UiState]) plus the rule and
 * vehicle lookups used to enrich each row. The composable projects rows from these via
 * [NotificationBellPopoverProjection.projectRows]; bundling them keeps the [NotificationBellPanel] stateless and
 * trivially previewable / UI-testable.
 *
 * @property state the bell-preview feed projection (web `useUnreadNotifications`).
 * @property rulesById alert rules keyed by id, for the per-row severity + vehicle lookup (web `useAlertRules`).
 * @property vehiclesById vehicles keyed by id, for the per-row vehicle name (web `useVehicles`).
 */
data class NotificationBellPreview(
    val state: UiState<List<NotificationLog>>,
    val rulesById: Map<Long, AlertRule>,
    val vehiclesById: Map<Long, Vehicle>,
) {
    /** The number of preview rows currently shown — gates the "Mark all read" action (web `logs.length`). */
    val logCount: Int get() = state.data?.size ?: 0

    companion object {
        /** The neutral pre-open value (the panel is never rendered while it is held). */
        val EMPTY: NotificationBellPreview =
            NotificationBellPreview(UiState(UiPhase.Empty, emptyList()), emptyMap(), emptyMap())
    }
}

/**
 * State holder backing the popover — the native analogue of the web component's `useState(open)` plus its data
 * hooks. It binds the shared **S8** Notifications + Vehicles feeds through [NotificationBellPopoverSource]: the
 * unread-count badge feed is always live, while the preview (rows + rules + vehicles) is collected ONLY while the
 * panel is open (web "the hook is only mounted while the popover is open"). The "Mark all read" mutation routes
 * through the source. A plain holder (not an AndroidX ViewModel): the bell lives in the header on every page, so
 * its state is owned per-composition and torn down with it. It takes an injected [scope] (the composable's
 * `rememberCoroutineScope()`; tests pass a `TestScope` background scope), exactly like the sibling presenters.
 *
 * @param source the cache-then-network Notifications + Vehicles seam (a shared-layer adapter, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope the scope the shared feeds run in + mutations launch on.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationBellPopoverPresenter(
    private val source: NotificationBellPopoverSource,
    private val logger: Logger,
    private val scope: CoroutineScope,
) {
    private val openState = MutableStateFlow(false)

    /** Whether the popover is open (web `open` state). */
    val open: StateFlow<Boolean> = openState

    private val refreshTrigger = MutableStateFlow(0)
    private val markPendingState = MutableStateFlow(false)

    /** Whether the "Mark all read" mutation is in flight (web `bulkMarkRead.isPending`), disabling its action. */
    val markPending: StateFlow<Boolean> = markPendingState

    /** The live unread count backing the bell badge (web `useUnreadCount`); always collected while observed. */
    val unreadCount: StateFlow<Int> =
        source
            .unreadCount()
            .map { it.cached ?: 0 }
            .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), 0)

    /**
     * The joined bell preview as a lifecycle-aware [StateFlow]. While closed it holds the neutral empty value and
     * NEVER opens the feed — the native analogue of the web hook being mounted only while the popover is open. On
     * open it collects the cache-then-network preview, rule, and vehicle feeds and folds them into a
     * [NotificationBellPreview] carrying loading / content / empty / stale / offline / error.
     */
    val preview: StateFlow<NotificationBellPreview> =
        combine(openState, refreshTrigger) { isOpen, _ -> isOpen }
            .flatMapLatest { isOpen -> if (isOpen) previewFeed() else flowOf(NotificationBellPreview.EMPTY) }
            .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), NotificationBellPreview.EMPTY)

    private var viewOpenedRecorded = false

    /** Toggles the popover (web `setOpen((v) => !v)`). */
    fun toggle() {
        openState.update { !it }
    }

    /** Closes the popover (web `close` / dismiss-on-outside / post-navigation). */
    fun dismiss() {
        openState.value = false
    }

    /**
     * Marks every unread row read (web `handleMarkAllRead` → `bulkMarkRead({ all: true })`). A no-op while a
     * mutation is already pending or the preview is empty (web `if (logs.length === 0) return`). On completion the
     * preview re-collects so the freshly-emptied list and the cleared badge are reflected.
     */
    fun markAllRead() {
        if (markPendingState.value || preview.value.logCount == 0) return
        markPendingState.value = true
        scope.launch {
            source.markAllRead()
            markPendingState.value = false
            refreshTrigger.update { it + 1 }
        }
    }

    /** Re-runs the preview fetch (the hard-error retry + the stale freshness auto-refresh). */
    fun refresh() {
        logger.info("notificationBellPopover.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordNotificationBellPopoverOpened(logger)
    }

    private fun previewFeed(): Flow<NotificationBellPreview> =
        combine(
            source.unreadNotifications(NotificationBellPopoverRegistration.PREVIEW_LIMIT),
            source.alertRules(),
            source.vehicles(),
        ) { logs, rules, vehicles ->
            NotificationBellPreview(
                state = logs.toUiState { it.isEmpty() },
                rulesById = (rules.cached ?: emptyList()).associateBy { it.id },
                vehiclesById = (vehicles.cached ?: emptyList()).associateBy { it.id },
            )
        }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}

/**
 * The already-localized microcopy the popover reads from the i18n catalog (P1/S10). A single resolved-strings
 * carrier keeps the stateless render functions free of `stringResource` calls and lets the unit/UI tests inject
 * fixed copy. The two `*Template` fields carry an Android `%1$s` format token, applied with the count at use.
 */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per web t() call the surface renders.
data class NotificationBellPopoverStrings(
    val notificationsLabel: String,
    val unreadNotificationsTemplate: String,
    val title: String,
    val unreadCountTemplate: String,
    val allRead: String,
    val close: String,
    val loading: String,
    val error: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val untitled: String,
    val markAllRead: String,
    val viewAll: String,
    val retry: String,
    val offline: String,
    val severityInfo: String,
    val severityWarn: String,
    val severityCritical: String,
)

/** Resolves every [NotificationBellPopoverStrings] entry from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberNotificationBellPopoverStrings(): NotificationBellPopoverStrings {
    val notificationsLabel = stringResource(R.string.translation_nav_notifications)
    val unreadNotificationsTemplate = stringResource(R.string.translation_nav_notificationsUnread)
    val title = stringResource(R.string.translation_notifications_bellPopover_title)
    val unreadCountTemplate = stringResource(R.string.translation_notifications_bellPopover_unreadCount)
    val allRead = stringResource(R.string.translation_notifications_bellPopover_allRead)
    val close = stringResource(R.string.translation_common_close)
    val loading = stringResource(R.string.translation_notifications_bellPopover_loading)
    val error = stringResource(R.string.translation_notifications_bellPopover_error)
    val emptyTitle = stringResource(R.string.translation_notifications_bellPopover_emptyTitle)
    val emptyMessage = stringResource(R.string.translation_notifications_bellPopover_emptyMessage)
    val untitled = stringResource(R.string.translation_notifications_bellPopover_untitled)
    val markAllRead = stringResource(R.string.translation_notifications_bellPopover_markAllRead)
    val viewAll = stringResource(R.string.translation_notifications_bellPopover_viewAll)
    val retry = stringResource(R.string.translation_common_retry)
    val offline = stringResource(R.string.translation_common_offline)
    val severityInfo = stringResource(R.string.translation_notifications_inbox_filter_severity_info)
    val severityWarn = stringResource(R.string.translation_notifications_inbox_filter_severity_warn)
    val severityCritical = stringResource(R.string.translation_notifications_inbox_filter_severity_critical)
    return remember(notificationsLabel, title, error, untitled) {
        NotificationBellPopoverStrings(
            notificationsLabel = notificationsLabel,
            unreadNotificationsTemplate = unreadNotificationsTemplate,
            title = title,
            unreadCountTemplate = unreadCountTemplate,
            allRead = allRead,
            close = close,
            loading = loading,
            error = error,
            emptyTitle = emptyTitle,
            emptyMessage = emptyMessage,
            untitled = untitled,
            markAllRead = markAllRead,
            viewAll = viewAll,
            retry = retry,
            offline = offline,
            severityInfo = severityInfo,
            severityWarn = severityWarn,
            severityCritical = severityCritical,
        )
    }
}

/**
 * Stateful entry point — the faithful port of the web `NotificationBellPopover`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), builds the [NotificationBellPopoverPresenter] over the shared S8 [source], and renders the
 * bell trigger plus the anchored popover. On a compact viewport the bell navigates to the inbox instead.
 *
 * @param source the shared Notifications + Vehicles seam (production: [notificationBellPopoverSource]).
 * @param onNavigate the host's router hand-off — receives [NotificationBellPopoverRegistration.INBOX_ROUTE] from
 *   the compact bell tap, every row tap, and "View all" (web `useNavigate`).
 * @param isCompact whether the viewport is compact (web `useIsMobile`); defaults to the live window width.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun NotificationBellPopover(
    source: NotificationBellPopoverSource,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
    isCompact: Boolean = LocalConfiguration.current.screenWidthDp <= COMPACT_WIDTH_DP,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val scope = rememberCoroutineScope()
    val presenter = remember(source, logger, scope) { NotificationBellPopoverPresenter(source, logger, scope) }
    LaunchedEffect(presenter) { presenter.recordViewOpened() }

    val count by presenter.unreadCount.collectAsState()
    val open by presenter.open.collectAsState()
    val preview by presenter.preview.collectAsState()
    val markPending by presenter.markPending.collectAsState()
    val strings = rememberNotificationBellPopoverStrings()

    val triggerLabel =
        if (count > 0) strings.unreadNotificationsTemplate.format(count) else strings.notificationsLabel

    NotificationBellPopoverContent(
        count = count,
        triggerLabel = triggerLabel,
        open = open && !isCompact,
        preview = preview,
        markPending = markPending,
        strings = strings,
        onBellClick = { if (isCompact) onNavigate(NotificationBellPopoverRegistration.INBOX_ROUTE) else presenter.toggle() },
        onDismiss = presenter::dismiss,
        onMarkAllRead = presenter::markAllRead,
        onRetry = presenter::refresh,
        onOpenInbox = {
            presenter.dismiss()
            onNavigate(NotificationBellPopoverRegistration.INBOX_ROUTE)
        },
        modifier = modifier,
    )
}

/**
 * Stateless trigger + anchored-popover host. Renders the bell + badge always; the [Popover] (a focusable Compose
 * `Popup` that dismisses on Back / outside tap) carries the panel while [open]. The popover anchors directly below
 * the trigger's end edge via the measured trigger height.
 */
@Composable
fun NotificationBellPopoverContent(
    count: Int,
    triggerLabel: String,
    open: Boolean,
    preview: NotificationBellPreview,
    markPending: Boolean,
    strings: NotificationBellPopoverStrings,
    onBellClick: () -> Unit,
    onDismiss: () -> Unit,
    onMarkAllRead: () -> Unit,
    onRetry: () -> Unit,
    onOpenInbox: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        var anchorHeightPx by remember { mutableIntStateOf(0) }
        NotificationBellTrigger(
            count = count,
            label = triggerLabel,
            onClick = onBellClick,
            modifier = Modifier.onSizeChanged { anchorHeightPx = it.height },
        )
        Popover(
            expanded = open,
            onDismissRequest = onDismiss,
            alignment = Alignment.TopEnd,
            offset = IntOffset(0, anchorHeightPx),
            accessibleName = strings.title,
        ) {
            NotificationBellPanel(
                preview = preview,
                unreadCount = count,
                markPending = markPending,
                strings = strings,
                onClose = onDismiss,
                onMarkAllRead = onMarkAllRead,
                onOpenInbox = onOpenInbox,
                onRetry = onRetry,
            )
        }
    }
}

/** The bell icon button with an overlaid unread-count badge — web `<button>` + the rose count chip. */
@Composable
private fun NotificationBellTrigger(
    count: Int,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        IconButton(
            imageVector = FeedbackGlyphs.Bell,
            contentDescription = label,
            onClick = onClick,
        )
        if (count > 0) {
            Box(
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = BELL_BADGE_INSET, y = -BELL_BADGE_INSET)
                        .defaultMinSize(minWidth = BELL_BADGE_MIN_SIZE, minHeight = BELL_BADGE_MIN_SIZE)
                        .clip(CircleShape)
                        .background(TeslaTokens.status.danger)
                        .padding(horizontal = BELL_BADGE_INSET)
                        .clearAndSetSemantics {},
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = NotificationBellPopoverProjection.formatBadgeCount(count),
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White,
                )
            }
        }
    }
}

/**
 * The stateless popover panel — the unit/UI-test + preview entry point. Lays out the header (title + unread
 * subtitle + close), the body (every lifecycle state), and the footer ("Mark all read" + "View all"). Stale
 * (non-error) data silently auto-refreshes, mirroring the freshness contract the sibling surfaces use. [now] /
 * [zoneId] fix the display clock for tests; production callers use the device clock.
 */
@Composable
fun NotificationBellPanel(
    preview: NotificationBellPreview,
    unreadCount: Int,
    markPending: Boolean,
    onClose: () -> Unit,
    onMarkAllRead: () -> Unit,
    onOpenInbox: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: NotificationBellPopoverStrings = rememberNotificationBellPopoverStrings(),
    now: Instant = Instant.now(),
    zoneId: ZoneId = ZoneId.systemDefault(),
) {
    val state = preview.state
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    Column(modifier.width(BELL_PANEL_WIDTH)) {
        NotificationBellHeader(unreadCount = unreadCount, strings = strings, onClose = onClose)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Box(Modifier.heightIn(max = BELL_PANEL_BODY_MAX_HEIGHT)) {
            NotificationBellBody(
                preview = preview,
                strings = strings,
                onOpenInbox = onOpenInbox,
                onRetry = onRetry,
                now = now,
                zoneId = zoneId,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        NotificationBellFooter(
            hasLogs = preview.logCount > 0,
            markPending = markPending,
            strings = strings,
            onMarkAllRead = onMarkAllRead,
            onOpenInbox = onOpenInbox,
        )
    }
}

/** The panel header — the title, the unread subtitle (or "All caught up"), and the close button. */
@Composable
private fun NotificationBellHeader(
    unreadCount: Int,
    strings: NotificationBellPopoverStrings,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            PanelTitle(strings.title)
            Caption(if (unreadCount > 0) strings.unreadCountTemplate.format(unreadCount) else strings.allRead)
        }
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = strings.close,
            onClick = onClose,
            size = IconSize.Sm,
        )
    }
}

/** The panel body — dispatches to the matching lifecycle surface; every state renders, never a blank box. */
@Composable
private fun NotificationBellBody(
    preview: NotificationBellPreview,
    strings: NotificationBellPopoverStrings,
    onOpenInbox: () -> Unit,
    onRetry: () -> Unit,
    now: Instant,
    zoneId: ZoneId,
) {
    val state = preview.state
    when {
        state.isLoading -> NotificationBellLoading(strings)
        state.isError -> NotificationBellError(strings, onRetry)
        state.isEmpty -> NotificationBellEmpty(strings)
        else -> NotificationBellContent(preview, strings, onOpenInbox, now, zoneId)
    }
}

/** First-load surface — a centered spinner with the localized "Loading…" label (web `role="status"`). */
@Composable
private fun NotificationBellLoading(strings: NotificationBellPopoverStrings) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        contentAlignment = Alignment.Center,
    ) {
        Spinner(size = SpinnerSize.Sm, label = strings.loading)
    }
}

/** Hard-error surface — the web warning icon + message, plus a retry affordance (the P3 QueryError contract). */
@Composable
private fun NotificationBellError(
    strings: NotificationBellPopoverStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = TeslaGlyphs.Warning,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.danger,
        )
        BodyText(strings.error, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(strings.retry, onClick = onRetry, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
    }
}

/** Empty surface — the friendly "You're all caught up" state with the bell glyph (web empty branch). */
@Composable
private fun NotificationBellEmpty(strings: NotificationBellPopoverStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = FeedbackGlyphs.Bell,
        title = strings.emptyTitle,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The content surface — an optional stale/offline freshness chip above the scrollable preview list. */
@Composable
private fun NotificationBellContent(
    preview: NotificationBellPreview,
    strings: NotificationBellPopoverStrings,
    onOpenInbox: () -> Unit,
    now: Instant,
    zoneId: ZoneId,
) {
    val state = preview.state
    val rows =
        remember(state.data, preview.rulesById, preview.vehiclesById) {
            NotificationBellPopoverProjection.projectRows(
                logs = state.data ?: emptyList(),
                rules = preview.rulesById.values.toList(),
                vehicles = preview.vehiclesById.values.toList(),
            )
        }
    val relativeText = rememberBellRelativeTimeText(zoneId)
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        if (state.stale || state.refreshing || state.hasError) {
            NotificationBellFreshness(preview)
        }
        rows.forEachIndexed { index, row ->
            if (index > 0) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA))
            }
            NotificationBellRow(
                row = row,
                strings = strings,
                onClick = onOpenInbox,
                relativeText = relativeText,
                now = now,
            )
        }
    }
}

/** One preview row — severity dot, title (with untitled fallback), one-line message, relative time + vehicle. */
@Composable
private fun NotificationBellRow(
    row: BellRow,
    strings: NotificationBellPopoverStrings,
    onClick: () -> Unit,
    relativeText: (BellRelativeTime) -> String,
    now: Instant,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        BellSeverityDot(row.severity, strings)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(row.title ?: strings.untitled, maxLines = ROW_TITLE_MAX_LINES)
            row.message?.let { message ->
                BodyText(message, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = ROW_MESSAGE_MAX_LINES)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Caption(relativeText(NotificationBellPopoverProjection.relativeTime(row.timestamp, now)))
                row.vehicleLabel?.let { label -> Caption("\u00B7 $label") }
            }
        }
    }
}

/** The severity dot — a colored circle whose accessible name is the localized severity (web `aria-label`). */
@Composable
private fun BellSeverityDot(
    severity: Severity,
    strings: NotificationBellPopoverStrings,
) {
    val label = bellSeverityLabel(severity, strings)
    Box(
        modifier =
            Modifier
                .padding(top = BELL_DOT_TOP)
                .size(BELL_DOT_SIZE)
                .clip(CircleShape)
                .background(bellSeverityColor(severity))
                .semantics { contentDescription = label },
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the preview rows. */
@Composable
private fun NotificationBellFreshness(preview: NotificationBellPreview) {
    val state = preview.state
    val formatAge = rememberBellFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/** The panel footer — "Mark all read" (disabled with no rows / while pending) and the "View all" escape hatch. */
@Composable
private fun NotificationBellFooter(
    hasLogs: Boolean,
    markPending: Boolean,
    strings: NotificationBellPopoverStrings,
    onMarkAllRead: () -> Unit,
    onOpenInbox: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = strings.markAllRead,
            onClick = onMarkAllRead,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = hasLogs && !markPending,
            loading = markPending,
            leadingIcon = TeslaGlyphs.Check,
        )
        Button(onClick = onOpenInbox, variant = ButtonVariant.Ghost, size = ButtonSize.Sm) {
            Text(strings.viewAll, style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.width(Spacing.xs))
            Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm)
        }
    }
}

// ── Render-only helpers (severity + relative-time, resolved at the Compose boundary) ──────────────────────────

/** The localized severity name used as the dot's accessible label — web `SEVERITY_TONE[sev].label`. */
private fun bellSeverityLabel(
    severity: Severity,
    strings: NotificationBellPopoverStrings,
): String =
    when (severity) {
        Severity.Critical -> strings.severityCritical
        Severity.Warn -> strings.severityWarn
        else -> strings.severityInfo
    }

/** The dot color for a severity — web `SEVERITY_TONE[sev].dot`, mapped onto the shared status palette. */
@Composable
private fun bellSeverityColor(severity: Severity): Color =
    when (severity) {
        Severity.Critical -> TeslaTokens.status.danger
        Severity.Warn -> TeslaTokens.status.warning
        else -> TeslaTokens.status.info
    }

/**
 * Localized formatter for a [BellRelativeTime] — the web `formatRelative` render, resolved through the shared
 * `freshness.*` catalog templates (just now / Xm / Xh / Xd) with an absolute medium date for a week-or-older row.
 */
@Composable
private fun rememberBellRelativeTimeText(zoneId: ZoneId): (BellRelativeTime) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val locale = Locale.getDefault()
    val absolute =
        remember(locale, zoneId) {
            DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zoneId)
        }
    return remember(justNow, minutes, hours, days, absolute) {
        { relative ->
            when (relative) {
                BellRelativeTime.Absent -> EM_DASH
                BellRelativeTime.JustNow -> justNow
                is BellRelativeTime.Minutes -> minutes.format(relative.value)
                is BellRelativeTime.Hours -> hours.format(relative.value)
                is BellRelativeTime.Days -> days.format(relative.value)
                is BellRelativeTime.Absolute -> absolute.format(relative.instant)
            }
        }
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberBellFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

private const val DIVIDER_ALPHA = 0.4f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ────────────────────────────────

private val PREVIEW_NOW: Instant = Instant.parse("2026-06-12T12:00:00Z")

private fun previewLogs(): List<NotificationLog> =
    listOf(
        NotificationLog(
            id = 3,
            alertId = 1,
            title = "Battery low — Model Y",
            message = "State of charge dropped below 20%.",
            createdAt = "2026-06-12T11:58:30Z",
        ),
        NotificationLog(
            id = 2,
            alertId = 2,
            title = "Charging complete",
            message = "Your vehicle finished charging at home.",
            createdAt = "2026-06-12T10:30:00Z",
        ),
        NotificationLog(id = 1, title = "Software update available", createdAt = "2026-06-05T09:00:00Z"),
    )

private fun previewRules(): Map<Long, AlertRule> =
    mapOf(
        1L to AlertRule(id = 1, name = "Low battery", severity = "warn"),
        2L to AlertRule(id = 2, name = "Charge complete", severity = "info"),
    )

private fun previewPreview(state: UiState<List<NotificationLog>>): NotificationBellPreview =
    NotificationBellPreview(state = state, rulesById = previewRules(), vehiclesById = emptyMap())

@Preview(name = "Content — preview rows", showBackground = true, widthDp = 360)
@Composable
private fun NotificationBellContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationBellPanel(
            preview = previewPreview(UiState(UiPhase.Content, previewLogs(), fetchedAt = PREVIEW_NOW.toEpochMilli())),
            unreadCount = previewLogs().size,
            markPending = false,
            onClose = {},
            onMarkAllRead = {},
            onOpenInbox = {},
            onRetry = {},
            now = PREVIEW_NOW,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Empty — all caught up", showBackground = true, widthDp = 360)
@Composable
private fun NotificationBellEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationBellPanel(
            preview = previewPreview(UiState(UiPhase.Empty, emptyList())),
            unreadCount = 0,
            markPending = false,
            onClose = {},
            onMarkAllRead = {},
            onOpenInbox = {},
            onRetry = {},
            now = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun NotificationBellLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationBellPanel(
            preview = previewPreview(UiState.loading()),
            unreadCount = 0,
            markPending = false,
            onClose = {},
            onMarkAllRead = {},
            onOpenInbox = {},
            onRetry = {},
            now = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Error — retry", showBackground = true, widthDp = 360)
@Composable
private fun NotificationBellErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationBellPanel(
            preview = previewPreview(UiState(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network)),
            unreadCount = 0,
            markPending = false,
            onClose = {},
            onMarkAllRead = {},
            onOpenInbox = {},
            onRetry = {},
            now = PREVIEW_NOW,
        )
    }
}
