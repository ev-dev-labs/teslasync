// The native Jetpack Compose + Material 3 Warranty Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a shield-iconed title + freshness header) wrapping
// one of the two bodies the web renders: the compact days-remaining hero (1×N — shield + days-remaining +
// "days left" + Active/Expired badge) or — when wider — the standard layout (a time-remaining progress bar, a
// mileage-remaining progress bar, and the expiry/days/mileage/coverage detail rows), with a friendly empty
// state when no warranty document exists. All data flows through the shared
// [WarrantyStatusWidgetViewModel]; SI mileage is converted at this render boundary via the live
// [WarrantyStatusDisplayPrefs]. The view never performs HTTP. Every string resolves through the i18n catalog
// (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WarrantyStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.warrantystatus

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Minimum height so the compact hero + each detail row is a comfortable TalkBack + touch target (web `min-h-[44px]`). */
private val MIN_TARGET_HEIGHT: Dp = 44.dp

/** Skeleton chrome dimensions while the first load is in flight. */
private val LOADING_TITLE_HEIGHT: Dp = 14.dp
private val LOADING_BAR_HEIGHT: Dp = 28.dp
private val LOADING_ROW_HEIGHT: Dp = 24.dp
private const val LOADING_TITLE_FRACTION: Float = 0.4f
private const val LOADING_HERO_FRACTION: Float = 0.55f

/**
 * Stateful entry point. Binds the shared warranty + settings feeds via [source] into a
 * [WarrantyStatusWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface for
 * the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8 data layer) and a
 * unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (a warranty + settings adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WarrantyStatusWidget(
    source: WarrantyStatusSource,
    modifier: Modifier = Modifier,
    size: WarrantyStatusSize = WarrantyStatusRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = WarrantyStatusRegistration.ID,
) {
    val viewModel: WarrantyStatusWidgetViewModel =
        viewModel(key = instanceKey, factory = WarrantyStatusWidgetViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    WarrantyStatusWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `WidgetShell`
 * short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header (title + shield
 * icon only when not compact, web `isCompact ? undefined : …`) over the compact hero / standard layout / empty
 * state. Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [prefs] supplies the
 * SI→display mileage conversion; [size] selects the compact vs standard layout (web `size.cols`); [nowMillis]
 * anchors the `daysUntil` expiry math (tests pin a deterministic value).
 */
@Composable
fun WarrantyStatusWidgetContent(
    state: UiState<JsonElement>,
    prefs: WarrantyStatusDisplayPrefs,
    size: WarrantyStatusSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberWarrantyStatusStrings()

    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                WarrantyLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> WarrantyError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, nowMillis) {
                        WarrantyStatusProjection.projectEnvelope(state.data, prefs, strings, nowMillis)
                    }
                WarrantyHeader(showTitle = !size.isCompact, title = strings.title, state = state, onRefresh = onRefresh)
                if (size.isCompact) {
                    WarrantyCompactBody(display = display, strings = strings)
                } else {
                    WarrantyStandardBody(display = display, strings = strings)
                }
            }
        }
    }
}

@Composable
private fun WarrantyHeader(
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
                imageVector = WarrantyStatusGlyphs.ShieldCheck,
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

/**
 * Compact (1-column) hero — the web `isCompact` branch: a shield glyph, the days-remaining figure, the
 * "days left" label, and the Active/Expired status badge. When no warranty document resolves it shows the
 * friendly empty state (web `warrantyData ? … : <EmptyState/>`). The populated hero folds into one TalkBack
 * phrase.
 */
@Composable
private fun WarrantyCompactBody(
    display: WarrantyStatusDisplay,
    strings: WarrantyStatusStrings,
) {
    if (!display.hasData) {
        WarrantyEmpty(message = strings.noData)
        return
    }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            imageVector = WarrantyStatusGlyphs.ShieldCheck,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.success,
        )
        MetricValue(display.compactDaysText)
        MetricLabel(strings.daysLeft)
        Badge(text = display.compactBadge.text, variant = badgeVariant(display.compactBadge.tier))
    }
}

