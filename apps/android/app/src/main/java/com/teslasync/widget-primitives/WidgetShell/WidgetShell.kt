// The native Jetpack Compose + Material 3 WidgetShell widget primitive — a parity port of the web shared building
// block web/src/features/dashboard/widgets/WidgetShell.tsx. The web source is the chrome that wraps every
// dashboard widget: it renders a loading skeleton, a classified error panel, or the widget body under an optional
// header (icon + uppercase muted title + a "?" help affordance + a freshness chip + an optional pin + caller
// actions), and pulses a soft green glow for 1.5s whenever the data timestamp changes.
//
// Every layout decision (the loading/error/content precedence, the freshness normalization from either the granular
// props or a query, the help/pin gates, and the pulse condition) lives in WidgetShellModel.kt and is unit-tested
// off-device; this file is the thin render layer that drives the pulse clock, resolves i18n through the P1/S10
// catalog (stringResource), maps the four data-surface states onto the shared atoms, and slots the host's
// icon/actions/children. It composes the out-of-scope component-library atoms — feedback `Skeleton` + `QueryError`,
// ui `HelpIcon` + `PinButton`, and data-display `DataFreshness` — exactly as the web shell composes their web
// counterparts. The primitive performs NO HTTP and owns no copy of its own; it records the one-shot PII-safe
// `view.opened` diagnostic (P1/S11) and honors the platform reduced-motion preference (the glow never fires).
//
// `InvalidPackageDeclaration` is suppressed: the mandated primitive directory
// (com/teslasync/widget-primitives/WidgetShell) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling widgets / shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located private helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetshell

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PinButton
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Locale

/** Test tag on the primitive root (present in every phase) so on-device UI tests can locate the shell. */
const val WIDGET_SHELL_TEST_TAG: String = "widget-shell"

/** Extra fade applied to the `--text-muted` title role over the secondary color (the web `--text-muted`). */
private const val MUTED_ALPHA: Float = 0.7f

/** Letter spacing for the uppercase title — the web `tracking-wider` on the 11 px header label. */
private val TITLE_TRACKING = 0.8.sp

/** Peak alpha of the green "just updated" glow border (the web `shadow-[0_0_12px_rgba(34,197,94,0.15)]`). */
private const val GLOW_MAX_ALPHA: Float = 0.45f

private val GLOW_BORDER_WIDTH = 1.dp

// Loading skeleton chrome dimensions — a short title bar over a body block + a trailing line, so the cell reads as
// this shell (never a blank box) while the first fetch runs. Mirrors the native sibling loading idiom.
private val LOADING_TITLE_HEIGHT = 12.dp
private const val LOADING_TITLE_WIDTH_FRACTION: Float = 0.45f
private val LOADING_BODY_HEIGHT = 96.dp
private val LOADING_LINE_HEIGHT = 14.dp
private const val LOADING_LINE_WIDTH_FRACTION: Float = 0.8f

