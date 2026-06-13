// The native Jetpack Compose + Material 3 Range shared surface — a parity port of
// web/src/components/data-display/format/Range.tsx. The web component is a tiny presentational formatter:
// it renders "the" range (rated or ideal, per the user's `preferred_range`) formatted in the user's
// distance unit (km/mi, per `unit_of_length`), or an em dash when the value is missing, with a companion
// label ("Rated Range" / "Ideal Range"). This native surface keeps that contract end to end and renders
// every state the prompt's matrix mandates without ever hiding a region: loading (the first settings
// fetch's skeleton), content (the formatted value), empty (the em dash + "No range data" when the snapshot
// has no value — the web `meters == null` branch), a hard error with Retry, and a stale/offline freshness
// chip over a cached value.
//
// It performs NO HTTP and binds the unit + range-type preferences only through the shared S8/S7 Settings
// seam ([RangeSettingsSource]) folded through [RangeViewModel] + the pure [RangeProjection]; the composable
// resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection returns, using
// the shared component library (ui GlassPanel/StatusPill/typography, feedback QueryError/Skeleton, motion
// FadeIn). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Range) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.range

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The web `Range` default decimal precision (`precision = 0`). */
private const val DEFAULT_PRECISION = 0

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [RangeProjection] a pure, locale-stable function. Every
 * string resolves through the P1/S10 catalog.
 *
 * The rated/ideal labels resolve through the catalog's `widget.ratedRange` / `widget.idealRange` keys: the
 * web `useRangeLabel` looks up `common.ratedRange`/`common.idealRange`, but those keys are absent from the
 * catalog so the web falls back to its English defaults ("Rated Range"/"Ideal Range"); the `widget.*` keys
 * carry that exact text and are fully localized, so this surface renders the identical label across locales.
 */
data class RangeStrings(
    val ratedRange: String,
    val idealRange: String,
    val noRange: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val title: String,
)

/**
 * Stateful entry point — the parity port of the web `Range(state, precision)`. Binds the shared Settings
 * feed via [source] into a [RangeViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on
 * first composition, collects the settings [io.teslasync.android.data.UiState], projects it together with
 * the caller-provided [snapshot] (the web `state` prop) + [precision], auto-refreshes a stale cache, and
 * renders. The [source] defaults to the app's shared S8 SettingsStore.
 *
 * @param snapshot the vehicle/charge range estimates in SI metres (the web `state`); `null` ⇒ the em dash.
 * @param precision decimal precision for the value (web default 0).
 * @param source the cache-then-network Settings seam (shared store/repository adapter, or a fake).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun Range(
    snapshot: RangeSnapshot?,
    modifier: Modifier = Modifier,
    precision: Int = DEFAULT_PRECISION,
    source: RangeSettingsSource = LocalDataContainer.current.settingsStore.asRangeSettingsSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: RangeViewModel =
        viewModel(key = RangeRegistration.SLUG, factory = RangeViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val display = remember(settings, snapshot, precision) { RangeProjection.project(settings, snapshot, precision) }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        RangeContent(display = display, strings = rememberRangeStrings(), onRetry = viewModel::retry)
    }
}

/**
 * Stateless Range card — renders every branch the web source draws plus the settings document's lifecycle:
 * loading skeleton, the formatted value, the empty em dash, and the classified error with retry, with a
 * stale/offline freshness chip over a cached value. Hoisted out of the ViewModel so it is preview- and
 * screenshot-testable for each state.
 */
@Composable
fun RangeContent(
    display: RangeDisplay,
    strings: RangeStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        when (display.phase) {
            RangePhase.Loading -> RangeLoading(strings = strings)
            RangePhase.Error ->
                QueryError(
                    kind = RangeProjection.queryErrorKind(display),
                    resourceName = strings.title,
                    onRetry = onRetry,
                )
            RangePhase.Content, RangePhase.Empty -> RangeValue(display = display, strings = strings)
        }
    }
}

