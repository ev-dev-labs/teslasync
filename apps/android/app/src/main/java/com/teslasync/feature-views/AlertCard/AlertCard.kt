// The native Jetpack Compose + Material 3 AlertCard feature view — a parity port of
// web/src/features/notifications/components/AlertCard.tsx. The web component is a single, purely presentational
// alert row: a severity-tinted GlassPanel holding a type-icon chip, the title + message (the title links to the
// alert's drill-through "context"), an unread StatusDot, a meta line (relative time + a SeverityBadge + the
// humanized type + an "Acknowledged by …" Badge when acknowledged), and a cluster of ghost actions — open the
// context, open the audit timeline, acknowledge / reopen, and mark-read while unread.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the i18n catalog); the host owns the alert and wires the actions
// through [AlertCardActions], exactly like the web callbacks. Because the surface acceptance gate requires every
// lifecycle state to render, the stateful entry takes the host's cache-then-network [UiState] and draws each
// state the shared state-holder layer (P1/S8) can carry — loading skeleton, hard error with retry, empty, the
// loaded card, and stale/offline ("last known") with a freshness chip + auto-refresh — without ever fetching. A
// web-parity overload taking a raw [Alert] is provided for hosts that already hold one.
//
// The icon chip, SeverityBadge, StatusDot, Badge, Button, and feedback states are the faithful counterparts of
// the web shared components. Severity / glyph colors map to design tokens (never raw hex in render code). The
// web Lucide type glyphs the shared icon libraries already provide are reused; the eight that are not (the
// thermometer, settings, droplets, bar-chart, database, hard-drive, radio, and activity glyphs) are authored
// here as 24×24 stroked vectors in the shared monochrome style, since a feature view may not expand the shared
// icon library from a surface prompt (allowed-files) — exactly as the sibling feature-view surfaces do.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertcard

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.datadisplay.StatusDot
import io.teslasync.android.components.datadisplay.normalizeSeverity
import io.teslasync.android.components.datadisplay.severityChipColors
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import java.time.Instant

/** Two lines for the message body — the web `line-clamp-2`. */
private const val MESSAGE_MAX_LINES: Int = 2

/** Pulse cycle for the unread dot, in milliseconds — the web `animate-pulse`, honored only when motion is on. */
private const val UNREAD_PULSE_MS: Int = 900

/** Dimmest alpha of the unread pulse. */
private const val UNREAD_PULSE_MIN_ALPHA: Float = 0.35f

/** Diameter of the unread status dot — the web `h-2 w-2`. */
private val UNREAD_DOT_SIZE: Dp = 8.dp

/** Loading skeleton dimensions, sized so the card never first-paints as a blank box. */
private val SKELETON_CHIP: Dp = 40.dp
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_LINE_HEIGHT: Dp = 10.dp
private val SKELETON_META_HEIGHT: Dp = 12.dp
private val SKELETON_META_WIDTH: Dp = 120.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.65f
private const val SKELETON_LINE_FRACTION: Float = 0.9f

/**
 * The host-supplied actions for an alert row — the native analogue of the web component's callback props. All
 * default to no-ops so previews / the empty + loading states (which render no action) need not supply them.
 *
 * @property onOpenContext open the alert's drill-through context — the web title / "View context" links.
 * @property onOpenDetail open the audit timeline — the web "Audit timeline" action.
 * @property onAcknowledge acknowledge the alert — the web "Acknowledge" action (shown while not acknowledged).
 * @property onReopen reopen an acknowledged alert — the web "Reopened" action (shown while acknowledged).
 * @property onMarkRead mark an unread alert read — the web "Mark read" action (shown while unread).
 */
class AlertCardActions(
    val onOpenContext: () -> Unit = {},
    val onOpenDetail: () -> Unit = {},
    val onAcknowledge: () -> Unit = {},
    val onReopen: () -> Unit = {},
    val onMarkRead: () -> Unit = {},
)

/**
 * Stateful entry point for an alert row. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the shared alert feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`) plus the row [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the alert (the host's loaded `Alert`).
 * @param actions the row callbacks — wired by the host to navigation / mutations.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AlertCard(
    state: UiState<Alert>,
    actions: AlertCardActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAlertCardOpened(logger) }
    AlertCardContent(state = state, actions = actions, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's non-null `alert` prop, for hosts that already hold a loaded
 * alert. Wraps it in a content [UiState] and renders the card — no fetch sits behind it, so it offers no retry
 * affordance. Records `view.opened` like the stateful entry.
 */
