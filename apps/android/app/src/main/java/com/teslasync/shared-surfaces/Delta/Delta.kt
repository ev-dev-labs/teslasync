// The native Jetpack Compose + Material 3 Delta shared surface — a parity port of the web
// direction-aware change indicator web/src/components/data-display/Delta.tsx, together with the hooks it
// reads: web/src/hooks/useUnits.ts, web/src/hooks/useFormatting.ts, its component-local `useUnitLabels`,
// and web/src/lib/metricSemantics.ts.
//
// [Delta] is the stateful entry: it binds the [DeltaViewModel] over the [DeltaUnitSource] seam (the
// settings-backed P1/S8 boundary the web `useUnits` / `useFormatting` port to), records the one-shot
// `view.opened` diagnostic, collects the live [DeltaUnitContext], builds a [DeltaInput] from its render
// parameters and projects it with the pure [DeltaProjection.project]. [DeltaContent] is the stateless
// renderer (the test / preview entry point) that paints the projected branch.
//
// The faithful mapping of the web behaviour:
//   * the loading skeleton (web `<Skeleton width="60px">`) → [DeltaSkeleton], a fixed-width shimmer chip;
//   * the missing-inputs em dash with `title={t('delta.noComparison')}` → [DeltaEmpty], the em dash plus
//     the resolved `translation_delta_noComparison` accessible label;
//   * the resolved delta — an arrow encoding the sign (web `aria-hidden` arrow), the always-positive
//     value, the optional `comparedTo`, the good/bad/muted tone color, and the
//     `title={t('delta.title', '{{current}} vs {{previous}}')}` tooltip → [DeltaValue], with the title
//     resolved from `translation_delta_title` as the node's TalkBack label.
// Both i18n keys the web source carries (`delta.noComparison`, `delta.title`) resolve through the P1/S10
// Android string catalog; no English literal lives in this file. The arrow is decorative
// (`contentDescription = null`, the web `aria-hidden="true"`), so the merged node speaks the localized
// title, not the glyph.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Delta) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.DeltaDisplay
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.deltaArrowGlyph
import io.teslasync.android.components.datadisplay.deltaToneColor
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.DataContainer
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered Delta chip — used by the instrumented per-state + a11y UI tests. */
const val DELTA_TEST_TAG: String = "delta"

/** Test tag identifying the loading skeleton chip (web `data-testid="delta-skeleton"`). */
const val DELTA_SKELETON_TEST_TAG: String = "delta-skeleton"

/** Fixed width of the loading skeleton chip — the native mirror of the web `Skeleton width="60px"`. */
private val SKELETON_WIDTH: Dp = 56.dp

/** Skeleton bar height at the compact [DeltaSize.Sm] size. */
private val SKELETON_SM_HEIGHT: Dp = 14.dp

/** Skeleton bar height at the larger [DeltaSize.Md] size. */
private val SKELETON_MD_HEIGHT: Dp = 16.dp

/**
 * Builds (and remembers) the production [DeltaUnitSource] from the app [DataContainer] — the settings
 * feed the web `useUnits` / `useFormatting` derive from. Remembered per container so the mapped flow is
 * not rebuilt every recomposition.
 */
@Composable
fun rememberDeltaUnitSource(container: DataContainer = LocalDataContainer.current): DeltaUnitSource =
    remember(container) { SettingsDeltaUnitSource(container.settingsStore.settings()) }

/**
 * Stateful entry point bound to the shared settings state holder — the faithful port of the web `Delta`
 * resolving `useUnits()` / `useFormatting()` and rendering the change indicator. Binds the
 * [DeltaViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the live
 * [DeltaUnitContext] and projects the caller's value pair into the branch [DeltaContent] paints.
 *
 * @param current the current-period value in the metric's display units (the caller converts).
 * @param previous the previous-period value; `null` / non-finite renders the no-comparison em dash.
 * @param metric the metric semantic — its `direction` colors the delta, its `unit` picks the label.
 * @param modifier optional layout modifier for the chip.
 * @param display percent (default), absolute, or both.
 * @param comparedTo trailing label, e.g. the web `useCompareWindow(...).previousLabel`.
 * @param size the compact [DeltaSize.Sm] (default) or larger [DeltaSize.Md] form.
 * @param hideArrow hides the directional arrow (web `hideArrow`).
 * @param loading forces the loading skeleton (web `loading`).
 * @param precision overrides the default decimal precision (web `precision`).
 * @param source the unit-context seam; defaults to the settings-backed production source.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun Delta(
    current: Double?,
    previous: Double?,
    metric: MetricSemantic,
    modifier: Modifier = Modifier,
    display: DeltaDisplay = DeltaDisplay.Percent,
    comparedTo: String? = null,
    size: DeltaSize = DeltaSize.Sm,
    hideArrow: Boolean = false,
    loading: Boolean = false,
    precision: Int? = null,
    source: DeltaUnitSource = rememberDeltaUnitSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DeltaViewModel =
        viewModel(
            key = DeltaRegistration.ID,
            factory = DeltaViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val context by viewModel.context.collectAsStateWithLifecycle()
    val projection =
        DeltaProjection.project(
            input =
                DeltaInput(
                    current = current,
                    previous = previous,
                    metric = metric,
                    display = display,
                    comparedTo = comparedTo,
                    loading = loading,
                    precision = precision,
                ),
            context = context,
        )
    DeltaContent(projection = projection, modifier = modifier, size = size, hideArrow = hideArrow)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected branch: a loading
 * skeleton, the no-comparison em dash, or the resolved delta. Every branch renders a non-blank chip
 * (never a hidden surface) so the P3 "every state renders" contract holds.
 */
