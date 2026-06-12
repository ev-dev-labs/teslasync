// The native Jetpack Compose + Material 3 RegionSettings feature view — a parity port of
// web/src/features/settings/components/RegionSettings.tsx. Inside a `<GlassPanel>` the web component renders a
// header (a green Globe IconBox + "Region & API" title + subtitle on the left; a "Synced …" stamp + a Refresh
// button on the right) and, when the account has a resolved Fleet-API region, a 1/2-column grid of two cards
// (the region code, then the Fleet API base URL shown monospace), falling back to a friendly `<EmptyState>`
// when no region has been fetched yet.
//
// This port keeps that contract end to end and binds the shared P1/S8 [UserStore] (the KMP port of the web
// `useTeslaUserRegion` / `useRefreshTeslaRegion` hooks) directly — it performs NO HTTP itself (ADR-002). The
// region feed is a cache-then-network resource, so the surface renders every lifecycle state that layer can
// carry: a loading skeleton, a hard-error retry surface, the empty state, the populated grid, and a
// stale/offline ("last known") freshness chip with auto-refresh. Refreshing calls the store mutation and
// surfaces the web `useToast` success/error toast from the i18n catalog. All data derivations live in
// [RegionSettingsProjection] (pure, unit-tested off-device); the view is a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RegionSettings — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.regionsettings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import io.teslasync.shared.core.presentation.user.TeslaRegionData
import io.teslasync.shared.core.presentation.user.TeslaRegionEnvelope
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.util.Locale

/** The web `<FadeIn delay={0.04}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 40

/** Max queued refresh toasts and how long each is shown before it auto-dismisses. */
private const val MAX_TOASTS: Int = 3
private const val TOAST_DURATION_MS: Long = 3_200L

/** Skeleton bar proportions/heights so the loading panel is never a blank box. */
private const val SKELETON_TITLE_FRACTION: Float = 0.45f
private const val SKELETON_LINE_FRACTION: Float = 0.85f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_LINE_HEIGHT: Dp = 12.dp

/** Low-alpha wash + hairline border behind each info card (web `bg-white/[0.02]` + subtle border). */
private const val CARD_WASH_ALPHA: Float = 0.35f
private val CARD_PADDING: Dp = 16.dp
private val CARD_BORDER_WIDTH: Dp = 1.dp

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Each field maps
 * one-to-one to a web `t(...)` call in the `settings` namespace (`region.*`), plus the freshness/error chrome
 * the cache-then-network lifecycle implies.
 */
