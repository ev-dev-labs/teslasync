package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.diagnostics.Telemetry
import io.teslasync.shared.core.diagnostics.TelemetryEvent
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.OffsetDateTime

/*
 * AutomationStatusWidget — the native Android (Jetpack Compose + Material 3) port of the web
 * dashboard widget `web/src/features/dashboard/widgets/AutomationStatusWidget.tsx`.
 *
 * It binds the shared P1/S8 [AutomationsStore] (the KMP port of the web `useAutomations` /
 * `useToggleAutomation` hooks) and renders the active automations: a summary line (active /
 * failing / auto-disabled) plus a per-row last-run time, a success/fail status badge, and the
 * next scheduled run — with an inline enable/disable toggle on wide layouts. Every render branch
 * the web source has is reproduced (compact 1×1, full list, plus loading / empty / error /
 * stale / offline). No networking lives in the view: the store owns it (ADR-002 / ADR-013).
 */

// ── Registry metadata (canonical — mirrors web/src/features/dashboard/widgets/registry/automations.ts) ──

/** Stable surface slug emitted to telemetry (the diagnostics screen name). */
private const val SURFACE_SLUG = "AutomationStatusWidget"

/**
 * The dashboard-widget descriptor for this surface. A dashboard grid host registers it with the
 * canonical [ID] and honours the [minSize] / [maxSize] constraints, exactly like the web registry
 * entry (`automation-status`, default 2×4, min 1×2, max 4×40).
 */
public object AutomationStatusWidgetDescriptor {
    public const val ID: String = "automation-status"
    public const val CATEGORY: String = "automations"
    public val defaultSize: DashboardWidgetSize = DashboardWidgetSize(cols = 2, rows = 4)
    public val minSize: DashboardWidgetSize = DashboardWidgetSize(cols = 1, rows = 2)
    public val maxSize: DashboardWidgetSize = DashboardWidgetSize(cols = 4, rows = 40)
}

/**
 * A dashboard panel's size in grid units — the Android analogue of the web `WidgetSize`
 * (`{ cols, rows }`). [cols] is 1‑4; [rows] is clamped to the descriptor constraints by
 * [coerceToConstraints].
 */
public data class DashboardWidgetSize(
    val cols: Int,
    val rows: Int,
)

/** Compact chrome (web `isCompact`): a single-cell-tall or single-cell-wide panel. */
internal fun DashboardWidgetSize.isCompact(): Boolean = cols <= 1 || rows <= 1

/** Wide chrome (web `isWide`): room for the inline per-row toggle. */
internal fun DashboardWidgetSize.isWide(): Boolean = cols >= COLS_WIDE

/** Whether the title/icon header is shown (web hides it only on a 1‑wide panel). */
internal fun DashboardWidgetSize.showsHeader(): Boolean = !(isCompact() && cols <= 1)

/** Clamps a requested size into the descriptor's [min, max] grid constraints. */
internal fun DashboardWidgetSize.coerceToConstraints(): DashboardWidgetSize {
    val min = AutomationStatusWidgetDescriptor.minSize
    val max = AutomationStatusWidgetDescriptor.maxSize
    return DashboardWidgetSize(cols = cols.coerceIn(min.cols, max.cols), rows = rows.coerceIn(min.rows, max.rows))
}

// ── Pure domain projection (cached → projection); unit-tested off-device ──────────────────────

/** The status lane an automation row resolves to — the port of the web `getStatusBadge` priority. */
public enum class AutomationStatusKind { AutoDisabled, Disabled, Failing, Ok, Idle }

/**
 * Resolves the status badge lane for [automation], matching the web `getStatusBadge` precedence:
 * auto-disabled ▸ disabled ▸ failing (consecutive failures) ▸ ok (a prior success) ▸ idle.
 */
public fun automationStatusKind(automation: Automation): AutomationStatusKind =
    when {
        automation.autoDisabled -> AutomationStatusKind.AutoDisabled
        !automation.enabled -> AutomationStatusKind.Disabled
        automation.consecutiveFailures > 0 -> AutomationStatusKind.Failing
        automation.lastSuccessAt != null -> AutomationStatusKind.Ok
        else -> AutomationStatusKind.Idle
    }

/** The summary counts shown above the list / in the compact tile (web `enabled` / `failing` / auto-disabled). */
public data class AutomationSummary(
    val total: Int,
    val enabled: Int,
    val failing: Int,
    val autoDisabled: Int,
)

