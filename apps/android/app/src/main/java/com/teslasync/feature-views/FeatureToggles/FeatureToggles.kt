// The native Jetpack Compose + Material 3 FeatureToggles feature view — a parity port of
// web/src/features/settings/components/FeatureToggles.tsx. Inside a `<GlassPanel>` the web component renders a
// header (a Flag IconBox + "Feature Flags" title + subtitle on the left; a "Synced …" stamp + a Refresh button
// on the right) above a three-column table (Feature / Status / Details) of the Tesla account's feature flags,
// falling back to a friendly `<EmptyState>` when the account has no feature-config rows yet.
//
// This port keeps that contract end to end and binds the shared P1/S8 [UserStore] (the KMP port of the web
// `useTeslaFeatureConfig` / `useRefreshTeslaFeatureConfig` hooks) directly — it performs NO HTTP itself
// (ADR-002). The feature-config feed is a cache-then-network resource, so the surface renders every lifecycle
// state that layer can carry: a loading skeleton, a hard-error retry surface, the empty state, the populated
// table, and a stale/offline ("last known") freshness chip with auto-refresh. Refreshing calls the store
// mutation and surfaces the web `useToast` success/error toast from the i18n catalog. All data derivations
// live in [FeatureTogglesProjection] (pure, unit-tested off-device); the status-badge variant is resolved
// here at the Compose boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FeatureToggles — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.featuretoggles

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
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
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.ZoneId
import java.util.Locale

/** The web `<FadeIn delay={0.03}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 30

/** Max queued refresh toasts and how long each is shown before it auto-dismisses. */
private const val MAX_TOASTS: Int = 3
private const val TOAST_DURATION_MS: Long = 3_200L

/** Skeleton bar proportions/heights so the loading panel is never a blank box. */
private const val SKELETON_TITLE_FRACTION: Float = 0.45f
private const val SKELETON_LINE_FRACTION: Float = 0.85f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_LINE_HEIGHT: Dp = 12.dp

// Relative column widths approximating the web grid `[1fr_auto_2fr]`: the Feature name, the (content-width)
// Status badge, and the wider Details preview.
private const val FEATURE_WEIGHT: Float = 1.5f
private const val STATUS_WEIGHT: Float = 1f
private const val DETAILS_WEIGHT: Float = 2.5f

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Each field maps
 * one-to-one to a web `t(...)` call in the `settings` namespace (`featureConfig.*`), plus the freshness/error
 * chrome the cache-then-network lifecycle implies and the two refresh toasts (`toast.featureConfig*`).
 */