data class RegionSettingsStrings(
    val title: String,
    val subtitle: String,
    val synced: String,
    val refresh: String,
    val regionCode: String,
    val fleetApiUrl: String,
    val noData: String,
    val loading: String,
    val updating: String,
    val offline: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

/**
 * Stateful entry point for the RegionSettings surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), binds the shared [store]'s region feed (P1/S8) as a cache-then-network [UiState], and drives the
 * Refresh mutation — surfacing the web `useToast` success/error toast. The view performs no HTTP.
 *
 * @param store the shared User/Account state holder (web `useUser` domain); supplied by the host page.
 * @param modifier the layout modifier for the surface root.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param scope the coroutine scope the refresh mutation runs in; defaults to the composition scope.
 */
@Composable
fun RegionSettings(
    store: UserStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    scope: CoroutineScope = rememberCoroutineScope(),
) {
    LaunchedEffect(Unit) { recordRegionSettingsOpened(logger) }

    val feed = remember(store) { store.teslaUserRegion() }
    val resource by feed.collectAsStateWithLifecycle()
    val state = remember(resource) { resource.toUiState { RegionSettingsProjection.isEmpty(it) } }

    val refreshedMessage = stringResource(R.string.translation_toast_regionRefreshed)
    val failedMessage = stringResource(R.string.translation_toast_regionFailed)

    var refreshing by remember { mutableStateOf(false) }
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }

    val onRefresh: () -> Unit = {
        if (!refreshing) {
            refreshing = true
            scope.launch {
                val result = store.refreshTeslaRegion()
                refreshing = false
                toastSeq += 1
                val message = if (result.isSuccess) refreshedMessage else failedMessage
                val tone = if (result.isSuccess) Tone.Success else Tone.Danger
                toasts = enqueueToast(toasts, ToastItem(id = toastSeq, message = message, tone = tone), MAX_TOASTS)
            }
        }
    }

    LaunchedEffect(toasts) {
        if (toasts.isNotEmpty()) {
            delay(TOAST_DURATION_MS)
            toasts = toasts.drop(1)
        }
    }

    Box(modifier = modifier) {
        RegionSettingsContent(
            state = state,
            refreshing = refreshing || state.refreshing,
            onRefresh = onRefresh,
            onRetry = onRefresh,
        )
        ToastHost(
            toasts = toasts,
            onDismiss = { id -> toasts = dismissToast(toasts, id) },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * panel: an always-visible header (icon + title + subtitle, sync stamp, Refresh button) above a body that
 * switches between the loading skeleton, the hard-error retry surface, the populated region grid, and the
 * empty state. A stale (non-error) value auto-refreshes via [onRetry], mirroring the sibling surfaces'
 * freshness contract; [zone]/[locale] format the sync stamp.
 */
@Composable
fun RegionSettingsContent(
    state: UiState<TeslaRegionEnvelope>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    strings: RegionSettingsStrings = rememberRegionSettingsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                RegionSettingsHeader(
                    state = state,
                    refreshing = refreshing,
                    onRefresh = onRefresh,
                    zone = zone,
                    locale = locale,
                    strings = strings,
                )
                RegionSettingsBody(
                    state = state,
                    onRetry = onRetry,
                    strings = strings,
                )
            }
        }
    }
}

/** The header: a Globe icon box + title/subtitle on the left, the sync stamp + Refresh on the right. */
@Composable
private fun RegionSettingsHeader(
    state: UiState<TeslaRegionEnvelope>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    zone: ZoneId,
    locale: Locale,
    strings: RegionSettingsStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Success) {
                Icon(GlobeGlyph, contentDescription = null, size = IconSize.Lg)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Heading(strings.title, level = HeadingLevel.Panel, maxLines = 1)
                Caption(strings.subtitle)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RegionSettingsSyncStamp(state = state, refreshing = refreshing, zone = zone, locale = locale, strings = strings)
            Button(
                label = strings.refresh,
                onClick = onRefresh,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                loading = refreshing,
                leadingIcon = RefreshGlyph,
            )
        }
    }
}

/**
 * The right-of-header freshness affordance. While refreshing / stale / offline it shows the [DataFreshness]
 * chip (carrying the honest "Offline" / "updating…" state); otherwise, once fetched, it shows the web-parity
 * "Synced <timestamp>" caption. Nothing renders before the first fetch.
 */
@Composable
private fun RegionSettingsSyncStamp(
    state: UiState<TeslaRegionEnvelope>,
    refreshing: Boolean,
    zone: ZoneId,
    locale: Locale,
    strings: RegionSettingsStrings,
) {
    val fetchedAt = state.data?.fetchedAt
    when {
        refreshing || state.refreshing || state.stale || state.hasError ->
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = refreshing || state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = strings.updating,
                errorLabel = strings.offline,
                formatAge = rememberFreshnessFormatter(),
            )

        !fetchedAt.isNullOrBlank() ->
            Caption("${strings.synced} ${RegionSettingsProjection.formatSynced(fetchedAt, zone, locale)}")
    }
}