@Composable
fun AlertCard(
    alert: Alert,
    actions: AlertCardActions,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(alert) { UiState(phase = UiPhase.Content, data = alert) }
    AlertCard(state = state, actions = actions, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's card
 * exactly for the loaded state and adds the lifecycle chrome the host's feed implies: a loading skeleton, a
 * hard-error retry surface, a friendly empty state, and a freshness chip that reflects refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 * [now] fixes the relative-age clock for tests; the production callers use the real wall clock.
 */
@Composable
fun AlertCardContent(
    state: UiState<Alert>,
    actions: AlertCardActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    strings: AlertCardStrings = rememberAlertCardStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val alert = state.data
    val row =
        remember(alert, strings, now) {
            alert?.let { AlertCardProjection.project(it, strings, now) }
        }
    val accent = if (row != null && !row.isRead) panelAccentFor(row.severity) else PanelAccent.None

    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = accent) {
        when {
            state.isLoading -> AlertCardLoading()
            state.isError -> AlertCardError(onRetry = onRetry)
            row == null -> AlertCardEmpty()
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    AlertCardFreshnessRow(state = state)
                }
                AlertCardBody(row = row, actions = actions, strings = strings)
            }
        }
    }
}

/**
 * The loaded card — the faithful render of the web component. A type-icon chip tinted by severity, the title +
 * two-line message (a single tap target that opens the alert context — the web title link), an unread dot, and
 * the meta + action cluster.
 */
@Composable
private fun AlertCardBody(
    row: AlertCardRow,
    actions: AlertCardActions,
    strings: AlertCardStrings,
) {
    val ageText = rememberRelativeAgeFormatter()(row.age)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        AlertIconChip(glyph = row.glyph, severity = row.severity)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            AlertTitleBlock(row = row, strings = strings, onOpenContext = actions.onOpenContext)
            AlertMetaRow(row = row, actions = actions, strings = strings, ageText = ageText)
        }
    }
}

/**
 * The title + message block, plus the unread dot — the web title `<Link>` (whole block opens the alert context)
 * with the trailing `<StatusDot>`. The block exposes an accessible "View context" click action without hiding
 * the title / message from TalkBack; the read state mutes the title, matching the web `is_read` styling.
 */
@Composable
private fun AlertTitleBlock(
    row: AlertCardRow,
    strings: AlertCardStrings,
    onOpenContext: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable(role = Role.Button, onClickLabel = strings.viewContext, onClick = onOpenContext)
                    .padding(Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(
                text = row.title,
                color = if (row.isRead) MaterialColors.muted() else MaterialColors.primary(),
            )
            BodyText(
                text = row.message,
                color = MaterialColors.muted(),
                maxLines = MESSAGE_MAX_LINES,
            )
        }
        if (!row.isRead) {
            UnreadDot(severity = row.severity, label = strings.unread)
        }
    }
}

/**
 * The wrapping meta + action line — the web `flex-wrap` row. In received order: the clock + relative time, the
 * SeverityBadge (icon-less, the raw severity as its label, like the web), the humanized type, the
 * "Acknowledged by …" Badge when acknowledged, the explicit "View context" action, the "Audit timeline" action,
 * the acknowledge / reopen toggle, and "Mark read" while unread. [FlowRow] reproduces the responsive wrapping.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun AlertMetaRow(
    row: AlertCardRow,
    actions: AlertCardActions,
    strings: AlertCardStrings,
    ageText: String,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(DataDisplayGlyphs.Clock, contentDescription = null, size = IconSize.Xs, tint = MaterialColors.muted())
            Caption(ageText)
        }
        SeverityBadge(severity = row.severity, showIcon = false, size = ChipSize.Sm, label = row.severity)
        Caption(row.typeLabel)
        row.acknowledgedLabel?.let { label ->
            Badge(text = label, variant = BadgeVariant.Success)
        }
        Button(
            label = strings.viewContext,
            onClick = actions.onOpenContext,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.ChevronRight,
        )
        Button(
            label = strings.auditTimeline,
            onClick = actions.onOpenDetail,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = FeedbackGlyphs.Bell,
        )
        if (row.isAcknowledged) {
            Button(
                label = strings.reopened,
                onClick = actions.onReopen,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = FeedbackGlyphs.Refresh,
            )
        } else {
            Button(
                label = strings.acknowledge,
                onClick = actions.onAcknowledge,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = DataDisplayGlyphs.CheckCircle,
            )
        }
        if (!row.isRead) {
            Button(
                label = strings.markRead,
                onClick = actions.onMarkRead,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Eye,
            )
        }
    }
}

/** The severity-tinted, rounded type-icon chip — the web `rounded-xl p-2.5 ring-1` icon container. */
@Composable
private fun AlertIconChip(
    glyph: AlertGlyph,
    severity: String,
) {
    val colors = severityChipColors(normalizeSeverity(severity))
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.md))
                .background(colors.background)
                .border(1.dp, colors.border, RoundedCornerShape(Radius.md))
                .padding(Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyphFor(glyph), contentDescription = null, size = IconSize.Md, tint = colors.foreground)
    }
}