@Composable
fun DeltaContent(
    projection: DeltaProjection,
    modifier: Modifier = Modifier,
    size: DeltaSize = DeltaSize.Sm,
    hideArrow: Boolean = false,
) {
    when (projection) {
        is DeltaProjection.Loading -> DeltaSkeleton(size = size, modifier = modifier)
        is DeltaProjection.Empty -> DeltaEmpty(projection = projection, size = size, modifier = modifier)
        is DeltaProjection.Value ->
            DeltaValue(projection = projection, size = size, hideArrow = hideArrow, modifier = modifier)
    }
}

/** The loading branch — a fixed-width shimmer chip (web `<Skeleton>`), tagged for the UI test. */
@Composable
private fun DeltaSkeleton(
    size: DeltaSize,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.width(SKELETON_WIDTH).testTag(DELTA_SKELETON_TEST_TAG)) {
        Skeleton(height = skeletonHeight(size), rounded = true)
    }
}

/**
 * The no-comparison branch — an em dash with the muted tone and the localized
 * `translation_delta_noComparison` label (web `title={t('delta.noComparison')}`). [comparedTo] is still
 * shown when present.
 */
@Composable
private fun DeltaEmpty(
    projection: DeltaProjection.Empty,
    size: DeltaSize,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(R.string.translation_delta_noComparison)
    Row(
        modifier = modifier.testTag(DELTA_TEST_TAG).semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(text = EM_DASH, style = valueTextStyle(size), color = MaterialTheme.colorScheme.onSurfaceVariant)
        DeltaComparedTo(comparedTo = projection.comparedTo, size = size)
    }
}

/**
 * The resolved-delta branch — the directional arrow (decorative; the value's sign already conveys it),
 * the always-positive value text tinted by [DeltaTone], and the optional trailing label. The node speaks
 * the localized `translation_delta_title` ("{{current}} vs {{previous}}"), the web `title` tooltip.
 */
@Composable
private fun DeltaValue(
    projection: DeltaProjection.Value,
    size: DeltaSize,
    hideArrow: Boolean,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_delta_title, projection.currentText, projection.previousText)
    val color = deltaToneColor(projection.tone)
    Row(
        modifier = modifier.testTag(DELTA_TEST_TAG).semantics(mergeDescendants = true) { contentDescription = title },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!hideArrow) {
            Icon(
                imageVector = deltaArrowGlyph(projection.arrow),
                contentDescription = null,
                size = iconSize(size),
                tint = color,
            )
        }
        Text(text = projection.valueText, style = valueTextStyle(size), color = color)
        DeltaComparedTo(comparedTo = projection.comparedTo, size = size)
    }
}

/** The trailing compare-window label (web `comparedTo`), rendered muted; nothing when absent. */
@Composable
private fun DeltaComparedTo(
    comparedTo: String?,
    size: DeltaSize,
) {
    if (comparedTo != null) {
        Text(text = comparedTo, style = comparedToTextStyle(size), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The value text style for the chip [size] — labelMedium (sm) / labelLarge (md). */
@Composable
private fun valueTextStyle(size: DeltaSize): TextStyle =
    when (size) {
        DeltaSize.Sm -> MaterialTheme.typography.labelMedium
        DeltaSize.Md -> MaterialTheme.typography.labelLarge
    }

/** The trailing-label text style for the chip [size] — one step smaller than the value. */
@Composable
private fun comparedToTextStyle(size: DeltaSize): TextStyle =
    when (size) {
        DeltaSize.Sm -> MaterialTheme.typography.labelSmall
        DeltaSize.Md -> MaterialTheme.typography.labelMedium
    }

/** The arrow icon dimension for the chip [size] (web `h-3` sm / `h-3.5` md). */
private fun iconSize(size: DeltaSize): IconSize =
    when (size) {
        DeltaSize.Sm -> IconSize.Xs
        DeltaSize.Md -> IconSize.Sm
    }

/** The skeleton bar height for the chip [size]. */
private fun skeletonHeight(size: DeltaSize): Dp =
    when (size) {
        DeltaSize.Sm -> SKELETON_SM_HEIGHT
        DeltaSize.Md -> SKELETON_MD_HEIGHT
    }

// ── Previews (tooling-only; sample values are never shipped UI) ──────────────────────────────────────

@Preview(name = "Delta — improvement (percent)", showBackground = true)
@Composable
private fun DeltaImprovementPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DeltaContent(
            projection =
                DeltaProjection.Value(
                    arrow = DeltaArrow.Down,
                    tone = DeltaTone.Good,
                    valueText = "12.5%",
                    comparedTo = "vs last week",
                    currentText = "120",
                    previousText = "137",
                ),
        )
    }
}

@Preview(name = "Delta — regression (both, md)", showBackground = true)
@Composable
private fun DeltaRegressionPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        DeltaContent(
            projection =
                DeltaProjection.Value(
                    arrow = DeltaArrow.Up,
                    tone = DeltaTone.Bad,
                    valueText = "8 kWh (6.4%)",
                    comparedTo = "vs yesterday",
                    currentText = "133",
                    previousText = "125",
                ),
            size = DeltaSize.Md,
        )
    }
}

@Preview(name = "Delta — no comparison", showBackground = true)
@Composable
private fun DeltaEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DeltaContent(projection = DeltaProjection.Empty(comparedTo = "vs last month"))
    }
}

@Preview(name = "Delta — loading", showBackground = true)
@Composable
private fun DeltaLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DeltaContent(projection = DeltaProjection.Loading)
    }
}