/** The panel body: loading skeleton, hard-error retry, the region grid, or the empty state. */
@Composable
private fun RegionSettingsBody(
    state: UiState<TeslaRegionEnvelope>,
    onRetry: () -> Unit,
    strings: RegionSettingsStrings,
) {
    when {
        state.isLoading -> RegionSettingsLoading(label = strings.loading)
        state.isError -> RegionSettingsError(onRetry = onRetry, strings = strings)
        else -> {
            val view = remember(state.data) { RegionSettingsProjection.regionView(state.data) }
            if (view == null) {
                RegionSettingsEmpty(message = strings.noData)
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    RegionInfoCard(label = strings.regionCode) {
                        Heading(view.region, level = HeadingLevel.Panel)
                    }
                    RegionInfoCard(label = strings.fleetApiUrl) {
                        CodeText(view.fleetApiUrl, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}

/** One info card — a label-over-value cell on a tinted, hairline-bordered surface (web grid cell). */
@Composable
private fun RegionInfoCard(
    label: String,
    value: @Composable () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CARD_WASH_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CARD_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(CARD_PADDING),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(label)
            value()
        }
    }
}

/** First-load skeleton — a title bar plus two lines so the panel is never a blank box while loading. */
@Composable
private fun RegionSettingsLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT)
        Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun RegionSettingsError(
    onRetry: () -> Unit,
    strings: RegionSettingsStrings,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — the web `<EmptyState>` with the Info glyph; never a blank box. */
@Composable
private fun RegionSettingsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = TeslaGlyphs.Info,
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Render-only helpers ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [RegionSettingsStrings] from the i18n catalog (P1/S10): the `region.*` keys the web
 * component reads (in the `settings` namespace, resolved here from the generated catalog), plus the freshness /
 * error chrome. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberRegionSettingsStrings(): RegionSettingsStrings {
    val title = stringResource(R.string.translation_region_title)
    val subtitle = stringResource(R.string.translation_region_subtitle)
    val synced = stringResource(R.string.translation_region_lastSynced)
    val refresh = stringResource(R.string.translation_region_refresh)
    val regionCode = stringResource(R.string.translation_region_regionCode)
    val fleetApiUrl = stringResource(R.string.translation_region_fleetApiUrl)
    val noData = stringResource(R.string.translation_region_noData)
    val loading = stringResource(R.string.translation_common_loading)
    val updating = stringResource(R.string.translation_freshness_updating)
    val offline = stringResource(R.string.translation_common_offline)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    return remember(title, subtitle, refresh, regionCode, fleetApiUrl, noData, offline, errorTitle, retry) {
        RegionSettingsStrings(
            title = title,
            subtitle = subtitle,
            synced = synced,
            refresh = refresh,
            regionCode = regionCode,
            fleetApiUrl = fleetApiUrl,
            noData = noData,
            loading = loading,
            updating = updating,
            offline = offline,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_STRINGS =
    RegionSettingsStrings(
        title = "Region & API",
        subtitle = "Tesla account region and Fleet API endpoint",
        synced = "Synced",
        refresh = "Refresh",
        regionCode = "Region",
        fleetApiUrl = "Fleet API Base URL",
        noData = "No region data yet. Click Refresh to fetch from Tesla.",
        loading = "Loading…",
        updating = "updating…",
        offline = "Offline",
        errorTitle = "Server error",
        errorMessage = "Something went wrong on our end. Please try again.",
        retry = "Retry",
    )

private val PREVIEW_ENVELOPE =
    TeslaConfigEnvelope(
        data = TeslaRegionData(region = "North America", fleetApiBaseUrl = "https://fleet-api.prd.na.vn.cloud.tesla.com"),
        fetchedAt = "2026-06-12T14:30:00Z",
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun RegionSettingsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegionSettingsContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_ENVELOPE, fetchedAt = 1_750_000_000_000L),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (no region)", showBackground = true)
@Composable
private fun RegionSettingsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegionSettingsContent(
            state = UiState(phase = UiPhase.Empty, data = TeslaConfigEnvelope(data = TeslaRegionData(), fetchedAt = null)),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun RegionSettingsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegionSettingsContent(
            state = UiState(phase = UiPhase.Loading),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun RegionSettingsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegionSettingsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (last known)", showBackground = true)
@Composable
private fun RegionSettingsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RegionSettingsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_ENVELOPE,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
