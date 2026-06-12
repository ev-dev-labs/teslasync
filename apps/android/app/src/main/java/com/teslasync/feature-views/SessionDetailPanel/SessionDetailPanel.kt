// The native Jetpack Compose + Material 3 SessionDetailPanel feature view — a parity port of
// web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx. The web component is purely
// presentational: the Charging Curve page holds the `useChargingSessions` query and passes one decoded
// `session` down, and the component renders a single glass panel — a "Session Details" header over a
// definition list of label/value rows (Date, Charger Type, SOC Range, Energy Added, Peak Power, an optional
// Avg Power, Duration, an optional Cost, and an optional Location).
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useFormatting` (mapped to
// the currency symbol + decimal precision read from the shared settings store, P1/S8). The host supplies the
// decoded `ChargingSession` through the shared state-holder layer as a [UiState], so this feature view also
// renders every lifecycle state that layer can carry — a loading skeleton, a hard error with retry, content,
// and the stale/offline ("last known") freshness chip — without ever fetching. A web-parity overload that
// takes the raw `session` prop is also provided, mirroring the web component's `{ session }` signature.
//
// Every derivation flows through the pure [SessionDetailPanelProjection]; the composable is a thin render
// layer that resolves the i18n labels (P1/S10) and draws the rows through the shared `KVList` (the web
// `SessionDetailRow` definition list), so the surface never hand-rolls a row or imports a chart library. The
// one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SessionDetailPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessiondetailpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/** Em dash shown by the freshness chip when no fetch timestamp is known. */
private const val EM_DASH = "\u2014"

/** Number of skeleton rows drawn in the loading phase (web panel has up to nine rows). */
private const val SKELETON_ROWS = 6

/** Height of one loading-skeleton row. */
private val SKELETON_ROW_HEIGHT: Dp = 20.dp

/**
 * Stateful entry point for the session-detail panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the user's currency symbol + decimal precision from the shared settings store (web
 * `useFormatting`, P1/S8), and renders every lifecycle [state] the host's feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [ChargingSession] (web `useChargingSessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared `/settings` document feed; its `currency_symbol` + `decimal_precision` format values.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionDetailPanel(
    state: UiState<ChargingSession>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val format = remember(settingsResource) { SessionDetailFormat.fromSettings(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]
    val zoneId = ZoneId.systemDefault()
    LaunchedEffect(Unit) { SessionDetailPanelDiagnostics.recordViewOpened(logger) }
    SessionDetailPanelContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        format = format,
        locale = locale,
        zoneId = zoneId,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ session }` prop (plus an explicit [isLoading] for the
 * host's first load). Projects the prop onto a [UiState] via [SessionDetailPanelProjection.projectUiState]
 * and delegates to the stateful entry, which records `view.opened` and resolves the formatting preferences.
 * There is no fetch behind it, so it offers no retry.
 */
@Composable
fun SessionDetailPanel(
    session: ChargingSession,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(session, isLoading) { SessionDetailPanelProjection.projectUiState(session, isLoading) }
    SessionDetailPanel(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's panel (the "Session Details" header over the label/value definition list) and adds the
 * lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry surface, a friendly empty
 * body, and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [format] supplies the currency symbol + precision and [locale]/[zoneId]
 * format every value.
 */
@Composable
fun SessionDetailPanelContent(
    state: UiState<ChargingSession>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    format: SessionDetailFormat = SessionDetailFormat.DEFAULT,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: SessionDetailPanelStrings = rememberSessionDetailPanelStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (state.stale || state.refreshing || state.hasError) {
                SessionDetailFreshnessRow(state = state)
            }
            SectionTitle(strings.title)
            val session = state.data
            when {
                state.isLoading -> SessionDetailLoading()
                state.isError -> SessionDetailError(onRetry = onRetry)
                session == null -> EmptyState(message = strings.noData, modifier = Modifier.fillMaxWidth())
                else -> SessionDetailRows(session = session, format = format, locale = locale, zoneId = zoneId, strings = strings)
            }
        }
    }
}

/** The web `SessionDetailRow` definition list — every projected row rendered through the shared `KVList`. */
@Composable
private fun SessionDetailRows(
    session: ChargingSession,
    format: SessionDetailFormat,
    locale: Locale,
    zoneId: ZoneId,
    strings: SessionDetailPanelStrings,
) {
    val items =
        remember(session, format, locale, zoneId, strings) {
            SessionDetailPanelProjection
                .rows(session, format, locale, zoneId, strings)
                .map { KVItem(it.label, it.value) }
        }
    KVList(items = items, modifier = Modifier.fillMaxWidth())
}

/** The loading branch: skeleton rows so the panel never collapses to a blank box. */
@Composable
private fun SessionDetailLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun SessionDetailError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The "refreshing / stale / offline" freshness chip, right-aligned above the rows. */
@Composable
private fun SessionDetailFreshnessRow(state: UiState<ChargingSession>) {
    val formatAge = rememberSessionDetailFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
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

/**
 * Builds the localized [SessionDetailPanelStrings] from the i18n catalog (P1/S10): the ten `charging.curve.*`
 * row labels the web component reads through `useTranslation`, the shared no-data key for the empty body, and
 * the three charger labels (lifted to existing catalog keys so the web's hardcoded `getChargerLabel` strings
 * are localized natively). Resolved once at the Compose boundary so the rest of the surface stays free of any
 * English literal.
 */
@Composable
private fun rememberSessionDetailPanelStrings(): SessionDetailPanelStrings {
    val title = stringResource(R.string.translation_charging_curve_sessionDetails)
    val date = stringResource(R.string.translation_charging_curve_date)
    val chargerType = stringResource(R.string.translation_charging_curve_chargerType)
    val socRange = stringResource(R.string.translation_charging_curve_socRange)
    val energyAdded = stringResource(R.string.translation_charging_curve_energyAdded)
    val peakPower = stringResource(R.string.translation_charging_curve_peakPower)
    val avgPower = stringResource(R.string.translation_charging_curve_avgPower)
    val duration = stringResource(R.string.translation_charging_curve_duration)
    val cost = stringResource(R.string.translation_charging_curve_cost)
    val location = stringResource(R.string.translation_charging_curve_location)
    val noData = stringResource(R.string.translation_common_noData)
    val chargerHomeAc = stringResource(R.string.translation_charging_curve_acHome)
    val chargerSupercharger = stringResource(R.string.translation_Supercharger)
    val chargerDcFast = stringResource(R.string.translation_charging_curve_dcFast)
    return remember(
        title,
        date,
        chargerType,
        socRange,
        energyAdded,
        peakPower,
        avgPower,
        duration,
        cost,
        location,
        noData,
        chargerHomeAc,
        chargerSupercharger,
        chargerDcFast,
    ) {
        SessionDetailPanelStrings(
            title = title,
            date = date,
            chargerType = chargerType,
            socRange = socRange,
            energyAdded = energyAdded,
            peakPower = peakPower,
            avgPower = avgPower,
            duration = duration,
            cost = cost,
            location = location,
            noData = noData,
            chargerHomeAc = chargerHomeAc,
            chargerSupercharger = chargerSupercharger,
            chargerDcFast = chargerDcFast,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSessionDetailFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; each @Preview exercises a rendered branch) ───────────────────────────────────

/** A fully-populated DC-fast Supercharger session — exercises every row including the three optional ones. */
private fun previewFullSession(): ChargingSession =
    ChargingSession(
        id = 1L,
        startedAt = Instant.parse("2026-04-04T09:30:00Z"),
        vehicleId = 1L,
        chargerType = "Tesla",
        endedAt = Instant.parse("2026-04-04T10:15:00Z"),
        totalEnergyAddedWh = 42_350.0,
        peakPowerW = 121_000.0,
        avgPowerW = 56_500.0,
        startSocPct = 18.0,
        endSocPct = 82.0,
        costDecimal = 12.4,
        startPlace = "Supercharger — Fremont",
    )

/** A minimal AC session — no avg power, cost, location, or end (exercises the omitted optional rows). */
private fun previewMinimalSession(): ChargingSession =
    ChargingSession(
        id = 2L,
        startedAt = Instant.parse("2026-04-04T22:05:00Z"),
        vehicleId = 1L,
        totalEnergyAddedWh = 6_200.0,
        startSocPct = 64.0,
    )

@Preview(name = "Content — full session", showBackground = true)
@Composable
private fun SessionDetailPanelFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionDetailPanelContent(
            state = SessionDetailPanelProjection.projectUiState(previewFullSession(), isLoading = false),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Content — minimal session", showBackground = true)
@Composable
private fun SessionDetailPanelMinimalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionDetailPanelContent(
            state = SessionDetailPanelProjection.projectUiState(previewMinimalSession(), isLoading = false),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SessionDetailPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionDetailPanelContent(
            state = SessionDetailPanelProjection.projectUiState(session = null, isLoading = false),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}
