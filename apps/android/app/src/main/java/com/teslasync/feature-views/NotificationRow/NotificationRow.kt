// The native Jetpack Compose + Material 3 NotificationRow feature view — a parity port of
// web/src/features/notifications/components/NotificationRow.tsx. The web component is a single, purely
// presentational inbox row: a selection checkbox, a SeverityBadge, the timestamp, an optional vehicle name +
// rule name, the title (muted when read), an optional one-line message, and a cluster of quick actions —
// mark-read / mark-unread, archive / unarchive, and a drill-through "View context" link (shown only when a
// rule is matched). Unread rows get a severity-tinted accent, the native analogue of the web left-edge bar.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the i18n catalog); the host owns the NotificationLog (plus the
// optional matching rule + vehicle) and wires the actions through [NotificationRowActions], exactly like the web
// callbacks. Because the surface acceptance gate requires every lifecycle state to render, the stateful entry
// takes the host's cache-then-network [UiState] and draws each state the shared state-holder layer (P1/S8) can
// carry — loading skeleton, hard error with retry, empty, the loaded row, and stale/offline ("last known") with
// a freshness chip + auto-refresh — without ever fetching. A web-parity overload taking the raw props is
// provided for hosts that already hold a NotificationLog.
//
// The checkbox, SeverityBadge, icon actions, Button, and feedback states are faithful counterparts of the web
// shared components. Severity maps to design tokens (never raw hex in render code). The web Lucide action glyphs
// the shared icon libraries already provide are reused (the chevron); the four envelope/archive glyphs that are
// not are authored here as 24×24 stroked vectors in the shared monochrome style, since a feature view may not
// expand the shared icon library from a surface prompt (allowed-files) — exactly as the sibling surfaces do.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationrow

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.datadisplay.normalizeSeverity
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/** One line for the message body — the web `line-clamp-1`. */
private const val MESSAGE_MAX_LINES: Int = 1

/** Two lines for the title — a mobile-readable adaptation of the web single-line `truncate`. */
private const val TITLE_MAX_LINES: Int = 2

/** Loading skeleton dimensions, sized so the row never first-paints as a blank box. */
private val SKELETON_CHECKBOX: Dp = 20.dp
private val SKELETON_META_HEIGHT: Dp = 12.dp
private val SKELETON_META_WIDTH: Dp = 140.dp
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_LINE_HEIGHT: Dp = 10.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.7f
private const val SKELETON_LINE_FRACTION: Float = 0.9f

/** Icon size for the compact per-row action affordances. */
private val ACTION_ICON_SIZE: IconSize = IconSize.Sm

/**
 * The host-supplied actions for an inbox row — the native analogue of the web component's callback props. The
 * mutation callbacks are nullable so the host opts each action in exactly like the web (`onMarkRead && …`); a
 * `null` callback hides that affordance. [onSelectionChange] / [onActivate] default to no-ops so previews and the
 * empty / loading states (which render no action) need not supply them.
 *
 * @property onSelectionChange toggles this row's selection — the web checkbox `onSelectionChange(id, checked)`.
 * @property onActivate opens the notification — the web row-body `onClick` → `onActivate(log)`.
 * @property onMarkRead marks an unread row read — the web "Mark as read" action (shown while unread).
 * @property onMarkUnread marks a read row unread — the web "Mark as unread" action (shown while read).
 * @property onArchive archives a row — the web "Archive" action (shown while not archived).
 * @property onUnarchive restores an archived row — the web "Restore" action (shown while archived).
 * @property onViewContext opens the alert drill-through — the web "View context" link (shown when a rule matched).
 */
data class NotificationRowActions(
    val onSelectionChange: (Boolean) -> Unit = {},
    val onActivate: () -> Unit = {},
    val onMarkRead: (() -> Unit)? = null,
    val onMarkUnread: (() -> Unit)? = null,
    val onArchive: (() -> Unit)? = null,
    val onUnarchive: (() -> Unit)? = null,
    val onViewContext: (() -> Unit)? = null,
)