/**
 * Standard (≥2-column) layout — the web body: the time-remaining bar (when start/expiry parse), the
 * mileage-remaining bar (when limit/current present), and the `WidgetDetailCard` divider-separated detail
 * rows. Shows the friendly empty state when no warranty document resolves (web `warrantyData ? … :
 * <EmptyState/>`).
 */
@Composable
private fun WarrantyStandardBody(
    display: WarrantyStatusDisplay,
    strings: WarrantyStatusStrings,
) {
    if (!display.hasData) {
        WarrantyEmpty(message = strings.noData)
        return
    }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        display.timeBar?.let { WarrantyBar(bar = it) }
        display.mileageBar?.let { WarrantyBar(bar = it) }
        Column(modifier = Modifier.fillMaxWidth()) {
            display.detailRows.forEachIndexed { index, row ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                WarrantyDetailRowView(row = row)
            }
        }
    }
}

@Composable
private fun WarrantyBar(bar: WarrantyMetricBar) {
    MetricBar(
        value = bar.value,
        max = bar.max,
        label = bar.label,
        valueText = bar.sublabel,
        color = tierColor(bar.tier),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun WarrantyDetailRowView(row: WarrantyDetailRow) {
    val description =
        buildString {
            append(row.label)
            append(", ")
            append(row.value)
            row.badge?.let {
                append(", ")
                append(it.text)
            }
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .clearAndSetSemantics { contentDescription = description }
                .padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(row.label, modifier = Modifier.weight(1f))
        if (row.mono) {
            CodeText(row.value)
        } else {
            BodyText(row.value, maxLines = 1)
        }
        row.badge?.let { Badge(text = it.text, variant = badgeVariant(it.tier)) }
    }
}

@Composable
private fun WarrantyLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_BAR_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun WarrantyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun WarrantyEmpty(message: String) {
    EmptyState(
        message = message,
        icon = WarrantyStatusGlyphs.ShieldCheck,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Maps a status [tier] to the shared Badge variant (web `Badge variant`, `'error'` ⇒ danger). */
private fun badgeVariant(tier: WarrantyStatusTier): BadgeVariant =
    when (tier) {
        WarrantyStatusTier.Success -> BadgeVariant.Success
        WarrantyStatusTier.Warning -> BadgeVariant.Warning
        WarrantyStatusTier.Danger -> BadgeVariant.Danger
    }

/** Maps a status [tier] to the shared status color token (web bar hex `#10b981`/`#f59e0b`/`#ef4444`). */
@Composable
private fun tierColor(tier: WarrantyStatusTier): Color =
    when (tier) {
        WarrantyStatusTier.Success -> TeslaTokens.status.success
        WarrantyStatusTier.Warning -> TeslaTokens.status.warning
        WarrantyStatusTier.Danger -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [WarrantyStatusStrings] from the i18n catalog (P1/S10). The fourteen chrome keys
 * (`widget.warranty.{title,expired,active,expiryDate,daysRemaining,mileageLimit,currentMileage,included,
 * covered,daysLeft,noData,timeRemaining,daysUnit,mileageRemaining}`) resolve through `stringResource`; the
 * five known coverage labels resolve through [stringResourceOrFallback], reproducing the web `t(labelKey,
 * fallback)` contract (those label keys ship only as fallbacks, so a missing catalog key uses the literal —
 * and a translation is picked up automatically if the key is ever added). Remembered against the resolved
 * values so a locale change re-projects the surface.
 */
@Composable
private fun rememberWarrantyStatusStrings(): WarrantyStatusStrings {
    val title = stringResource(R.string.translation_widget_warranty_title)
    val expired = stringResource(R.string.translation_widget_warranty_expired)
    val active = stringResource(R.string.translation_widget_warranty_active)
    val expiryDate = stringResource(R.string.translation_widget_warranty_expiryDate)
    val daysRemaining = stringResource(R.string.translation_widget_warranty_daysRemaining)
    val mileageLimit = stringResource(R.string.translation_widget_warranty_mileageLimit)
    val currentMileage = stringResource(R.string.translation_widget_warranty_currentMileage)
    val included = stringResource(R.string.translation_widget_warranty_included)
    val covered = stringResource(R.string.translation_widget_warranty_covered)
    val daysLeft = stringResource(R.string.translation_widget_warranty_daysLeft)
    val noData = stringResource(R.string.translation_widget_warranty_noData)
    val timeRemaining = stringResource(R.string.translation_widget_warranty_timeRemaining)
    val daysUnit = stringResource(R.string.translation_widget_warranty_daysUnit)
    val mileageRemaining = stringResource(R.string.translation_widget_warranty_mileageRemaining)
    val coverageLabels =
        COVERAGE_TYPES.associate { spec -> spec.dataKey to stringResourceOrFallback(spec.resourceKey, spec.fallback) }
    return remember(
        title,
        expired,
        active,
        expiryDate,
        daysRemaining,
        mileageLimit,
        currentMileage,
        included,
        covered,
        daysLeft,
        noData,
        timeRemaining,
        daysUnit,
        mileageRemaining,
        coverageLabels,
    ) {
        WarrantyStatusStrings(
            title = title,
            expired = expired,
            active = active,
            expiryDate = expiryDate,
            daysRemaining = daysRemaining,
            mileageLimit = mileageLimit,
            currentMileage = currentMileage,
            included = included,
            covered = covered,
            daysLeft = daysLeft,
            noData = noData,
            timeRemaining = timeRemaining,
            daysUnit = daysUnit,
            mileageRemaining = mileageRemaining,
            coverageLabels = coverageLabels,
        )
    }
}

/**
 * Resolves the string resource named [resourceKey], falling back to [fallback] when the catalog has no such
 * key — the native analogue of the web `t(key, fallback)`. Keeps the surface i18n-correct (a translation is
 * used the moment the key is added to the catalog) without hard-coding English in the layout.
 */
@Composable
private fun stringResourceOrFallback(
    resourceKey: String,
    fallback: String,
): String {
    val context = LocalContext.current
    val id = remember(resourceKey) { context.resources.getIdentifier(resourceKey, "string", context.packageName) }
    return if (id != 0) stringResource(id) else fallback
}

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans on
 * lucide-react's `ShieldCheck`, which has no bundled Android equivalent). A shield outline with an inner
 * check; monochrome and recolored at render time by the [Icon] tint.
 */
private object WarrantyStatusGlyphs {
    /** Shield outline with an inner checkmark — header + hero + empty-state icon (web `ShieldCheck`). */
    val ShieldCheck: ImageVector =
        warrantyVector("WarrantyShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11.25f, 14.25f)
            lineTo(15.5f, 9.5f)
        }
}

private fun warrantyVector(
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

@Preview(name = "Warranty — standard", showBackground = true)
@Composable
private fun WarrantyStatusStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WarrantyStatusWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewEnvelope(), fetchedAt = PREVIEW_NOW),
            prefs = WarrantyStatusDisplayPrefs.METRIC_DEFAULT,
            size = WarrantyStatusRegistration.DEFAULT_SIZE,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Warranty — compact", showBackground = true)
@Composable
private fun WarrantyStatusCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WarrantyStatusWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewEnvelope(), fetchedAt = PREVIEW_NOW),
            prefs = WarrantyStatusDisplayPrefs.METRIC_DEFAULT,
            size = WarrantyStatusRegistration.MIN_SIZE,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

private const val PREVIEW_NOW = 1_700_000_000_000L

private fun previewEnvelope(): JsonElement =
    buildJsonObject {
        put(
            "data",
            buildJsonObject {
                put("warranty_start_date", "2021-06-01")
                put("warranty_expiry_date", "2025-06-01")
                put("mileage_limit_mi", 80_467.0)
                put("current_mileage_mi", 32_186.0)
                put("battery_drive_unit", true)
                put("battery_drive_unit_expiry_date", "2029-06-01")
            },
        )
    }
