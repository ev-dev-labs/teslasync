// The native Jetpack Compose + Material 3 FSMHealthPanel feature view — a parity port of
// web/src/features/system/components/FSMHealthPanel.tsx. The web component is purely presentational: its
// parent (the FSM monitoring page) fetches the `FSMTransition[]` and passes it down, and the component
// renders either a friendly green "all clear" line (no alerts) or a titled set of alert tiles — one per
// detector that fired (state flapping / stuck sessions / pod recoveries). Its only hook is `useTranslation`,
// so it performs NO HTTP.
//
// The native surface keeps that contract — it binds no data hook of its own. The host supplies the
// transitions through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection
// of the FSM transition feed), so this feature view also renders every lifecycle state that layer can carry
// — loading, hard error with retry, the all-clear/empty healthy state, alert content, and stale/offline
// ("last known") — without ever fetching. The all-clear and alert branches reproduce the web component
// exactly; the lifecycle chrome mirrors the sibling system surfaces. A web-parity overload that takes the
// raw `FSMTransition[]` is also provided for hosts that already hold the list.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FSMHealthPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmhealthpanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

private const val LOADING_SKELETON_ROWS = 2
private const val SKELETON_TITLE_FRACTION = 0.4f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_CARD_HEIGHT: Dp = 56.dp

// Alert-tile tint + border opacities — the native analogue of the web `bg-{color}/5` + `border-{color}/20`.
private const val CARD_BG_ALPHA = 0.06f
private const val CARD_BORDER_ALPHA = 0.25f
private val CARD_BORDER_WIDTH: Dp = 1.dp
private val ICON_TOP_NUDGE: Dp = 1.dp
private val HEALTH_DOT_SIZE: Dp = 8.dp

/**
 * Stateful entry point for the FSM health panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared FSM transition feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the FSM `FSMTransition[]` the web component receives.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FSMHealthPanel(
    state: UiState<List<FSMTransition>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to FSMHealthPanelRegistration.SLUG))
    }
    FSMHealthPanelContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `transitions: FSMTransition[]` prop, for hosts that
 * already hold the list. Records `view.opened` like the stateful entry. There is no fetch behind it, so it
 * offers no retry affordance; a `null`/empty list still resolves to the friendly all-clear state.
 */
@Composable
fun FSMHealthPanel(
    transitions: List<FSMTransition>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(transitions) {
            val items = transitions ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    FSMHealthPanel(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * two render branches (the green "all clear" line when no detector fired, and the titled alert tiles when one
 * or more did) and adds the lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry
 * surface, and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [clockMillis] seeds the stuck-session detector (web `Date.now()`).
 */
@Composable
fun FSMHealthPanelContent(
    state: UiState<List<FSMTransition>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: FSMHealthStrings = rememberFSMHealthStrings(),
    formatCount: (Int) -> String = rememberFSMHealthCountFormatter(),
    clockMillis: Long = rememberNowMillis(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val palette = rememberFSMHealthPalette()
    val formatAge = rememberFSMHealthFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when (fsmHealthSurfaceFor(state.isLoading, state.isError)) {
            FSMHealthSurface.Loading ->
                FSMHealthLoading(label = stringResource(R.string.translation_common_loading))
            FSMHealthSurface.Error -> FSMHealthError(onRetry = onRetry)
            FSMHealthSurface.Ready -> {
                val cards =
                    remember(state.data, strings, formatCount, clockMillis) {
                        val alerts = FSMHealthProjection.computeAlerts(state.data ?: emptyList(), clockMillis)
                        FSMHealthProjection.cards(alerts, strings, formatCount)
                    }
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
                if (cards.isEmpty()) {
                    FSMHealthAllClear(message = strings.allClear)
                } else {
                    // Web `<h2>` — shown only in the alerts branch, above the tiles.
                    SectionTitle(strings.title)
                    Spacer(Modifier.height(Spacing.sm))
                    FSMHealthAlertsList(cards = cards, palette = palette)
                }
            }
        }
    }
}

/**
 * The healthy "all clear" line — web parity: a small green status dot beside the reassuring message, never a
 * blank box. This is the surface's empty state (no detector fired).
 */
@Composable
private fun FSMHealthAllClear(
    message: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .size(HEALTH_DOT_SIZE)
                    .clip(CircleShape)
                    .background(TeslaTokens.status.success),
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = TeslaTokens.status.success,
        )
    }
}

/**
 * Stacks the alert tiles. The web uses a responsive grid (1 column on mobile, one column per alert on md+);
 * the native phone-first layout reproduces the mobile/default arrangement as a single vertical [Column],
 * which scales gracefully for the at-most-three tiles without a width breakpoint.
 */
@Composable
private fun FSMHealthAlertsList(
    cards: List<FSMHealthCard>,
    palette: FSMHealthPalette,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        cards.forEach { card -> FSMHealthAlertCard(card = card, palette = palette) }
    }
}

/**
 * One alert tile — the native analogue of the web bordered/tinted alert card: the severity-tinted marker
 * glyph, the title + interpolated message, and the big grouped count badge pushed to the trailing edge. The
 * whole tile carries a merged accessibility label so TalkBack announces it as a single unit.
 */
@Composable
private fun FSMHealthAlertCard(
    card: FSMHealthCard,
    palette: FSMHealthPalette,
    modifier: Modifier = Modifier,
) {
    val accent = palette.colorFor(card.severity)
    val accessibleLabel = "${card.title}. ${card.message}"
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = accent.copy(alpha = CARD_BG_ALPHA),
        border = BorderStroke(CARD_BORDER_WIDTH, accent.copy(alpha = CARD_BORDER_ALPHA)),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.md)
                    .semantics(mergeDescendants = true) { contentDescription = accessibleLabel },
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = FSMHealthPanelGlyphs.resolve(card.glyph),
                contentDescription = null,
                size = IconSize.Md,
                tint = accent,
                modifier = Modifier.padding(top = ICON_TOP_NUDGE),
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(
                    text = card.title,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                    color = accent,
                )
                HelperText(card.message)
            }
            Text(
                text = card.countText,
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = accent,
            )
        }
    }
}