data class FeatureTogglesStrings(
    val title: String,
    val subtitle: String,
    val synced: String,
    val refresh: String,
    val feature: String,
    val status: String,
    val details: String,
    val enabled: String,
    val disabled: String,
    val noData: String,
    val loading: String,
    val updating: String,
    val offline: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

/**
 * Stateful entry point for the FeatureToggles surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), binds the shared [store]'s feature-config feed (P1/S8) as a cache-then-network [UiState], and
 * drives the Refresh mutation — surfacing the web `useToast` success/error toast. The view performs no HTTP.
 *
 * @param store the shared User/Account state holder (web `useUser` domain); supplied by the host page.
 * @param modifier the layout modifier for the surface root.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param scope the coroutine scope the refresh mutation runs in; defaults to the composition scope.
 */
@Composable
fun FeatureToggles(
    store: UserStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    scope: CoroutineScope = rememberCoroutineScope(),
) {
    LaunchedEffect(Unit) { recordFeatureTogglesOpened(logger) }

    val feed = remember(store) { store.teslaFeatureConfig() }
    val resource by feed.collectAsStateWithLifecycle()
    val state = remember(resource) { resource.toUiState { FeatureTogglesProjection.isEmpty(it) } }

    val refreshedMessage = stringResource(R.string.translation_toast_featureConfigRefreshed)
    val failedMessage = stringResource(R.string.translation_toast_featureConfigFailed)

    var refreshing by remember { mutableStateOf(false) }
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }

    val onRefresh: () -> Unit = {
        if (!refreshing) {
            refreshing = true
            scope.launch {
                val result = store.refreshTeslaFeatureConfig()
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
        FeatureTogglesContent(
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
 * switches between the loading skeleton, the hard-error retry surface, the populated feature table, and the
 * empty state. A stale (non-error) value auto-refreshes via [onRetry], mirroring the sibling surfaces'
 * freshness contract; [zone]/[locale] format the sync stamp.
 */
@Composable
fun FeatureTogglesContent(
    state: UiState<TeslaConfigEnvelope<JsonElement>>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    strings: FeatureTogglesStrings = rememberFeatureTogglesStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                FeatureTogglesHeader(
                    state = state,
                    refreshing = refreshing,
                    onRefresh = onRefresh,
                    zone = zone,
                    locale = locale,
                    strings = strings,
                )
                FeatureTogglesBody(
                    state = state,
                    onRetry = onRetry,
                    strings = strings,
                )
            }
        }
    }
}

/** The header: a Flag icon box + title/subtitle on the left, the sync stamp + Refresh on the right. */
@Composable
private fun FeatureTogglesHeader(
    state: UiState<TeslaConfigEnvelope<JsonElement>>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    zone: ZoneId,
    locale: Locale,
    strings: FeatureTogglesStrings,
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
            // Web `<IconBox color="purple">`: the purple accent has no 1:1 Material token, so it folds to
            // the brand Primary tone (the InfrastructureSection precedent) — light/dark/high-contrast safe.
            IconBox(tone = IconBoxTone.Primary) {
                Icon(FlagGlyph, contentDescription = null, size = IconSize.Lg)
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
            FeatureTogglesSyncStamp(state = state, refreshing = refreshing, zone = zone, locale = locale, strings = strings)
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
private fun FeatureTogglesSyncStamp(
    state: UiState<TeslaConfigEnvelope<JsonElement>>,
    refreshing: Boolean,
    zone: ZoneId,
    locale: Locale,
    strings: FeatureTogglesStrings,
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
            Caption("${strings.synced} ${FeatureTogglesProjection.formatSynced(fetchedAt, zone, locale)}")
    }
}

/** The panel body: loading skeleton, hard-error retry, the feature-flag table, or the empty state. */
@Composable
private fun FeatureTogglesBody(
    state: UiState<TeslaConfigEnvelope<JsonElement>>,
    onRetry: () -> Unit,
    strings: FeatureTogglesStrings,
) {
    when {
        state.isLoading -> FeatureTogglesLoading(label = strings.loading)
        state.isError -> FeatureTogglesError(onRetry = onRetry, strings = strings)
        else -> {
            val data = state.data?.data
            val entries = remember(data) { FeatureTogglesProjection.entries(data) }
            if (entries.isEmpty()) {
                FeatureTogglesEmpty(message = strings.noData)
            } else {
                FeatureFlagsTable(entries = entries, strings = strings)
            }
        }
    }
}

/** The three web columns: the `Feature` name, the `Status` badge (Enabled/Disabled), and the `Details` preview. */
@Composable
private fun FeatureFlagsTable(
    entries: List<FeatureEntry>,
    strings: FeatureTogglesStrings,
) {
    DataTable(
        columns =
            listOf(
                TableColumn(key = "feature", header = strings.feature, weight = FEATURE_WEIGHT) { entry ->
                    Heading(entry.key, level = HeadingLevel.Sub)
                },
                TableColumn(key = "status", header = strings.status, weight = STATUS_WEIGHT) { entry ->
                    Badge(
                        text = if (entry.enabled) strings.enabled else strings.disabled,
                        variant = if (entry.enabled) BadgeVariant.Success else BadgeVariant.Neutral,
                    )
                },
                TableColumn(key = "details", header = strings.details, weight = DETAILS_WEIGHT) { entry ->
                    DetailPreview(entry.details ?: EM_DASH)
                },
            ),
        rows = entries,
        keyOf = { it.key },
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Muted single-line details preview — the native analogue of the web `text-xs text-[var(--text-muted)]
 * max-w-xs truncate` cell. Single-line + ellipsis keeps the row compact; the color reads from the scheme so
 * light/dark theming holds.
 */
@Composable
private fun DetailPreview(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** First-load skeleton — a title bar plus two lines so the panel is never a blank box while loading. */
@Composable
private fun FeatureTogglesLoading(label: String) {
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
private fun FeatureTogglesError(
    onRetry: () -> Unit,
    strings: FeatureTogglesStrings,
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
private fun FeatureTogglesEmpty(message: String) {
    EmptyState(
        message = message,
        icon = TeslaGlyphs.Info,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [FeatureTogglesStrings] from the i18n catalog (P1/S10): the `featureConfig.*` keys the
 * web component reads (in the `settings` namespace, resolved here from the generated catalog), plus the
 * freshness / error / toast chrome. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberFeatureTogglesStrings(): FeatureTogglesStrings {
    val title = stringResource(R.string.translation_featureConfig_title)
    val subtitle = stringResource(R.string.translation_featureConfig_subtitle)
    val synced = stringResource(R.string.translation_featureConfig_lastSynced)
    val refresh = stringResource(R.string.translation_featureConfig_refresh)
    val feature = stringResource(R.string.translation_featureConfig_feature)
    val status = stringResource(R.string.translation_featureConfig_status)
    val details = stringResource(R.string.translation_featureConfig_details)
    val enabled = stringResource(R.string.translation_featureConfig_enabled)
    val disabled = stringResource(R.string.translation_featureConfig_disabled)
    val noData = stringResource(R.string.translation_featureConfig_noData)
    val loading = stringResource(R.string.translation_common_loading)
    val updating = stringResource(R.string.translation_freshness_updating)
    val offline = stringResource(R.string.translation_common_offline)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    return remember(title, refresh, feature, status, details, enabled, disabled, noData, offline, errorTitle, retry) {
        FeatureTogglesStrings(
            title = title,
            subtitle = subtitle,
            synced = synced,
            refresh = refresh,
            feature = feature,
            status = status,
            details = details,
            enabled = enabled,
            disabled = disabled,
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
    FeatureTogglesStrings(
        title = "Feature Flags",
        subtitle = "Tesla account feature configuration",
        synced = "Synced",
        refresh = "Refresh",
        feature = "Feature",
        status = "Status",
        details = "Details",
        enabled = "Enabled",
        disabled = "Disabled",
        noData = "No feature config data yet. Click Refresh to fetch from Tesla.",
        loading = "Loading\u2026",
        updating = "updating\u2026",
        offline = "Offline",
        errorTitle = "Server error",
        errorMessage = "Something went wrong on our end. Please try again.",
        retry = "Retry",
    )

private val PREVIEW_DATA: JsonElement =
    buildJsonObject {
        put("supercharging", true)
        put("autopilot", false)
        putJsonObject("ludicrous_mode") {
            put("enabled", true)
            put("tier", "performance")
        }
    }

private val PREVIEW_ENVELOPE = TeslaConfigEnvelope(data = PREVIEW_DATA, fetchedAt = "2026-06-12T14:30:00Z")

private val PREVIEW_EMPTY_ENVELOPE: TeslaConfigEnvelope<JsonElement> =
    TeslaConfigEnvelope(data = buildJsonObject {}, fetchedAt = "2026-06-12T14:30:00Z")

@Preview(name = "Content", showBackground = true)
@Composable
private fun FeatureTogglesContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FeatureTogglesContent(
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

@Preview(name = "Empty", showBackground = true)
@Composable
private fun FeatureTogglesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FeatureTogglesContent(
            state = UiState(phase = UiPhase.Empty, data = PREVIEW_EMPTY_ENVELOPE),
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
private fun FeatureTogglesLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FeatureTogglesContent(
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
private fun FeatureTogglesErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FeatureTogglesContent(
            state = UiState(phase = UiPhase.Error),
            refreshing = false,
            onRefresh = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