/**
 * Folds a list of automations into its [AutomationSummary]. `failing` counts only enabled rows
 * with consecutive failures (web `consecutive_failures > 0 && a.enabled`); `autoDisabled` counts
 * the auto-disabled rows.
 */
public fun automationSummary(automations: List<Automation>): AutomationSummary =
    AutomationSummary(
        total = automations.size,
        enabled = automations.count { it.enabled },
        failing = automations.count { it.consecutiveFailures > 0 && it.enabled },
        autoDisabled = automations.count { it.autoDisabled },
    )

/** A coarse relative-age bucket — the i18n-friendly port of the web `formatRelativeTime`. */
public sealed interface AutomationRelativeAge {
    /** No timestamp available → renders the em-dash. */
    public data object Unknown : AutomationRelativeAge

    /** Under a minute (or a future instant) → "Just now". */
    public data object JustNow : AutomationRelativeAge

    public data class Minutes(
        val value: Long,
    ) : AutomationRelativeAge

    public data class Hours(
        val value: Long,
    ) : AutomationRelativeAge

    public data class Days(
        val value: Long,
    ) : AutomationRelativeAge
}

/**
 * Buckets the age of [epochMillis] relative to [nowMillis] exactly as the web `formatRelativeTime`
 * does: < 1 min → just-now, < 60 min → minutes, < 24 h → hours, else days. A `null` timestamp is
 * [AutomationRelativeAge.Unknown].
 */
public fun automationRelativeAge(
    epochMillis: Long?,
    nowMillis: Long,
): AutomationRelativeAge =
    when {
        epochMillis == null -> AutomationRelativeAge.Unknown
        else -> bucketAge((nowMillis - epochMillis) / MILLIS_PER_MINUTE)
    }

private fun bucketAge(minutes: Long): AutomationRelativeAge =
    when {
        minutes < 1 -> AutomationRelativeAge.JustNow
        minutes < MINUTES_PER_HOUR -> AutomationRelativeAge.Minutes(minutes)
        minutes < MINUTES_PER_DAY -> AutomationRelativeAge.Hours(minutes / MINUTES_PER_HOUR)
        else -> AutomationRelativeAge.Days(minutes / MINUTES_PER_DAY)
    }

/**
 * Parses an ISO-8601 / RFC-3339 timestamp (with or without an explicit offset) to epoch millis,
 * the Android analogue of the web `new Date(dateStr).getTime()`. Returns `null` for a blank or
 * unparseable value so the caller renders the em-dash instead of crashing.
 */
internal fun parseIsoMillis(value: String?): Long? =
    value?.takeIf { it.isNotBlank() }?.let { raw ->
        runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(raw).toEpochMilli() }
            .getOrNull()
    }

/** The typed view-opened diagnostics event (P1/S11), surfaced as a pure builder for testability. */
internal fun automationStatusViewOpenedEvent(appVersion: String): TelemetryEvent.ScreenView =
    TelemetryEvent.ScreenView(screen = SURFACE_SLUG, platform = "android", appVersion = appVersion)

private fun AutomationStatusKind.toBadgeVariant(): BadgeVariant =
    when (this) {
        AutomationStatusKind.AutoDisabled -> BadgeVariant.Danger
        AutomationStatusKind.Disabled -> BadgeVariant.Neutral
        AutomationStatusKind.Failing -> BadgeVariant.Warning
        AutomationStatusKind.Ok -> BadgeVariant.Success
        AutomationStatusKind.Idle -> BadgeVariant.Neutral
    }

/** Maps the Android [UiState] failure classification onto a [QueryErrorKind] for the error surface. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

// ── Stateful entry — binds the shared P1/S8 store (ADR-002: the view never touches HTTP) ──────

/**
 * The host entry point: binds the shared [store] to the dashboard surface, emits the P1/S11
 * `view.opened` diagnostics on first composition, and renders [AutomationStatusWidgetContent].
 * A dashboard grid host supplies the [store], the [size] it allotted the panel, and the optional
 * [telemetry] / [logger] (ADR-016). Reads stream a cache-then-network resource; the toggle calls
 * the store's mutation, which refreshes the list (web `useToggleAutomation`).
 */