/**
 * Stateful entry point for an inbox row. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the shared inbox feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`) plus the row [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the row's inputs (log + optional rule + optional vehicle).
 * @param selected whether this row is currently selected — the web `selected` prop.
 * @param actions the row callbacks — wired by the host to selection / navigation / mutations.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun NotificationRow(
    state: UiState<NotificationRowInput>,
    selected: Boolean,
    actions: NotificationRowActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordNotificationRowOpened(logger) }
    NotificationRowContent(
        state = state,
        selected = selected,
        actions = actions,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's required `log` prop (plus the optional `rule` / `vehicle`
 * context), for hosts that already hold a loaded row. Wraps the inputs in a content [UiState] and renders the
 * row — no fetch sits behind it, so it offers no retry affordance. Records `view.opened` like the stateful entry.
 */
@Composable
fun NotificationRow(
    log: NotificationLog,
    selected: Boolean,
    actions: NotificationRowActions,
    modifier: Modifier = Modifier,
    rule: AlertRule? = null,
    vehicle: Vehicle? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(log, rule, vehicle) {
            UiState(phase = UiPhase.Content, data = NotificationRowInput(log, rule, vehicle))
        }
    NotificationRow(
        state = state,
        selected = selected,
        actions = actions,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's row
 * exactly for the loaded state and adds the lifecycle chrome the host's feed implies: a loading skeleton, a
 * hard-error retry surface, a friendly empty state, and a freshness chip that reflects refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 * [zoneId] fixes the display zone for tests; production callers use the device zone.
 */
@Composable
fun NotificationRowContent(
    state: UiState<NotificationRowInput>,
    selected: Boolean,
    actions: NotificationRowActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: NotificationRowStrings = rememberNotificationRowStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val input = state.data
    val row = remember(input) { input?.let { NotificationRowProjection.project(it) } }
    val accent = if (row != null && !row.isRead) panelAccentFor(row.severity) else PanelAccent.None

    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = accent) {
        when {
            state.isLoading -> NotificationRowLoading()
            state.isError -> NotificationRowError(onRetry = onRetry)
            row == null -> NotificationRowEmpty()
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    NotificationRowFreshnessRow(state = state)
                }
                NotificationRowBody(row = row, selected = selected, actions = actions, strings = strings, zoneId = zoneId)
            }
        }
    }
}

/**
 * The loaded row — the faithful render of the web component. A leading selection checkbox, the tappable body
 * (meta line + title + one-line message) that opens the notification, and the trailing quick-action cluster.
 */
@Composable
private fun NotificationRowBody(
    row: NotificationRowData,
    selected: Boolean,
    actions: NotificationRowActions,
    strings: NotificationRowStrings,
    zoneId: ZoneId,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Checkbox(
            checked = selected,
            onCheckedChange = actions.onSelectionChange,
            modifier = Modifier.semantics { contentDescription = strings.select },
        )
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .clickable(onClick = actions.onActivate)
                    .padding(vertical = Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            NotificationRowMeta(row = row, zoneId = zoneId)
            BodyText(
                text = row.title,
                color =
                    if (row.isRead) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                maxLines = TITLE_MAX_LINES,
            )
            row.message?.let { message ->
                BodyText(text = message, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = MESSAGE_MAX_LINES)
            }
        }
        NotificationRowActionCluster(row = row, actions = actions, strings = strings)
    }
}

/**
 * The wrapping meta line — the web `flex-wrap` row. In received order: the SeverityBadge (icon-less, the raw
 * severity as its label, like the web), the absolute timestamp, the vehicle name when known, and the rule name
 * when known. [FlowRow] reproduces the responsive wrapping.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotificationRowMeta(
    row: NotificationRowData,
    zoneId: ZoneId,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        val zone = NotificationRowProjection.resolveZone(row.timezone, zoneId)
        SeverityBadge(severity = row.severity, showIcon = false, size = ChipSize.Sm, label = row.severity)
        Caption(NotificationRowProjection.formatTimestamp(row.timestamp, zone, Locale.getDefault()))
        row.vehicleLabel?.let { label -> Caption("\u00B7 $label") }
        row.ruleName?.let { name -> Caption("\u00B7 $name") }
    }
}

/**
 * The trailing quick-action cluster — the web hover-revealed controls, always visible on touch. Each affordance
 * appears only when its state matches and the host opted it in (a non-null callback), exactly like the web. The
 * "View context" link collapses to its chevron icon, mirroring the web `hidden sm:inline` small-screen render;
 * its [contentDescription] carries the localized label so TalkBack still announces "View context".
 */