/**
 * The shared chrome that wraps a dashboard widget — the Android port of the web `WidgetShell`. Renders one of three
 * branches in the web precedence: a [loading] skeleton, a classified [error] panel, or the [content] body under an
 * optional header. When [title] is present the header shows the optional [icon], the uppercase muted title, an
 * optional [help] "?" affordance, the freshness chip, an optional pin (when [widgetId] + [dashboardId] + [onTogglePin]
 * are supplied), and the caller [actions]; when absent the freshness chip floats over the top-end corner and the
 * actions render in a right-aligned row, exactly as the web `title ? … : …` ternary does.
 *
 * Freshness comes from EITHER the granular [updatedAtMillis]/[isFetching]/[isStale]/[isError] props OR a [query]
 * (the granular mode wins when [updatedAtMillis] is supplied), reproducing the web `DataFreshness` /
 * `DataFreshnessAuto` split. The body scrolls with padding unless [noPadding] is set. Whenever the effective data
 * timestamp changes the shell pulses a soft green glow for [WidgetShellDefaults.PULSE_HOLD_MS] (suppressed under the
 * platform reduced-motion preference). Records the one-shot PII-safe `view.opened` diagnostic (P1/S11).
 *
 * @param title the widget title; blank/`null` collapses the header to the title-less (overlay-freshness) layout.
 * @param icon optional leading glyph rendered before the title (web `icon`).
 * @param loading whether the first fetch is in flight — renders the skeleton chrome (web `loading`).
 * @param error the error presence signal — non-empty renders the centered [QueryError] (web `error`).
 * @param noPadding render the body flush (no padding / no scroll), for charts/maps that own their bounds (web
 *   `noPadding`).
 * @param updatedAtMillis granular last-fetch timestamp (ms, 0 = never), or `null` to use the [query] mode instead.
 * @param isFetching granular background-fetch flag (web `isFetching`).
 * @param isStale granular staleness flag (web `isStale`).
 * @param isError granular freshness-error flag — the offline chip (web `isError`).
 * @param query the TanStack-query freshness mode, used when [updatedAtMillis] is `null` (web `query`).
 * @param onRefresh manual refresh / retry callback; wired to the error panel's retry affordance (web `onRefresh`).
 * @param help optional contextual help shown as a "?" beside the title (web `help`); only renders WITH a title.
 * @param widgetId stable widget id; with [dashboardId] + [onTogglePin] it gates the pin (web `widgetId`).
 * @param dashboardId per-dashboard pin context (web `dashboardId`).
 * @param pinned whether this widget is currently pinned — the host owns the pin state (the primitive is
 *   presentational, so the pin is a controlled toggle rather than the web hook-backed button).
 * @param onTogglePin invoked when the pin is tapped; required for the pin to render.
 * @param actions optional trailing header controls (web `actions`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer] logger.
 * @param content the widget body (web `children`); the host supplies the loaded content OR an empty-state.
 */
@Composable
fun WidgetShell(
    modifier: Modifier = Modifier,
    title: String? = null,
    icon: (@Composable () -> Unit)? = null,
    loading: Boolean = false,
    error: String? = null,
    noPadding: Boolean = false,
    updatedAtMillis: Long? = null,
    isFetching: Boolean = false,
    isStale: Boolean = false,
    isError: Boolean = false,
    query: WidgetShellFreshnessQuery? = null,
    onRefresh: (() -> Unit)? = null,
    help: WidgetShellHelp? = null,
    widgetId: String? = null,
    dashboardId: String? = null,
    pinned: Boolean = false,
    onTogglePin: (() -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { WidgetShellDiagnostics.recordViewOpened(logger) }

    val projected =
        WidgetShellModel.project(
            WidgetShellSpec(
                title = title,
                loading = loading,
                error = error,
                updatedAtMillis = updatedAtMillis,
                isFetching = isFetching,
                isStale = isStale,
                isError = isError,
                query = query,
                hasHelp = help != null,
                widgetId = widgetId,
                dashboardId = dashboardId,
            ),
        )

    val justUpdated = rememberJustUpdated(projected.effectiveUpdatedAtMillis)

    when (projected.phase) {
        WidgetShellPhase.Loading -> WidgetShellLoading(modifier)
        WidgetShellPhase.Error -> WidgetShellErrorState(onRetry = onRefresh, modifier = modifier)
        WidgetShellPhase.Content ->
            WidgetShellContentLayout(
                projected = projected,
                justUpdated = justUpdated,
                icon = icon,
                help = help,
                pinned = pinned,
                onTogglePin = onTogglePin,
                actions = actions,
                noPadding = noPadding,
                modifier = modifier,
                content = content,
            )
    }
}

/**
 * Drives the web "pulse on data change" effect: returns `true` for [WidgetShellDefaults.PULSE_HOLD_MS] after
 * [effectiveUpdatedAtMillis] moves to a new positive value. The very first observation never flashes (web
 * `prevUpdatedAt.current !== undefined`), and the pulse is suppressed entirely under reduced motion.
 */
@Composable
private fun rememberJustUpdated(effectiveUpdatedAtMillis: Long?): Boolean {
    val reduce = rememberReducedMotion()
    var justUpdated by remember { mutableStateOf(false) }
    val previous = remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(effectiveUpdatedAtMillis) {
        val current = effectiveUpdatedAtMillis
        val shouldPulse = !reduce && WidgetShellModel.shouldPulse(previous.value, current)
        previous.value = current
        if (shouldPulse) {
            justUpdated = true
            delay(WidgetShellDefaults.PULSE_HOLD_MS)
            justUpdated = false
        }
    }
    return justUpdated
}

/** The content branch — the header (or the title-less overlay) over the body, wrapped in the data-change glow. */
@Composable
private fun WidgetShellContentLayout(
    projected: WidgetShellContent,
    justUpdated: Boolean,
    icon: (@Composable () -> Unit)?,
    help: WidgetShellHelp?,
    pinned: Boolean,
    onTogglePin: (() -> Unit)?,
    actions: (@Composable RowScope.() -> Unit)?,
    noPadding: Boolean,
    content: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    val glow by animateFloatAsState(if (justUpdated) 1f else 0f, label = "widget-shell-glow")
    val glowColor = TeslaTokens.status.success
    val glowModifier =
        if (glow > 0f) {
            Modifier.border(GLOW_BORDER_WIDTH, glowColor.copy(alpha = GLOW_MAX_ALPHA * glow), RoundedCornerShape(Radius.lg))
        } else {
            Modifier
        }

    Box(modifier = modifier.fillMaxSize().testTag(WIDGET_SHELL_TEST_TAG).then(glowModifier)) {
        Column(modifier = Modifier.fillMaxSize()) {
            when {
                projected.title != null ->
                    WidgetShellHeader(projected, icon, help, pinned, onTogglePin, actions)

                actions != null -> WidgetShellActionsRow(actions)
            }
            WidgetShellBody(noPadding = noPadding, modifier = Modifier.weight(1f), content = content)
        }

        // Title-less widgets float the freshness chip in the top-end corner over the body (web `absolute` overlay).
        if (projected.title == null) {
            projected.freshness?.let { fresh ->
                Box(modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.xs)) {
                    WidgetShellFreshnessChip(fresh)
                }
            }
        }
    }
}

