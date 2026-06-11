// The native Jetpack Compose + Material 3 Energy Site dashboard surface — a parity port of
// web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
// `WidgetDetailCard`: a definition list of label/value rows (Solar System, Powerwalls, Gateway Firmware,
// Installation Timezone) or — when no detail resolves — a friendly empty state whose message reflects
// whether a Tesla Energy site is linked at all. All data flows through the shared
// [EnergySiteInfoWidgetViewModel]; SI watts/watt-hours are scaled to kW/kWh at this render boundary via
// the pure [EnergySiteInfoProjection]. The view never performs HTTP. Every string resolves through the
// i18n catalog (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergySiteInfoWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energysiteinfo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH = "\u2014"

/** Minimum row height so every label/value pair is a comfortable TalkBack + touch target. */
private val ROW_MIN_HEIGHT = 44.dp

/** Skeleton chrome dimensions while the first load is in flight. */
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_ROW_HEIGHT = 28.dp
private const val LOADING_TITLE_FRACTION = 0.4f

/** Web `WidgetDetailCard` compact cap: `compact ? entries.slice(0, 4) : entries`. */
private const val MAX_COMPACT_ENTRIES = 4

/**
 * Stateful entry point. Binds the shared Energy feeds via [source] into an [EnergySiteInfoWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S7/S8 Energy data layer) and a unique [instanceKey]
 * per placement.
 *
 * @param source the cache-then-network seam (an `EnergyStore`/`EnergyRepository` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnergySiteInfoWidget(
    source: EnergySiteInfoSource,
    modifier: Modifier = Modifier,
    size: EnergySiteInfoSize = EnergySiteInfoRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = EnergySiteInfoRegistration.ID,
) {
    val viewModel: EnergySiteInfoWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { EnergySiteInfoWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    EnergySiteInfoWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header
 * (title + icon only when not compact, web `isCompact ? undefined : …`) over the detail list / empty
 * state. Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [locale] drives the
 * number grouping (tests pin a deterministic locale).
 */
@Composable
fun EnergySiteInfoWidgetContent(
    state: UiState<EnergySiteInfoState>,
    size: EnergySiteInfoSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberEnergySiteInfoStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> EnergySiteInfoLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> EnergySiteInfoError(onRetry = onRefresh)
            else -> {
                EnergySiteInfoHeader(showTitle = !size.isCompact, title = strings.title, state = state, onRefresh = onRefresh)
                val display =
                    remember(state.data, strings, locale) {
                        EnergySiteInfoProjection.project(state.data ?: EnergySiteInfoState.NO_SITES, strings, locale)
                    }
                if (display.entries.isEmpty()) {
                    EnergySiteInfoEmpty(message = display.emptyMessage)
                } else {
                    EnergySiteDetailList(entries = display.entries, compact = size.isCompact)
                }
            }
        }
    }
}

@Composable
private fun EnergySiteInfoHeader(
    showTitle: Boolean,
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showTitle) {
            Icon(
                EnergySiteInfoGlyphs.Home,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = !showTitle,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun EnergySiteDetailList(
    entries: List<EnergySiteEntry>,
    compact: Boolean,
) {
    val visible = if (compact) entries.take(MAX_COMPACT_ENTRIES) else entries
    Column(modifier = Modifier.fillMaxWidth()) {
        visible.forEachIndexed { index, entry ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            EnergySiteDetailRow(entry = entry)
        }
    }
}

@Composable
private fun EnergySiteDetailRow(entry: EnergySiteEntry) {
    val value = entry.value ?: EM_DASH
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = "${entry.label}, $value" }
                .padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(entry.label, modifier = Modifier.weight(1f))
        if (entry.mono) CodeText(value) else BodyText(value, maxLines = 1)
    }
}

@Composable
private fun EnergySiteInfoEmpty(message: String) {
    EmptyState(
        message = message,
        icon = EnergySiteInfoGlyphs.Home,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun EnergySiteInfoLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
    }
}

@Composable
private fun EnergySiteInfoError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [EnergySiteInfoStrings] from the i18n catalog (P1/S10) — the seven
 * `widget.energySiteInfo.*` keys the web component reads via `t('widget.energySiteInfo.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberEnergySiteInfoStrings(): EnergySiteInfoStrings {
    val title = stringResource(R.string.translation_widget_energySiteInfo_title)
    val solarSize = stringResource(R.string.translation_widget_energySiteInfo_solarSize)
    val powerwall = stringResource(R.string.translation_widget_energySiteInfo_powerwall)
    val firmware = stringResource(R.string.translation_widget_energySiteInfo_firmware)
    val timezone = stringResource(R.string.translation_widget_energySiteInfo_timezone)
    val noSite = stringResource(R.string.translation_widget_energySiteInfo_noSite)
    val noData = stringResource(R.string.translation_widget_energySiteInfo_noData)
    return remember(title, solarSize, powerwall, firmware, timezone, noSite, noData) {
        EnergySiteInfoStrings(
            title = title,
            solarSize = solarSize,
            powerwall = powerwall,
            firmware = firmware,
            timezone = timezone,
            noSite = noSite,
            noData = noData,
        )
    }
}

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans on
 * lucide-react's `Home`, which has no bundled Android equivalent). Monochrome and recolored at render time
 * by the [Icon] tint.
 */
private object EnergySiteInfoGlyphs {
    /** House outline — header + empty-state icon (web `Home`). */
    val Home: ImageVector =
        energySiteInfoVector("EnergySiteInfoHome") {
            moveTo(3f, 9.5f)
            lineTo(12f, 3f)
            lineTo(21f, 9.5f)
            lineTo(21f, 20f)
            lineTo(3f, 20f)
            close()
            moveTo(9f, 20f)
            lineTo(9f, 13f)
            lineTo(15f, 13f)
            lineTo(15f, 20f)
        }
}

private fun energySiteInfoVector(
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