@Composable
private fun NotificationRowActionCluster(
    row: NotificationRowData,
    actions: NotificationRowActions,
    strings: NotificationRowStrings,
) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.none), verticalAlignment = Alignment.Top) {
        if (!row.isRead) {
            actions.onMarkRead?.let { onClick ->
                IconButton(MailOpenGlyph, strings.markRead, onClick, size = ACTION_ICON_SIZE, tint = tint)
            }
        }
        if (row.isRead) {
            actions.onMarkUnread?.let { onClick ->
                IconButton(MailGlyph, strings.markUnread, onClick, size = ACTION_ICON_SIZE, tint = tint)
            }
        }
        if (!row.isArchived) {
            actions.onArchive?.let { onClick ->
                IconButton(ArchiveGlyph, strings.archive, onClick, size = ACTION_ICON_SIZE, tint = tint)
            }
        }
        if (row.isArchived) {
            actions.onUnarchive?.let { onClick ->
                IconButton(ArchiveRestoreGlyph, strings.unarchive, onClick, size = ACTION_ICON_SIZE, tint = tint)
            }
        }
        if (row.hasDrillthrough) {
            actions.onViewContext?.let { onClick ->
                IconButton(TeslaGlyphs.ChevronRight, strings.viewContext, onClick, size = ACTION_ICON_SIZE, tint = tint)
            }
        }
    }
}

/** First-load skeleton — a checkbox box + meta/title/message lines so the row is never blank while loading. */
@Composable
private fun NotificationRowLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(modifier = Modifier.size(SKELETON_CHECKBOX), rounded = true)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(modifier = Modifier.width(SKELETON_META_WIDTH), height = SKELETON_META_HEIGHT, rounded = true)
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
            Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun NotificationRowError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — a friendly state shown when the host resolved no row, never a blank box. */