@Composable
private fun RangeValue(
    display: RangeDisplay,
    strings: RangeStrings,
) {
    val label = rangeLabel(strings, display.rangeType)
    val spoken =
        if (display.phase == RangePhase.Content) "$label: ${display.displayValue}" else "$label: ${strings.noRange}"
    Column(
        modifier = Modifier.semantics { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetricLabel(label, modifier = Modifier.weight(1f, fill = false))
            if (display.showFreshnessChip) {
                RangeFreshnessChip(display = display, strings = strings)
            }
        }
        MetricValue(display.displayValue)
        if (display.phase == RangePhase.Empty) {
            Caption(strings.noRange)
        }
    }
}

@Composable
private fun RangeFreshnessChip(
    display: RangeDisplay,
    strings: RangeStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
    }
}

@Composable
private fun RangeLoading(strings: RangeStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LABEL_SKELETON_FRACTION, height = LABEL_SKELETON_HEIGHT)
        Skeleton(widthFraction = VALUE_SKELETON_FRACTION, height = VALUE_SKELETON_HEIGHT)
    }
}

/** The localized "Rated Range" / "Ideal Range" label honoring the user's preference (web `useRangeLabel`). */
private fun rangeLabel(
    strings: RangeStrings,
    type: PreferredRangeType,
): String =
    when (type) {
        PreferredRangeType.Ideal -> strings.idealRange
        PreferredRangeType.Rated -> strings.ratedRange
    }

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberRangeStrings(): RangeStrings =
    RangeStrings(
        ratedRange = stringResource(R.string.translation_widget_ratedRange),
        idealRange = stringResource(R.string.translation_widget_idealRange),
        noRange = stringResource(R.string.translation_widget_noRange),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        title = stringResource(R.string.translation_common_range),
    )

private const val LABEL_SKELETON_FRACTION = 0.4f
private const val VALUE_SKELETON_FRACTION = 0.6f
private val LABEL_SKELETON_HEIGHT = 12.dp
private val VALUE_SKELETON_HEIGHT = 28.dp

// ── Previews — one per rendered state (loading / content metric / content imperial / empty / stale /
// offline / error). ──────────────────────────────────────────────────────────────────────────────────

private const val PREVIEW_RATED_KM = "300 km"
private const val PREVIEW_RATED_MI = "186 mi"

private fun previewStrings(): RangeStrings =
    RangeStrings(
        ratedRange = "Rated Range",
        idealRange = "Ideal Range",
        noRange = "No range data",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        title = "Range",
    )

@Preview(name = "Range · loading", showBackground = true)
@Composable
private fun RangeLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display = RangeDisplay(phase = RangePhase.Loading, rangeType = PreferredRangeType.Rated),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Range · content (metric)", showBackground = true)
@Composable
private fun RangeContentMetricPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display =
                RangeDisplay(
                    phase = RangePhase.Content,
                    rangeType = PreferredRangeType.Rated,
                    valueText = PREVIEW_RATED_KM,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Range · content (imperial, ideal)", showBackground = true)
@Composable
private fun RangeContentImperialPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display =
                RangeDisplay(
                    phase = RangePhase.Content,
                    rangeType = PreferredRangeType.Ideal,
                    valueText = PREVIEW_RATED_MI,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Range · empty", showBackground = true)
@Composable
private fun RangeEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display = RangeDisplay(phase = RangePhase.Empty, rangeType = PreferredRangeType.Rated),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Range · stale", showBackground = true)
@Composable
private fun RangeStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display =
                RangeDisplay(
                    phase = RangePhase.Content,
                    rangeType = PreferredRangeType.Rated,
                    valueText = PREVIEW_RATED_KM,
                    stale = true,
                    refreshing = true,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Range · offline", showBackground = true)
@Composable
private fun RangeOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display =
                RangeDisplay(
                    phase = RangePhase.Content,
                    rangeType = PreferredRangeType.Rated,
                    valueText = PREVIEW_RATED_KM,
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Range · error", showBackground = true)
@Composable
private fun RangeErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeContent(
            display =
                RangeDisplay(
                    phase = RangePhase.Error,
                    rangeType = PreferredRangeType.Rated,
                    errorKind = ErrorKind.Http,
                    httpStatus = HTTP_SERVER_ERROR,
                ),
            strings = previewStrings(),
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