/** First-load skeleton — a shimmering title bar plus a couple of tile rows so the panel is never blank. */
@Composable
private fun FSMHealthLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        repeat(LOADING_SKELETON_ROWS) {
            Skeleton(height = SKELETON_CARD_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun FSMHealthError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme severity palette — the native analogue of the web amber (warning) / blue (info) accent
 * classes, mapped to design tokens (never raw hex) so light/dark/high-contrast all stay correct.
 */
private class FSMHealthPalette(
    val warning: Color,
    val info: Color,
) {
    fun colorFor(severity: FSMHealthSeverity): Color =
        when (severity) {
            FSMHealthSeverity.Warning -> warning
            FSMHealthSeverity.Info -> info
        }
}

@Composable
private fun rememberFSMHealthPalette(): FSMHealthPalette {
    val warning = TeslaTokens.status.warning
    val info = TeslaTokens.status.info
    return remember(warning, info) { FSMHealthPalette(warning = warning, info = info) }
}

/**
 * Builds the localized [FSMHealthStrings] from the i18n catalog (P1/S10): the `fsm.health.*` keys the web
 * component reads through `useTranslation`. The three message templates carry their `%1$s` count token
 * verbatim; the projection interpolates them so the off-device test can verify the result deterministically.
 */
@Composable
private fun rememberFSMHealthStrings(): FSMHealthStrings {
    val title = stringResource(R.string.translation_fsm_health_title)
    val allClear = stringResource(R.string.translation_fsm_health_allClear)
    val flapTitle = stringResource(R.string.translation_fsm_health_flapTitle)
    val stuckTitle = stringResource(R.string.translation_fsm_health_stuckTitle)
    val recoveryTitle = stringResource(R.string.translation_fsm_health_recoveryTitle)
    val flapMessage = stringResource(R.string.translation_fsm_health_flapping)
    val stuckMessage = stringResource(R.string.translation_fsm_health_stuck)
    val recoveryMessage = stringResource(R.string.translation_fsm_health_recoveries)
    return remember(title, allClear, flapTitle, stuckTitle, recoveryTitle, flapMessage, stuckMessage, recoveryMessage) {
        FSMHealthStrings(
            title = title,
            allClear = allClear,
            flapTitle = flapTitle,
            stuckTitle = stuckTitle,
            recoveryTitle = recoveryTitle,
            flapMessage = flapMessage,
            stuckMessage = stuckMessage,
            recoveryMessage = recoveryMessage,
        )
    }
}

/**
 * The grouped integer formatter for the big-number badge — the native analogue of the web `fmtInt`
 * (`Intl.NumberFormat` with thousands grouping), resolved for the active locale.
 */
@Composable
private fun rememberFSMHealthCountFormatter(): (Int) -> String {
    val locale = Locale.getDefault()
    return remember(locale) {
        val format = NumberFormat.getIntegerInstance(locale)
        val formatter: (Int) -> String = { count -> format.format(count.toLong()) }
        formatter
    }
}

/** Stable wall-clock stamp captured once per composition — the `Date.now()` seam for the stuck detector. */
@Composable
private fun rememberNowMillis(): Long = remember { System.currentTimeMillis() }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFSMHealthFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

/** Fixed evaluation instant for the previews so the stuck detector is deterministic. */
private val PREVIEW_NOW: Long = Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()

/** Crafted transitions that trigger all three detectors: 6 flapping + 1 stuck session + 2 recoveries. */
private fun previewTransitions(): List<FSMTransition> {
    val flaps =
        (0 until 6).map { i ->
            FSMTransition(
                id = i.toLong(),
                vehicleId = 1,
                ts = "2026-06-12T11:59:0${i}Z",
                fsmName = "vehicle",
                fromState = "online",
                toState = if (i % 2 == 0) "asleep" else "online",
                trigger = "telemetry",
            )
        }
    val stuck =
        FSMTransition(
            id = 100,
            vehicleId = 7,
            ts = "2026-06-12T06:00:00Z",
            fsmName = "drive_session",
            fromState = "pending",
            toState = "active",
            trigger = "drive_start",
        )
    val recoveries =
        (0 until 2).map { i ->
            FSMTransition(
                id = 200L + i,
                vehicleId = 7,
                ts = "2026-06-12T07:0$i:00Z",
                fsmName = "drive_session",
                fromState = "active",
                toState = "recovered",
                trigger = "pod_restart",
            )
        }
    return flaps + stuck + recoveries
}

@Preview(name = "Alerts", showBackground = true)
@Composable
private fun FSMHealthPanelAlertsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMHealthPanelContent(
            state = UiState(phase = UiPhase.Content, data = previewTransitions()),
            onRetry = {},
            clockMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "All clear", showBackground = true)
@Composable
private fun FSMHealthPanelAllClearPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMHealthPanelContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            onRetry = {},
            clockMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun FSMHealthPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMHealthPanelContent(state = UiState.loading(), onRetry = {}, clockMillis = PREVIEW_NOW)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun FSMHealthPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMHealthPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            clockMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Offline (stale)", showBackground = true)
@Composable
private fun FSMHealthPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMHealthPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewTransitions(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                    fetchedAt = PREVIEW_NOW,
                ),
            onRetry = {},
            clockMillis = PREVIEW_NOW,
        )
    }
}