@Composable
public fun AutomationStatusWidget(
    store: AutomationsStore,
    size: DashboardWidgetSize,
    modifier: Modifier = Modifier,
    telemetry: Telemetry? = null,
    logger: Logger? = null,
    scope: CoroutineScope = rememberCoroutineScope(),
) {
    LaunchedEffect(store) {
        logger?.info("view.opened", mapOf("surface" to SURFACE_SLUG))
        telemetry?.track(automationStatusViewOpenedEvent(BuildConfig.VERSION_NAME))
    }

    val feed = remember(store) { store.automations() }
    val resource by feed.collectAsStateWithLifecycle()
    val state = remember(resource) { resource.toUiState() }

    AutomationStatusWidgetContent(
        state = state,
        size = size,
        onToggle = { id, enabled -> scope.launch { store.toggleAutomation(id, enabled) } },
        modifier = modifier,
    )
}

// ── Stateless content — every state renders; preview- and UI-test-friendly ────────────────────

/**
 * The stateless surface: renders the [state] for the given [size]. Loading shows skeleton chrome,
 * a hard error shows a [QueryError] with retry, an empty result shows a friendly empty state, and
 * content shows the compact tile or the full list. Stale / offline data stays visible with a
 * freshness chip rather than blanking (ADR-013). [onToggle] flips an automation; [onRetry] re-runs
 * a failed fetch.
 */
@Composable
public fun AutomationStatusWidgetContent(
    state: UiState<List<Automation>>,
    size: DashboardWidgetSize,
    onToggle: (id: Long, enabled: Boolean) -> Unit,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    val clamped = remember(size) { size.coerceToConstraints() }
    val title = if (clamped.showsHeader()) stringResource(R.string.translation_widget_automationStatus) else null

    AutomationWidgetShell(
        title = title,
        icon = WorkflowGlyph,
        state = state,
        onRetry = onRetry,
        modifier = modifier,
    ) {
        val items = state.data ?: emptyList()
        if (items.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_widget_noAutomations),
                icon = WorkflowGlyph,
            )
        } else {
            FadeIn {
                if (clamped.isCompact()) {
                    CompactView(items = items)
                } else {
                    FullView(items = items, isWide = clamped.isWide(), onToggle = onToggle)
                }
            }
        }
    }
}

/**
 * Panel chrome reproducing the web `WidgetShell`: a loading skeleton, a hard-error [QueryError]
 * surface, or the titled body with a freshness chip. The freshness chip carries the ADR-013
 * stale / offline / refreshing state so a cached value is never shown as live.
 */
@Composable
private fun AutomationWidgetShell(
    title: String?,
    icon: ImageVector,
    state: UiState<List<Automation>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    when {
        state.isLoading ->
            Column(modifier = modifier.fillMaxSize().padding(PANEL_PADDING)) {
                Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                SkeletonLines(modifier = Modifier.padding(top = GAP_SM), lines = SKELETON_BODY_LINES)
            }

        state.isError ->
            Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
            }

        else ->
            Column(modifier = modifier.fillMaxSize().padding(PANEL_PADDING)) {
                ShellHeader(title = title, icon = icon, state = state)
                Column(modifier = Modifier.weight(1f, fill = true), content = content)
            }
    }
}

@Composable
private fun ShellHeader(
    title: String?,
    icon: ImageVector,
    state: UiState<List<Automation>>,
) {
    val freshness: @Composable () -> Unit = {
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale && !state.hasError,
            isError = state.hasError,
            compact = title == null,
        )
    }
    if (title == null) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { freshness() }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = GAP_SM),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(GAP_XS)) {
                Icon(icon, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
                Caption(title)
            }
            freshness()
        }
    }
}

/** Compact 1×1 – 2×1 tile: the enabled/total count and a failing chip (web `CompactView`). */
@Composable
private fun CompactView(items: List<Automation>) {
    val summary = remember(items) { automationSummary(items) }
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(WorkflowGlyph, contentDescription = null, size = IconSize.Lg, tint = TeslaTokens.status.info)
        MetricValue("${summary.enabled}/${summary.total}", modifier = Modifier.padding(top = GAP_XS))
        Caption(stringResource(R.string.translation_widget_active))
        if (summary.failing > 0) {
            Badge(
                text = "${summary.failing} ${stringResource(R.string.translation_widget_failing)}",
                variant = BadgeVariant.Warning,
                dot = true,
                modifier = Modifier.padding(top = GAP_XS),
            )
        }
    }
}