/** The titled header: icon + title + optional help on the left, freshness + optional pin + actions on the right. */
@Composable
private fun WidgetShellHeader(
    projected: WidgetShellContent,
    icon: (@Composable () -> Unit)?,
    help: WidgetShellHelp?,
    pinned: Boolean,
    onTogglePin: (() -> Unit)?,
    actions: (@Composable RowScope.() -> Unit)?,
) {
    val title = projected.title ?: return
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.lg, end = Spacing.lg, top = Spacing.md, bottom = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f, fill = false),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.invoke()
            WidgetShellTitleText(title)
            if (projected.showHelp && help != null) {
                HelpIcon(
                    text = help.text,
                    contentDescription = stringResource(R.string.translation_a11y_helpFor, title),
                    size = IconSize.Xs,
                )
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            projected.freshness?.let { WidgetShellFreshnessChip(it) }
            if (projected.showPin && onTogglePin != null) {
                PinButton(
                    pinned = pinned,
                    onToggle = onTogglePin,
                    pinLabel = stringResource(R.string.translation_pin_pin),
                    pinnedLabel = stringResource(R.string.translation_pin_unpin),
                    size = IconSize.Sm,
                )
            }
            actions?.invoke(this)
        }
    }
}

/** The right-aligned actions row used for title-less widgets that still expose controls (web `actions` block). */
@Composable
private fun WidgetShellActionsRow(actions: @Composable RowScope.() -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.lg, end = Spacing.lg, top = Spacing.md, bottom = Spacing.xs),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
        content = actions,
    )
}

/** The widget body — scrolls with side/bottom padding unless [noPadding], which renders flush + clipped. */
@Composable
private fun WidgetShellBody(
    noPadding: Boolean,
    content: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    val bodyModifier =
        if (noPadding) {
            modifier.fillMaxWidth().clipToBounds()
        } else {
            modifier
                .fillMaxWidth()
                .padding(start = Spacing.lg, end = Spacing.lg, bottom = Spacing.md)
                .verticalScroll(rememberScrollState())
        }
    Box(modifier = bodyModifier) { content() }
}

