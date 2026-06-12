// The native Jetpack Compose + Material 3 LiveStateIndicators feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx. The web component is purely
// presentational: a parent (the vehicle-detail page, owner of the `/vehicles/{id}/state` query) passes a
// `VehicleState`; its only hooks are `useTranslation` (i18n) and `useUnits` (the `formatSpeed` helper). It renders a
// `flex flex-wrap gap-2` row of five dotted status badges — Speed, Lock, Sentry, Climate, Charging — each with a
// semantic variant that flips on the matching live field. This port keeps that contract end to end.
//
// It performs NO HTTP and binds no data query of its own: its web hooks are `useTranslation` (mapped to the i18n
// catalog, P1/S10) and `useUnits` (mapped to the live S8 SettingsStore for the speed unit + locale that the Speed
// badge's `formatSpeed` needs). The owning page supplies the `VehicleState` through the shared state-holder layer as
// a [UiState], so this feature view also renders every lifecycle state that layer can carry — a loading shimmer of
// badge chips, a hard error with retry (web `QueryError` equivalent), a friendly empty state, and stale/offline
// cached "last known" badges with a freshness chip + auto-refresh — without ever fetching. A web-parity overload
// taking the raw nullable `state` prop is provided for hosts that already hold the snapshot.
//
// Every derivation flows through the pure [LiveStateIndicatorsProjection]; the composable is a thin render layer. The
// five badges map their semantic [LiveIndicatorTone] onto the shared `Badge` variants (P1/S9 tokens), the native
// expression of the web `success / neutral / danger / warning / info` variant prop. The web `size="lg"` badge sizing
// is a property of the shared atomic `Badge` (owned by the P3 component-library bundle, out of this surface's
// allowed-files scope), so this port uses the shared Badge's default size; everything else — variant, dot, text — is
// reproduced exactly. The web renders no entry animation here, so this port adds none (reduce-motion is trivially
// honored; the only animation is the shared Skeleton shimmer, which already respects it).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveStateIndicators) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.livestateindicators

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** The five loading-shimmer chip widths, approximating the resolved badges so the skeleton matches the content shape. */
private val SKELETON_CHIP_WIDTHS: List<Dp> = listOf(96.dp, 84.dp, 112.dp, 104.dp, 124.dp)

/** Height of each loading-shimmer badge chip — the rounded pill height of a resolved Badge. */
private val SKELETON_CHIP_HEIGHT: Dp = 28.dp

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH_FRESHNESS: String = "\u2014"

/**
 * Stateful entry point for the live-state indicator row. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live speed-unit + locale preferences from the shared S8 SettingsStore (the native binding of
 * the web `useUnits` hook; metric / en-US defaults apply until settings load), and renders every lifecycle [state]
 * the host's vehicle-state feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [VehicleStateLive] slice (web `state`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveStateIndicators(
    state: UiState<VehicleStateLive>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LiveStateIndicatorsDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { LiveStateDisplayPrefs.from(settingsResource.cached) }
    LiveStateIndicatorsContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `state` prop, for hosts that already hold the snapshot. Projects
 * it onto a [UiState] via [LiveStateIndicatorsProjection.projectUiState] (content when present, else empty) and
 * delegates to the stateful entry, which records `view.opened`. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun LiveStateIndicators(
    state: VehicleStateLive?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val uiState = remember(state) { LiveStateIndicatorsProjection.projectUiState(state) }
    LiveStateIndicators(state = uiState, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web layout: a
 * wrapping row of dotted badges. Maps the host feed's [UiState] onto the body — a loading shimmer, a hard-error retry
 * surface (web `QueryError` equivalent), the empty state (web absent-prop friendly fallback), or the resolved badge
 * row. Stale (non-error) data auto-refreshes and shows a freshness chip over the cached badges, mirroring the web
 * page's poll/`refetch` contract. [prefs] supplies the Speed badge's km/h vs mph conversion.
 */
@Composable
fun LiveStateIndicatorsContent(
    state: UiState<VehicleStateLive>,
    onRetry: () -> Unit,
    prefs: LiveStateDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: LiveStateStrings = rememberLiveStateStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (snapshot != null && isDegraded) {
            LiveStateFreshnessRow(state = state)
        }
        when {
            state.isLoading -> LiveStateSkeleton()
            state.isError -> LiveStateError(onRetry = onRetry)
            state.isEmpty || snapshot == null -> LiveStateEmpty(message = strings.noData)
            else -> LiveStateLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
        }
    }
}

/** The resolved branch: derives the five render-ready badges once via the pure projection, then lays them out. */
@Composable
private fun LiveStateLoaded(
    snapshot: VehicleStateLive,
    prefs: LiveStateDisplayPrefs,
    strings: LiveStateStrings,
) {
    val indicators =
        remember(snapshot, prefs, strings) { LiveStateIndicatorsProjection.indicators(snapshot, prefs, strings) }
    LiveStateBadges(indicators = indicators)
}

/** The wrapping badge row — the web `flex flex-wrap gap-2`. Each badge is a dotted, variant-colored chip. */
@Composable
private fun LiveStateBadges(indicators: List<LiveIndicator>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        indicators.forEach { indicator ->
            Badge(text = indicator.text, variant = badgeVariant(indicator.tone), dot = true)
        }
    }
}