/** Full 2×2+ view: a summary line plus the scrollable automation list (web `FullView`). */
@Composable
private fun FullView(
    items: List<Automation>,
    isWide: Boolean,
    onToggle: (id: Long, enabled: Boolean) -> Unit,
) {
    val summary = remember(items) { automationSummary(items) }
    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(GAP_SM)) {
        SummaryRow(summary = summary)
        Column(modifier = Modifier.weight(1f, fill = true).verticalScroll(rememberScrollState())) {
            items.forEach { automation ->
                AutomationRow(automation = automation, showToggle = isWide, onToggle = onToggle)
            }
        }
    }
}

@Composable
private fun SummaryRow(summary: AutomationSummary) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(GAP_MD),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SummaryStat(
            icon = DataDisplayGlyphs.CheckCircle,
            tint = TeslaTokens.status.success,
            text = "${summary.enabled} ${stringResource(R.string.translation_widget_active)}",
        )
        if (summary.failing > 0) {
            SummaryStat(
                icon = DataDisplayGlyphs.AlertTriangle,
                tint = TeslaTokens.status.warning,
                text = "${summary.failing} ${stringResource(R.string.translation_widget_failing)}",
            )
        }
        if (summary.autoDisabled > 0) {
            SummaryStat(
                icon = XCircleGlyph,
                tint = TeslaTokens.status.danger,
                text = "${summary.autoDisabled} ${stringResource(R.string.translation_widget_autoDisabled)}",
            )
        }
    }
}

@Composable
private fun SummaryStat(
    icon: ImageVector,
    tint: Color,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(GAP_XS)) {
        Icon(icon, contentDescription = null, size = IconSize.Xs, tint = tint)
        Caption(text)
    }
}

/** One automation row: name + status badge, last-run / next-run times, and the optional toggle. */
@Composable
private fun AutomationRow(
    automation: Automation,
    showToggle: Boolean,
    onToggle: (id: Long, enabled: Boolean) -> Unit,
) {
    val now = remember { System.currentTimeMillis() }
    val kind = remember(automation) { automationStatusKind(automation) }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = GAP_XS),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(GAP_SM),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(GAP_XS)) {
                Caption(automation.name, modifier = Modifier.weight(1f, fill = false))
                Badge(text = automationStatusLabel(kind), variant = kind.toBadgeVariant())
            }
            Row(
                modifier = Modifier.padding(top = GAP_TINY),
                horizontalArrangement = Arrangement.spacedBy(GAP_SM),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                automation.lastTriggeredAt?.let { stamp ->
                    TimeChip(icon = DataDisplayGlyphs.Clock, label = automationTimestampLabel(stamp, now))
                }
                automation.nextFireTime?.let { stamp ->
                    TimeChip(icon = DataDisplayGlyphs.History, label = automationTimestampLabel(stamp, now))
                }
            }
        }
        if (showToggle) {
            val toggleLabel = "${stringResource(R.string.translation_widget_toggle)} ${automation.name}"
            Toggle(
                checked = automation.enabled,
                onCheckedChange = { onToggle(automation.id, it) },
                modifier = Modifier.semantics { contentDescription = toggleLabel },
            )
        }
    }
}

@Composable
private fun TimeChip(
    icon: ImageVector,
    label: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(GAP_TINY)) {
        Icon(icon, contentDescription = null, size = IconSize.Xs, tint = TeslaTokens.status.info)
        Caption(label)
    }
}

@Composable
private fun automationStatusLabel(kind: AutomationStatusKind): String =
    when (kind) {
        AutomationStatusKind.AutoDisabled -> stringResource(R.string.translation_widget_autoDisabled)
        AutomationStatusKind.Disabled -> stringResource(R.string.translation_widget_disabled)
        AutomationStatusKind.Failing -> stringResource(R.string.translation_widget_failing)
        AutomationStatusKind.Ok -> stringResource(R.string.translation_widget_ok)
        AutomationStatusKind.Idle -> stringResource(R.string.translation_widget_idle)
    }

@Composable
private fun automationTimestampLabel(
    iso: String,
    nowMillis: Long,
): String =
    when (val age = automationRelativeAge(parseIsoMillis(iso), nowMillis)) {
        AutomationRelativeAge.Unknown -> EM_DASH
        AutomationRelativeAge.JustNow -> stringResource(R.string.translation_widget_justNow)
        is AutomationRelativeAge.Minutes -> "${age.value}m ${stringResource(R.string.translation_widget_ago)}"
        is AutomationRelativeAge.Hours -> "${age.value}h ${stringResource(R.string.translation_widget_ago)}"
        is AutomationRelativeAge.Days -> "${age.value}d ${stringResource(R.string.translation_widget_ago)}"
    }