@Composable
private fun NotificationRowEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = FeedbackGlyphs.Bell,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the row body. */
@Composable
private fun NotificationRowFreshnessRow(state: UiState<NotificationRowInput>) {
    val formatAge = rememberNotificationRowFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
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

/** Maps a raw severity to the GlassPanel accent used for the unread tint — the web left-edge accent bar. */
private fun panelAccentFor(severity: String): PanelAccent =
    when (normalizeSeverity(severity)) {
        Severity.Critical -> PanelAccent.Danger
        Severity.Warn -> PanelAccent.Warning
        Severity.Success -> PanelAccent.Success
        Severity.Info -> PanelAccent.Info
    }

// ── i18n facade (P1/S10) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [NotificationRowStrings] from the i18n catalog (P1/S10): the
 * `notifications.inbox.row.*` keys the web component reads plus the shared `alerts.viewContext` label.
 */
@Composable
private fun rememberNotificationRowStrings(): NotificationRowStrings {
    val select = stringResource(R.string.translation_notifications_inbox_row_select)
    val markRead = stringResource(R.string.translation_notifications_inbox_row_markRead)
    val markUnread = stringResource(R.string.translation_notifications_inbox_row_markUnread)
    val archive = stringResource(R.string.translation_notifications_inbox_row_archive)
    val unarchive = stringResource(R.string.translation_notifications_inbox_row_unarchive)
    val viewContext = stringResource(R.string.translation_alerts_viewContext)
    return remember(select, markRead, markUnread, archive, unarchive, viewContext) {
        NotificationRowStrings(
            select = select,
            markRead = markRead,
            markUnread = markUnread,
            archive = archive,
            unarchive = unarchive,
            viewContext = viewContext,
        )
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberNotificationRowFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Local Lucide glyphs ───────────────────────────────────────────────────────────────────────────────────
// The four web action glyphs the shared icon libraries do not provide, authored as 24×24 round-capped stroked
// vectors in the shared monochrome style and recolored at render time by the `Icon` tint. (The chevron the
// drill-through uses already ships in TeslaGlyphs.)

/** Web `Mail` (lucide) — a closed envelope: a body rectangle with the flap "V". Marks a read row unread. */
private val MailGlyph: ImageVector =
    strokedGlyph("Mail") {
        rect(3f, 5f, 21f, 19f)
        moveTo(3f, 6.5f)
        lineTo(12f, 12.5f)
        lineTo(21f, 6.5f)
    }

/** Web `MailOpen` (lucide) — an opened envelope: a peaked top over the body. Marks an unread row read. */
private val MailOpenGlyph: ImageVector =
    strokedGlyph("MailOpen") {
        moveTo(3f, 9f)
        lineTo(12f, 3f)
        lineTo(21f, 9f)
        lineTo(21f, 19f)
        lineTo(3f, 19f)
        close()
        moveTo(3f, 9f)
        lineTo(12f, 14f)
        lineTo(21f, 9f)
    }

/** Web `Archive` (lucide) — a lidded box with a handle slot. Archives a row. */
private val ArchiveGlyph: ImageVector =
    strokedGlyph("Archive") {
        rect(3f, 4f, 21f, 8f)
        moveTo(5f, 8f)
        lineTo(5f, 20f)
        lineTo(19f, 20f)
        lineTo(19f, 8f)
        moveTo(10f, 12f)
        lineTo(14f, 12f)
    }

/** Web `ArchiveRestore` (lucide) — a lidded box with an up arrow. Restores an archived row. */
private val ArchiveRestoreGlyph: ImageVector =
    strokedGlyph("ArchiveRestore") {
        rect(3f, 4f, 21f, 8f)
        moveTo(5f, 8f)
        lineTo(5f, 20f)
        lineTo(19f, 20f)
        lineTo(19f, 8f)
        moveTo(12f, 18f)
        lineTo(12f, 11f)
        moveTo(9.5f, 13.5f)
        lineTo(12f, 11f)
        lineTo(14.5f, 13.5f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

private fun previewLog(
    title: String,
    message: String,
    read: Boolean,
    archived: Boolean,
): NotificationLog =
    NotificationLog(
        id = 1,
        title = title,
        message = message,
        severity = "warning",
        createdAt = "2026-04-04T14:30:00Z",
        readAt = if (read) "2026-04-04T14:45:00Z" else null,
        archivedAt = if (archived) "2026-04-04T15:00:00Z" else null,
    )

private val previewRule: AlertRule = AlertRule(id = 7, name = "Battery low", severity = "warning", signalName = "BatteryLevel")

private val previewVehicle: Vehicle =
    Vehicle(
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
        displayName = "Model 3",
        enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
        id = 2,
        teslaId = 1002,
        timezone = "America/Los_Angeles",
        updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
        vin = "VIN2",
    )

private val previewActions =
    NotificationRowActions(
        onMarkRead = {},
        onMarkUnread = {},
        onArchive = {},
        onUnarchive = {},
        onViewContext = {},
    )

private fun previewState(
    title: String,
    message: String,
    read: Boolean,
    archived: Boolean,
): UiState<NotificationRowInput> =
    UiState(
        phase = UiPhase.Content,
        data = NotificationRowInput(previewLog(title, message, read, archived), previewRule, previewVehicle),
    )

@Preview(showBackground = true)
@Composable
private fun NotificationRowUnreadPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationRowContent(
            state = previewState("Battery low", "State of charge dropped below 20% while parked.", read = false, archived = false),
            selected = false,
            actions = previewActions,
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun NotificationRowReadArchivedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NotificationRowContent(
            state = previewState("Charging complete", "Charging finished at 80%.", read = true, archived = true),
            selected = true,
            actions = previewActions,
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}