/** Maps the semantic [LiveIndicatorTone] onto a shared [BadgeVariant] (web `success/neutral/danger/warning/info`). */
private fun badgeVariant(tone: LiveIndicatorTone): BadgeVariant =
    when (tone) {
        LiveIndicatorTone.Success -> BadgeVariant.Success
        LiveIndicatorTone.Neutral -> BadgeVariant.Neutral
        LiveIndicatorTone.Danger -> BadgeVariant.Danger
        LiveIndicatorTone.Warning -> BadgeVariant.Warning
        LiveIndicatorTone.Info -> BadgeVariant.Info
    }

/**
 * A freshness chip reflecting refreshing/stale/offline over the still-shown cached badges — the native expression of
 * the shared [DataFreshness] contract (the web page's poll/`refetch`). Sits above the badge row.
 */
@Composable
private fun LiveStateFreshnessRow(state: UiState<VehicleStateLive>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberLiveStateFreshnessFormatter(),
    )
}

/** The loading affordance: a wrapping row of five shimmer chips matching the resolved badge layout. */
@Composable
private fun LiveStateSkeleton() {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SKELETON_CHIP_WIDTHS.forEach { chipWidth ->
            Box(modifier = Modifier.width(chipWidth)) {
                Skeleton(height = SKELETON_CHIP_HEIGHT, rounded = true)
            }
        }
    }
}

/**
 * Friendly empty state — the absent-state fallback, so the surface never collapses to a blank box. [EmptyState]
 * exposes the message as its accessibility label.
 */
@Composable
private fun LiveStateEmpty(message: String) {
    EmptyState(message = message, modifier = Modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun LiveStateError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [LiveStateStrings] from the i18n catalog (P1/S10): the `common.*` keys the web component
 * reads, plus the `common.noData` key backing the empty state. Resolved once at the Compose boundary so the rest of
 * the surface holds no English literal.
 */
@Composable
private fun rememberLiveStateStrings(): LiveStateStrings {
    val speed = stringResource(R.string.translation_common_speed)
    val locked = stringResource(R.string.translation_common_locked)
    val unlocked = stringResource(R.string.translation_common_unlocked)
    val sentry = stringResource(R.string.translation_common_sentry)
    val active = stringResource(R.string.translation_common_active)
    val off = stringResource(R.string.translation_common_off)
    val climate = stringResource(R.string.translation_common_climate)
    val on = stringResource(R.string.translation_common_on)
    val charging = stringResource(R.string.translation_common_charging)
    val notCharging = stringResource(R.string.translation_common_notCharging)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(speed, locked, unlocked, sentry, active, off, climate, on, charging, notCharging, noData) {
        LiveStateStrings(
            speed = speed,
            locked = locked,
            unlocked = unlocked,
            sentry = sentry,
            active = active,
            off = off,
            climate = climate,
            on = on,
            charging = charging,
            notCharging = notCharging,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only concern
 * the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberLiveStateFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH_FRESHNESS
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    LiveStateStrings(
        speed = "Speed",
        locked = "Locked",
        unlocked = "Unlocked",
        sentry = "Sentry",
        active = "Active",
        off = "Off",
        climate = "Climate",
        on = "On",
        charging = "Charging",
        notCharging = "Not Charging",
        noData = "No data available",
    )

private val PREVIEW_DRIVING =
    VehicleStateLive(
        speedMps = 27.0,
        isLocked = true,
        sentryMode = true,
        isClimateOn = true,
        isCharging = false,
    )

private val PREVIEW_PARKED =
    VehicleStateLive(
        speedMps = 0.0,
        isLocked = false,
        sentryMode = false,
        isClimateOn = false,
        isCharging = true,
    )

@Composable
private fun previewContent(state: UiState<VehicleStateLive>) {
    TeslaSyncTheme(dynamicColor = false) {
        LiveStateIndicatorsContent(
            state = state,
            onRetry = {},
            prefs = LiveStateDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Driving — moving + locked", showBackground = true)
@Composable
private fun LiveStateIndicatorsDrivingPreview() {
    previewContent(LiveStateIndicatorsProjection.projectUiState(PREVIEW_DRIVING))
}

@Preview(name = "Parked — stopped + charging", showBackground = true)
@Composable
private fun LiveStateIndicatorsParkedPreview() {
    previewContent(LiveStateIndicatorsProjection.projectUiState(PREVIEW_PARKED))
}

@Preview(name = "Empty — no data", showBackground = true)
@Composable
private fun LiveStateIndicatorsEmptyPreview() {
    previewContent(LiveStateIndicatorsProjection.projectUiState(snapshot = null))
}

@Preview(name = "Loading — shimmer chips", showBackground = true)
@Composable
private fun LiveStateIndicatorsLoadingPreview() {
    previewContent(UiState.loading())
}

@Preview(name = "Offline — stale cached badges", showBackground = true)
@Composable
private fun LiveStateIndicatorsOfflinePreview() {
    previewContent(
        UiState(
            phase = UiPhase.Content,
            data = PREVIEW_DRIVING,
            stale = true,
            errorKind = ErrorKind.Network,
        ),
    )
}