// ── Local glyphs (the two lucide icons with no shared-set equivalent) ─────────────────────────

/** A node-graph "workflow" glyph (lucide `Workflow`) — the surface identity icon. */
private val WorkflowGlyph: ImageVector =
    strokedGlyph("Workflow") {
        roundedRect(3f, 3f, 9f, 9f)
        roundedRect(14f, 14f, 20f, 20f)
        moveTo(9f, 6.5f)
        lineTo(14f, 6.5f)
        curveTo(15.5f, 6.5f, 16f, 7f, 16f, 8.5f)
        lineTo(16f, 14f)
    }

/** An X-in-circle glyph (lucide `XCircle`) — the auto-disabled danger indicator. */
private val XCircleGlyph: ImageVector =
    strokedGlyph("XCircle") {
        glyphCircle(12f, 12f, 9f)
        moveTo(9f, 9f)
        lineTo(15f, 15f)
        moveTo(15f, 9f)
        lineTo(9f, 15f)
    }

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private fun PathBuilder.roundedRect(
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

private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Dimensions / constants ────────────────────────────────────────────────────────────────────

private const val COLS_WIDE = 3
private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val MINUTES_PER_DAY = 1_440L
private const val SKELETON_BODY_LINES = 3
private const val EM_DASH = "\u2014"
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val SKELETON_TITLE_FRACTION = 0.5f

private val PANEL_PADDING = 12.dp
private val GAP_TINY = 2.dp
private val GAP_XS = 4.dp
private val GAP_SM = 8.dp
private val GAP_MD = 12.dp
private val SKELETON_TITLE_HEIGHT = 12.dp

// ── Previews (tooling-only; exercised visually + by the per-state UI tests) ────────────────────

private fun sampleAutomation(
    id: Long,
    name: String,
): Automation =
    Automation(
        id = id,
        name = name,
        enabled = true,
        lastSuccessAt = "2026-06-11T01:00:00Z",
        lastTriggeredAt = "2026-06-11T01:30:00Z",
        nextFireTime = "2026-06-11T03:00:00Z",
    )

private fun sampleAutomations(): List<Automation> =
    listOf(
        sampleAutomation(1, "Precondition at 7am"),
        sampleAutomation(2, "Charge to 80%").copy(consecutiveFailures = 2),
        sampleAutomation(3, "Notify on arrival").copy(enabled = false),
        sampleAutomation(4, "Sentry near home").copy(autoDisabled = true, lastSuccessAt = null),
    )

private fun contentState(items: List<Automation>): UiState<List<Automation>> =
    UiState(phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content, data = items, fetchedAt = 1L)

@Preview(name = "Full", widthDp = 360, heightDp = 280)
@Composable
private fun AutomationStatusFullPreview() {
    TeslaSyncTheme {
        AutomationStatusWidgetContent(
            state = contentState(sampleAutomations()),
            size = DashboardWidgetSize(cols = 3, rows = 4),
            onToggle = { _, _ -> },
        )
    }
}

@Preview(name = "Compact", widthDp = 160, heightDp = 160)
@Composable
private fun AutomationStatusCompactPreview() {
    TeslaSyncTheme {
        AutomationStatusWidgetContent(
            state = contentState(sampleAutomations()),
            size = DashboardWidgetSize(cols = 1, rows = 1),
            onToggle = { _, _ -> },
        )
    }
}

@Preview(name = "Empty", widthDp = 360, heightDp = 200)
@Composable
private fun AutomationStatusEmptyPreview() {
    TeslaSyncTheme {
        AutomationStatusWidgetContent(
            state = contentState(emptyList()),
            size = DashboardWidgetSize(cols = 2, rows = 4),
            onToggle = { _, _ -> },
        )
    }
}

@Preview(name = "Error", widthDp = 360, heightDp = 200)
@Composable
private fun AutomationStatusErrorPreview() {
    TeslaSyncTheme {
        AutomationStatusWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = DashboardWidgetSize(cols = 2, rows = 4),
            onToggle = { _, _ -> },
        )
    }
}