/**
 * The unread status dot — the web `<StatusDot … animate-pulse>`. The pulse runs only when the device is not in
 * reduce-motion mode; otherwise the dot is solid. The [label] exposes its meaning ("Unread") to TalkBack.
 */
@Composable
private fun UnreadDot(
    severity: String,
    label: String,
) {
    val reduceMotion = rememberReducedMotion()
    val transition = rememberInfiniteTransition(label = "alert-unread-pulse")
    val pulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = UNREAD_PULSE_MIN_ALPHA,
        animationSpec = infiniteRepeatable(animation = tween(UNREAD_PULSE_MS), repeatMode = RepeatMode.Reverse),
        label = "alert-unread-pulse-alpha",
    )
    StatusDot(
        severity = severity,
        modifier = Modifier.alpha(if (reduceMotion) 1f else pulse),
        label = label,
        size = UNREAD_DOT_SIZE,
    )
}

/** First-load skeleton — a chip + title/message lines + a meta bar so the card is never blank while loading. */
@Composable
private fun AlertCardLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(modifier = Modifier.size(SKELETON_CHIP), rounded = true)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
            Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT)
            Skeleton(modifier = Modifier.width(SKELETON_META_WIDTH), height = SKELETON_META_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AlertCardError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — a friendly state shown when the host resolved no alert, never a blank box. */
@Composable
private fun AlertCardEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = FeedbackGlyphs.Bell,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the card body. */
@Composable
private fun AlertCardFreshnessRow(state: UiState<Alert>) {
    val formatAge = rememberAlertCardFreshnessFormatter()
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

/** Maps a raw severity to the GlassPanel accent used for the unread tint — the web `tokens.border` + `tokens.bg`. */
private fun panelAccentFor(severity: String): PanelAccent =
    when (normalizeSeverity(severity)) {
        io.teslasync.android.components.datadisplay.Severity.Critical -> PanelAccent.Danger
        io.teslasync.android.components.datadisplay.Severity.Warn -> PanelAccent.Warning
        io.teslasync.android.components.datadisplay.Severity.Success -> PanelAccent.Success
        io.teslasync.android.components.datadisplay.Severity.Info -> PanelAccent.Info
    }

/** The concrete vector for an [AlertGlyph]; falls back to the notifications bell should a kind ever lack one. */
private fun glyphFor(glyph: AlertGlyph): ImageVector = GLYPH_VECTORS[glyph] ?: FeedbackGlyphs.Bell

// ── Theme-resolved text colors ────────────────────────────────────────────────────────────────────────────
// The web title switches between `--text-primary` (unread) and `--text-secondary` (read); the message + meta
// use `--text-muted`. These map to the Material scheme so light / dark / high-contrast all stay correct.
private object MaterialColors {
    @Composable
    fun primary(): Color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface

    @Composable
    fun muted(): Color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
}

// ── i18n facade (P1/S10) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [AlertCardStrings] from the i18n catalog (P1/S10): the `alerts.*` keys the web component
 * reads plus the unread / mark-read labels. The actor-interpolated acknowledged variant resolves through
 * `Context.getString` so the `%1$s` argument is filled by the catalog.
 */
@Composable
private fun rememberAlertCardStrings(): AlertCardStrings {
    val context = LocalContext.current
    val viewContext = stringResource(R.string.translation_alerts_viewContext)
    val unread = stringResource(R.string.translation_Unread)
    val auditTimeline = stringResource(R.string.translation_alerts_timeline_title)
    val acknowledge = stringResource(R.string.translation_alerts_ack_button)
    val reopened = stringResource(R.string.translation_alerts_timeline_kindAnonymous_reopened)
    val markRead = stringResource(R.string.translation_notifications_inbox_bulk_markRead)
    val acknowledgedAnonymous = stringResource(R.string.translation_alerts_ack_ackedByAnonymous)
    return remember(viewContext, unread, auditTimeline, acknowledge, reopened, markRead, acknowledgedAnonymous, context) {
        AlertCardStrings(
            viewContext = viewContext,
            unread = unread,
            auditTimeline = auditTimeline,
            acknowledge = acknowledge,
            reopened = reopened,
            markRead = markRead,
            acknowledgedAnonymous = acknowledgedAnonymous,
            acknowledgedByActor = { actor ->
                context.getString(R.string.translation_alerts_ack_ackedBy, actor)
            },
        )
    }
}

/**
 * Localized formatter for the relative `created_at` age — the web `getTimeAgo`. Reuses the `translation_freshness_*`
 * catalog strings (`"%1$sm/h/d ago"`), so the rendered text matches the web verbatim. A `null` age (unparseable
 * timestamp) renders the [EM_DASH] fallback.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (RelativeAge?) -> String {
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return remember(minutes, hours, days) {
        { age ->
            when (age) {
                null -> EM_DASH
                is RelativeAge.Minutes -> minutes.format(age.value)
                is RelativeAge.Hours -> hours.format(age.value)
                is RelativeAge.Days -> days.format(age.value)
            }
        }
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberAlertCardFreshnessFormatter(): (FreshnessAge) -> String {
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
// The eight web type glyphs the shared icon libraries do not provide, authored as 24×24 round-capped stroked
// vectors in the shared monochrome style and recolored at render time by the `Icon` tint.

/** Web `Icons.climate` (lucide `Thermometer`) — a stem with a bulb. */
private val ThermometerGlyph: ImageVector =
    strokedGlyph("Thermometer") {
        moveTo(12f, 4.5f)
        lineTo(12f, 14.5f)
        circle(12f, 17.5f, 3.2f)
    }

/** Web `Icons.settingsAlt` (lucide `Settings2`) — two horizontal sliders with knobs. */
private val SettingsGlyph: ImageVector =
    strokedGlyph("Settings2") {
        moveTo(4f, 8f)
        lineTo(20f, 8f)
        moveTo(4f, 16f)
        lineTo(20f, 16f)
        circle(9f, 8f, 2f)
        circle(15f, 16f, 2f)
    }

/** Web `Icons.droplets` (lucide `Droplets`) — a single rounded droplet. */
private val DropletsGlyph: ImageVector =
    strokedGlyph("Droplets") {
        moveTo(12f, 4f)
        curveTo(12f, 4f, 7f, 11f, 7f, 14.5f)
        curveTo(7f, 17.5f, 9.2f, 20f, 12f, 20f)
        curveTo(14.8f, 20f, 17f, 17.5f, 17f, 14.5f)
        curveTo(17f, 11f, 12f, 4f, 12f, 4f)
        close()
    }

/** Web `Icons.analytics` (lucide `BarChart3`) — a baseline with three rising bars. */
private val BarChartGlyph: ImageVector =
    strokedGlyph("BarChart3") {
        moveTo(4f, 20f)
        lineTo(20f, 20f)
        moveTo(7f, 20f)
        lineTo(7f, 13f)
        moveTo(12f, 20f)
        lineTo(12f, 9f)
        moveTo(17f, 20f)
        lineTo(17f, 5f)
    }

/** Web `Icons.database` (lucide `Database`) — a stacked cylinder. */
private val DatabaseGlyph: ImageVector =
    strokedGlyph("Database") {
        moveTo(5f, 6f)
        arcTo(7f, 2.5f, 0f, false, true, 19f, 6f)
        arcTo(7f, 2.5f, 0f, false, true, 5f, 6f)
        close()
        moveTo(5f, 6f)
        lineTo(5f, 18f)
        arcTo(7f, 2.5f, 0f, false, false, 19f, 18f)
        lineTo(19f, 6f)
        moveTo(5f, 12f)
        arcTo(7f, 2.5f, 0f, false, false, 19f, 12f)
    }

/** Web `Icons.hardDrive` (lucide `HardDrive`) — a horizontal drive bay with an LED + slot. */
private val HardDriveGlyph: ImageVector =
    strokedGlyph("HardDrive") {
        rect(3f, 8f, 21f, 16f)
        moveTo(14f, 12f)
        lineTo(18f, 12f)
        dot(7f, 12f)
    }

/** Web `Icons.radio` (lucide `Radio`) — a broadcast dot with radiating arcs. */
private val RadioGlyph: ImageVector =
    strokedGlyph("Radio") {
        circle(12f, 12f, 1.6f)
        moveTo(8.2f, 8.2f)
        arcTo(5.4f, 5.4f, 0f, false, false, 8.2f, 15.8f)
        moveTo(15.8f, 8.2f)
        arcTo(5.4f, 5.4f, 0f, false, true, 15.8f, 15.8f)
        moveTo(5.5f, 5.5f)
        arcTo(9.2f, 9.2f, 0f, false, false, 5.5f, 18.5f)
        moveTo(18.5f, 5.5f)
        arcTo(9.2f, 9.2f, 0f, false, true, 18.5f, 18.5f)
    }

/** Web `Icons.efficiency` (lucide `Activity`) — an ECG pulse line. */
private val ActivityGlyph: ImageVector =
    strokedGlyph("Activity") {
        moveTo(3f, 12f)
        lineTo(8f, 12f)
        lineTo(10.5f, 5f)
        lineTo(13.5f, 19f)
        lineTo(16f, 12f)
        lineTo(21f, 12f)
    }

/**
 * Maps every [AlertGlyph] to its concrete vector — shared library glyphs where available, else a local glyph.
 * Declared after the local glyph vals above so their initializers run first (top-level val order).
 */
private val GLYPH_VECTORS: Map<AlertGlyph, ImageVector> =
    mapOf(
        AlertGlyph.Location to DataDisplayGlyphs.MapPin,
        AlertGlyph.Battery to DataDisplayGlyphs.Battery,
        AlertGlyph.Charging to DataDisplayGlyphs.Bolt,
        AlertGlyph.Security to DataDisplayGlyphs.Shield,
        AlertGlyph.Speed to DataDisplayGlyphs.Gauge,
        AlertGlyph.Climate to ThermometerGlyph,
        AlertGlyph.SoftwareUpdate to SettingsGlyph,
        AlertGlyph.VampireDrain to DataDisplayGlyphs.TrendingDown,
        AlertGlyph.TirePressure to DropletsGlyph,
        AlertGlyph.Locked to DataDisplayGlyphs.Lock,
        AlertGlyph.Analytics to BarChartGlyph,
        AlertGlyph.Database to DatabaseGlyph,
        AlertGlyph.Mqtt to DataDisplayGlyphs.Wifi,
        AlertGlyph.Storage to HardDriveGlyph,
        AlertGlyph.Radio to RadioGlyph,
        AlertGlyph.Worker to ActivityGlyph,
        AlertGlyph.Notification to FeedbackGlyphs.Bell,
    )

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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

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

/** A round-capped near-zero-length segment that renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

private val previewActions = AlertCardActions()

@Preview(showBackground = true)
@Composable
private fun AlertCardUnreadPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertCardContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        Alert(
                            id = 1,
                            type = "low_battery",
                            severity = "warning",
                            title = "Battery low",
                            message = "State of charge dropped below 20% while parked.",
                            isRead = false,
                            createdAt = "2026-04-04T14:30:00Z",
                        ),
                ),
            actions = previewActions,
            onRetry = {},
            now = Instant.parse("2026-04-04T15:15:00Z"),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun AlertCardAcknowledgedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertCardContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        Alert(
                            id = 2,
                            type = "sentry_event",
                            severity = "critical",
                            title = "Sentry event detected",
                            message = "Motion recorded near the front-left camera.",
                            isRead = true,
                            createdAt = "2026-04-03T09:00:00Z",
                            acknowledgedAt = "2026-04-03T09:05:00Z",
                            acknowledgedBy = "Atul",
                        ),
                ),
            actions = previewActions,
            onRetry = {},
            now = Instant.parse("2026-04-04T15:15:00Z"),
        )
    }
}
