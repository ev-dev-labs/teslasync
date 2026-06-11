// The native Jetpack Compose + Material 3 WindowStatusDetail feature view — a parity port of
// web/src/features/admin/components/security-access/WindowStatusDetail.tsx. The web component is purely
// presentational: its parent (SecurityAccessPage) owns the polled `GET /security/latest?vehicle_id=` query and
// passes the resolved `latest: SecurityEvent | undefined` down. The component renders an always-visible `<h2>`
// heading above a responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`) of four GlassPanel cards — one
// per window (Front Driver / Front Passenger / Rear Driver / Rear Passenger) — each tinted by, and labelled
// with, its parsed window state (Closed = green, Venting = amber, Open = red, Unknown = muted). When `latest`
// is undefined every card reads "Unknown" (never a blank box). Its only hook is `useTranslation`, so it
// performs NO HTTP.
//
// The native surface keeps that contract — it binds no data hook of its own. The host supplies the window
// payload through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the
// `/security/latest` feed), so this feature view also renders every lifecycle state that layer can carry
// (loading skeleton, hard error with retry, resolved-empty, and stale/offline "last known" with a freshness
// chip) around the web component's always-on four-card grid. A web-parity overload that takes the raw
// `SecurityWindows` prop is also provided for hosts that already hold it; it always renders the grid (four
// "Unknown" cards for a null payload), exactly like the web component's `latest === undefined` path.
//
// Every derivation flows through the pure [WindowStatusDetailProjection]; this composable is a thin render
// layer. The heading, the four position labels, and the four state values all resolve through the generated
// i18n catalog (P1/S10) `admin.security.*` keys — there is no English literal in this file. The one-shot
// PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WindowStatusDetail — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located preview/support declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.windowstatusdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive

// Web `<FadeIn delay={0.15}>` — the entrance delay in milliseconds. FadeIn honours reduce-motion itself.
private const val FADE_DELAY_MS = 150
private const val SKELETON_LABEL_FRACTION = 0.6f
private const val SKELETON_VALUE_FRACTION = 0.45f
private val SKELETON_LABEL_HEIGHT: Dp = 12.dp
private val SKELETON_VALUE_HEIGHT: Dp = 22.dp
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the window status grid. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared `/security/latest` feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the latest window signals (web `latest`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WindowStatusDetail(
    state: UiState<SecurityWindows>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WindowStatusDetailDiagnostics.recordViewOpened(logger) }
    WindowStatusDetailContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `latest: SecurityEvent | undefined` prop, for hosts that
 * already hold the resolved payload. A `null` payload renders four "Unknown" cards (web `latest === undefined`);
 * a present payload renders each window's parsed state. Records `view.opened` like the stateful entry. There is
 * no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun WindowStatusDetail(
    latest: SecurityWindows?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(latest) {
            UiState(phase = UiPhase.Content, data = latest ?: SecurityWindows())
        }
    WindowStatusDetail(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-on heading and four-card grid, and adds the lifecycle chrome the host's feed implies: a loading
 * skeleton grid, a hard-error retry surface, a friendly empty state, and a freshness chip that reflects
 * refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun WindowStatusDetailContent(
    state: UiState<SecurityWindows>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: WindowStatusStrings = rememberWindowStatusStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberWindowFreshnessFormatter()

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Web `<h2>` — always visible, above every state.
            SectionTitle(strings.title)
            Spacer(Modifier.height(Spacing.md))
            when (windowStatusSurfaceFor(state.isLoading, state.isError, state.isEmpty)) {
                WindowStatusSurface.Loading -> WindowStatusLoadingGrid()
                WindowStatusSurface.Error -> WindowStatusError(onRetry = onRetry)
                WindowStatusSurface.Empty -> WindowStatusEmpty()
                WindowStatusSurface.Ready -> {
                    if (state.stale || state.refreshing || state.hasError) {
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
                    val display = remember(state.data) { WindowStatusDetailProjection.project(state.data) }
                    ResponsiveWindowGrid(itemCount = display.panels.size) { index, cellModifier ->
                        WindowStatusCard(panel = display.panels[index], strings = strings, modifier = cellModifier)
                    }
                }
            }
        }
    }
}

/**
 * Lays out [itemCount] cells as the web responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`): the
 * column count comes from [WindowStatusDetailProjection.columnsFor] applied to the panel's own width, and each
 * cell gets an equal weight so it fills its column. A short final row is padded with weighted spacers so the
 * remaining cells keep their column width.
 */
@Composable
private fun ResponsiveWindowGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    cell: @Composable (index: Int, cellModifier: Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = WindowStatusDetailProjection.columnsFor(maxWidth.value.toInt())
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            var index = 0
            while (index < itemCount) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    repeat(columns) {
                        if (index < itemCount) {
                            cell(index, Modifier.weight(1f))
                            index++
                        } else {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

/**
 * One window card — the native analogue of a single web `GlassPanel`: the muted position [label] above the
 * bold, state-colored value. The GlassPanel border accent (web `windowColor`) and the value color (web
 * `windowTextClass`) both derive from the panel's accent role, so they always agree. A merged
 * `contentDescription` ("Front Driver: Closed") gives TalkBack the full reading in one node while the label and
 * value remain visible.
 */
@Composable
private fun WindowStatusCard(
    panel: WindowStatusPanel,
    strings: WindowStatusStrings,
    modifier: Modifier = Modifier,
) {
    val label = strings.labelFor(panel.position)
    val value = strings.valueFor(panel.state)
    GlassPanel(
        modifier = modifier.semantics { contentDescription = "$label: $value" },
        padding = PanelPadding.Md,
        accent = panelAccentFor(panel.accent),
    ) {
        Caption(label)
        Spacer(Modifier.height(Spacing.xs))
        Heading(text = value, level = HeadingLevel.Section, color = windowValueColor(panel.accent))
    }
}

/** First-load skeleton — four shimmering cards in the responsive grid so the panel is never blank. */
@Composable
private fun WindowStatusLoadingGrid() {
    ResponsiveWindowGrid(itemCount = WINDOW_CARD_COUNT) { _, cellModifier ->
        GlassPanel(modifier = cellModifier, padding = PanelPadding.Md) {
            Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
            Spacer(Modifier.height(Spacing.sm))
            Skeleton(widthFraction = SKELETON_VALUE_FRACTION, height = SKELETON_VALUE_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun WindowStatusError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Friendly empty state — shown when the host resolved the feed with no security signal at all. */
@Composable
private fun WindowStatusEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = TeslaGlyphs.Info,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Maps a [WindowAccentRole] to the GlassPanel border accent — web `windowColor` (the background/border tint). */
private fun panelAccentFor(role: WindowAccentRole): PanelAccent =
    when (role) {
        WindowAccentRole.Success -> PanelAccent.Success
        WindowAccentRole.Warning -> PanelAccent.Warning
        WindowAccentRole.Danger -> PanelAccent.Danger
        WindowAccentRole.Muted -> PanelAccent.None
    }

/**
 * Resolves a [WindowAccentRole] to the value text color — web `windowTextClass`. Uses design tokens (never raw
 * hex): success green / warning amber / danger red, and the neutral on-surface-variant for Unknown.
 */
@Composable
private fun windowValueColor(role: WindowAccentRole): Color =
    when (role) {
        WindowAccentRole.Success -> TeslaTokens.status.success
        WindowAccentRole.Warning -> TeslaTokens.status.warning
        WindowAccentRole.Danger -> TeslaTokens.status.danger
        WindowAccentRole.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Builds the localized [WindowStatusStrings] from the i18n catalog (P1/S10): the `admin.security.windowDetail`
 * heading, the four `admin.security.window.*` position labels, and the four `admin.security.windowState.*`
 * values the web component reads through `useTranslation`.
 */
@Composable
private fun rememberWindowStatusStrings(): WindowStatusStrings {
    val title = stringResource(R.string.translation_admin_security_windowDetail)
    val frontDriver = stringResource(R.string.translation_admin_security_window_fd)
    val frontPassenger = stringResource(R.string.translation_admin_security_window_fp)
    val rearDriver = stringResource(R.string.translation_admin_security_window_rd)
    val rearPassenger = stringResource(R.string.translation_admin_security_window_rp)
    val closed = stringResource(R.string.translation_admin_security_windowState_closed)
    val venting = stringResource(R.string.translation_admin_security_windowState_venting)
    val open = stringResource(R.string.translation_admin_security_windowState_open)
    val unknown = stringResource(R.string.translation_admin_security_windowState_unknown)
    return remember(
        title,
        frontDriver,
        frontPassenger,
        rearDriver,
        rearPassenger,
        closed,
        venting,
        open,
        unknown,
    ) {
        WindowStatusStrings(
            title = title,
            frontDriver = frontDriver,
            frontPassenger = frontPassenger,
            rearDriver = rearDriver,
            rearPassenger = rearPassenger,
            closed = closed,
            venting = venting,
            open = open,
            unknown = unknown,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberWindowFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val WINDOW_CARD_COUNT = 4

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_WINDOWS =
    SecurityWindows(
        fdWindow = JsonPrimitive("Closed"),
        fpWindow = JsonPrimitive("Open"),
        rdWindow = JsonPrimitive("Vent"),
        rpWindow = null,
    )

@Preview(name = "Resolved — mixed states", showBackground = true, widthDp = 420)
@Composable
private fun WindowStatusResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WindowStatusDetailContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_WINDOWS),
            onRetry = {},
        )
    }
}

@Preview(name = "Resolved — wide (4 cols)", showBackground = true, widthDp = 1080)
@Composable
private fun WindowStatusWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WindowStatusDetailContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_WINDOWS),
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun WindowStatusLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WindowStatusDetailContent(state = UiState.loading(), onRetry = {})
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun WindowStatusEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WindowStatusDetailContent(
            state = UiState(phase = UiPhase.Empty, data = SecurityWindows()),
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun WindowStatusErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WindowStatusDetailContent(
            state = UiState(phase = UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network),
            onRetry = {},
        )
    }
}

@Preview(name = "Offline — last known", showBackground = true, widthDp = 420)
@Composable
private fun WindowStatusOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WindowStatusDetailContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_WINDOWS,
                    stale = true,
                    errorKind = io.teslasync.android.data.ErrorKind.Network,
                    fetchedAt = 1L,
                ),
            onRetry = {},
        )
    }
}