/** The uppercase muted 11 px title (web `text-[11px] font-medium uppercase tracking-wider text-[--text-muted]`). */
@Composable
private fun WidgetShellTitleText(title: String) {
    Text(
        text = title.uppercase(Locale.getDefault()),
        // Visual uppercase only — screen readers read the original-case title so TalkBack never spells it out.
        modifier = Modifier.clearAndSetSemantics { contentDescription = title },
        style = MaterialTheme.typography.labelSmall.copy(letterSpacing = TITLE_TRACKING),
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The freshness chip shared by the titled header and the title-less overlay (web `DataFreshness`). */
@Composable
private fun WidgetShellFreshnessChip(state: WidgetShellFreshnessState) {
    DataFreshness(
        updatedAtMillis = state.updatedAtMillis,
        isFetching = state.isFetching,
        isStale = state.isStale,
        isError = state.isError,
        compact = state.compact,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
    )
}

/** The loading skeleton chrome — never a blank box while the first fetch runs (web `<Skeleton h-full/>`). */
@Composable
private fun WidgetShellLoading(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .testTag(WIDGET_SHELL_TEST_TAG)
                .padding(horizontal = Spacing.lg, vertical = Spacing.md)
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_WIDTH_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = LOADING_BODY_HEIGHT, rounded = true)
        Skeleton(widthFraction = LOADING_LINE_WIDTH_FRACTION, height = LOADING_LINE_HEIGHT)
    }
}

/**
 * The hard-error branch — a centered, recovery-oriented [QueryError]. The web wraps the message in a status-less
 * `Error`, which the web `QueryError` classifies as the generic network ("can't reach server") branch, so the
 * native primitive uses [QueryErrorKind.Network] and wires [onRetry] (web `onRefresh`) to its retry affordance.
 */
@Composable
private fun WidgetShellErrorState(
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().testTag(WIDGET_SHELL_TEST_TAG),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = QueryErrorKind.Network, onRetry = onRetry)
    }
}

// ── Previews (tooling-only; the sample copy is never shipped UI) ─────────────────────────────────────────────

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

/** Renders a primitive inside the theme and a fixed widget-sized cell, with reduced motion so nothing animates. */
@Composable
private fun WidgetShellPreviewCell(
    dark: Boolean = true,
    content: @Composable () -> Unit,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Box(modifier = Modifier.width(220.dp).height(140.dp)) { content() }
        }
    }
}

@Preview(name = "WidgetShell · titled + fresh + help + pin", showBackground = true)
@Composable
private fun WidgetShellTitledPreview() {
    WidgetShellPreviewCell {
        WidgetShell(
            title = "Battery Health",
            updatedAtMillis = System.currentTimeMillis(),
            help = WidgetShellHelp("Estimated full-pack capacity versus the original EPA rating."),
            widgetId = "battery-health",
            dashboardId = "overview",
            onTogglePin = {},
            logger = PreviewLogger,
        ) {
            Text("96% · 287 mi rated", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Preview(name = "WidgetShell · title-less + stale overlay", showBackground = true)
@Composable
private fun WidgetShellTitlelessPreview() {
    WidgetShellPreviewCell {
        WidgetShell(
            updatedAtMillis = System.currentTimeMillis() - 3_600_000L,
            isStale = true,
            logger = PreviewLogger,
        ) {
            Text("42 kWh", style = MaterialTheme.typography.headlineMedium)
        }
    }
}

@Preview(name = "WidgetShell · loading", showBackground = true)
@Composable
private fun WidgetShellLoadingPreview() {
    WidgetShellPreviewCell {
        WidgetShell(title = "Charging", loading = true, logger = PreviewLogger) {}
    }
}

@Preview(name = "WidgetShell · error", showBackground = true)
@Composable
private fun WidgetShellErrorPreview() {
    WidgetShellPreviewCell {
        WidgetShell(title = "Drives", error = "request failed", onRefresh = {}, logger = PreviewLogger) {}
    }
}
