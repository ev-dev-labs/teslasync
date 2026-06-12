// The native Jetpack Compose + Material 3 Savings-Calculator feature view — a parity port of
// web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx. The web component is a
// presentational `GlassPanel` (green "glow") with a calculator-icon title and a responsive grid: a left
// "Your Assumptions" column of three numeric inputs (gas price, MPG, electricity rate) plus a "Reset Defaults"
// button, and a right "Comparison" column that either shows a 2×2 grid of result cards (Gas Cost / EV Cost /
// Total Savings / Monthly Savings) or a friendly "Not enough data for comparison" message.
//
// This port keeps that contract end to end. Its only web hook is `useTranslation`, mapped here to the i18n
// catalog (P1/S10); it performs NO HTTP. The web parent owns the assumptions and computes the comparison; a
// self-contained native surface owns the assumptions as local UI state (with the web defaults) and recomputes
// the comparison from the base-stats feed delivered through the shared P1/S8 state-holder layer as a
// [UiState]. So this feature view renders every lifecycle state that layer can carry — loading skeleton, hard
// error with retry, empty ("not enough data"), content, and stale/offline (cached "last known" + freshness
// chip) — without ever fetching, while the assumption inputs stay live throughout. A web-parity overload that
// takes the raw base-stats value is also provided for hosts that already hold it.
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes: the outer `GlassPanel` uses the success accent (the web green glow); the four result cards are
// `GlassPanel`s with the Total card accented (the web inner green glow); the headline amounts are colored from
// the semantic status palette (gas → danger, EV → info, savings → success), the toned-down counterparts of
// the web red/cyan/green. The web `lucide-react` Calculator glyph is authored locally as a stroked vector
// (Android ships no equivalent without the frozen material-icons-extended artifact). `view.opened` is emitted
// once via the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SavingsCalculator — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.savingscalculator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** 24×24 viewport for the locally-authored line glyph. */
private const val GLYPH_VIEWPORT: Float = 24f

/** Stroke width (viewport units) matching the shared [io.teslasync.android.components.ui.TeslaGlyphs] set. */
private const val GLYPH_STROKE: Float = 2f

/** Em dash shown by the freshness chip when no timestamp is available. */
private const val EM_DASH: String = "\u2014"

/** The default display distance unit — the web `distanceUnit` prop (a page passes the user's "mi"/"km"). */
private const val DEFAULT_DISTANCE_UNIT: String = "mi"

/** Width at/above which the assumptions + comparison sit side by side (the web `lg:grid-cols-3`). */
private val WIDE_BREAKPOINT: Dp = 600.dp

/** Footprint of the locally-authored calculator glyph. */
private val GLYPH_SIZE: Dp = 24.dp

/** Height of one loading-skeleton card so the comparison region is never blank. */
private val CARD_SKELETON_HEIGHT: Dp = 76.dp

/** Layout weight of the assumptions column when wide (the web 1-of-3 columns). */
private const val ASSUMPTIONS_WEIGHT: Float = 1f

/** Layout weight of the comparison column when wide (the web `lg:col-span-2`). */
private const val COMPARISON_WEIGHT: Float = 2f

/** Test tag on the gas-price field (drives the deterministic reset UI test). */
internal const val TAG_GAS_PRICE: String = "savings-gas-price"

/** Test tag on the MPG field. */
internal const val TAG_MPG: String = "savings-mpg"

/** Test tag on the electricity-rate field. */
internal const val TAG_ELECTRICITY_RATE: String = "savings-electricity-rate"

/**
 * Stroked calculator glyph — the native analogue of the web `Calculator` lucide icon (a body, a screen, a
 * keypad of dots, and a tall "=" key). Drawn monochrome and recolored at render time by the [Icon] tint.
 */
private val CalculatorGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Calculator",
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(4f, 2f)
                lineTo(20f, 2f)
                lineTo(20f, 22f)
                lineTo(4f, 22f)
                close()
                moveTo(8f, 6f)
                lineTo(16f, 6f)
                moveTo(8f, 10f)
                lineTo(8.1f, 10f)
                moveTo(12f, 10f)
                lineTo(12.1f, 10f)
                moveTo(16f, 10f)
                lineTo(16.1f, 10f)
                moveTo(8f, 14f)
                lineTo(8.1f, 14f)
                moveTo(12f, 14f)
                lineTo(12.1f, 14f)
                moveTo(16f, 14f)
                lineTo(16f, 18f)
                moveTo(8f, 18f)
                lineTo(8.1f, 18f)
                moveTo(12f, 18f)
                lineTo(12.1f, 18f)
            }
        }.build()

/**
 * Stateful entry point for the savings calculator. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared charging-cost feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the base charging stats the comparison reads.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param distanceUnit the user's display distance unit (the web `distanceUnit` prop).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SavingsCalculator(
    state: UiState<SavingsBaseStats>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    distanceUnit: String = DEFAULT_DISTANCE_UNIT,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSavingsCalculatorOpened(logger) }
    SavingsCalculatorContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        distanceUnit = distanceUnit,
        locale = currentLocale(),
    )
}

/**
 * Web-parity overload mirroring the web component's loaded `gasComparison` source: a `null` base-stats value
 * renders the friendly empty state (the web `gasComparison ? … : noData` ternary), a populated value renders
 * the comparison cards. The assumptions stay interactive either way. Records `view.opened` like the stateful
 * entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SavingsCalculator(
    baseStats: SavingsBaseStats?,
    modifier: Modifier = Modifier,
    distanceUnit: String = DEFAULT_DISTANCE_UNIT,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(baseStats) {
            UiState(phase = if (baseStats != null) UiPhase.Content else UiPhase.Empty, data = baseStats)
        }
    SavingsCalculator(state = state, onRetry = {}, modifier = modifier, distanceUnit = distanceUnit, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the green-accented
 * `GlassPanel` with the calculator-icon title, then the responsive body: the always-interactive "Your
 * Assumptions" inputs (with "Reset Defaults") beside the "Comparison" region, which switches on the host
 * lifecycle (loading skeleton / hard error+retry / ready). When ready it shows the four result cards, or the
 * friendly "Not enough data" empty state when there is no base feed, plus a freshness chip while
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [locale] formats the currency amounts; [distanceUnit] labels the per-distance rates.
 */
@Composable
fun SavingsCalculatorContent(
    state: UiState<SavingsBaseStats>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    distanceUnit: String = DEFAULT_DISTANCE_UNIT,
    locale: Locale = Locale.getDefault(),
    strings: SavingsCalculatorStrings = rememberSavingsCalculatorStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    var gasPriceText by rememberSaveable { mutableStateOf(defaultAssumptionText(DEFAULT_GAS_PRICE)) }
    var mpgText by rememberSaveable { mutableStateOf(defaultAssumptionText(DEFAULT_MPG)) }
    var electricityRateText by rememberSaveable { mutableStateOf(defaultAssumptionText(DEFAULT_ELECTRICITY_RATE)) }

    val assumptions =
        remember(gasPriceText, mpgText, electricityRateText) {
            assumptionsFromInput(gasPriceText, mpgText, electricityRateText)
        }
    val comparison =
        remember(state.data, assumptions) {
            SavingsCalculatorProjection.computeComparison(state.data, assumptions)
        }
    val currency = remember(locale) { savingsCurrencyFormatter(locale) }

    val onReset = {
        gasPriceText = defaultAssumptionText(DEFAULT_GAS_PRICE)
        mpgText = defaultAssumptionText(DEFAULT_MPG)
        electricityRateText = defaultAssumptionText(DEFAULT_ELECTRICITY_RATE)
    }

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg, accent = PanelAccent.Success) {
        SavingsCalculatorHeader(title = strings.title)
        Spacer(modifier = Modifier.height(Spacing.lg))
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val assumptionsSection: @Composable (Modifier) -> Unit = { sectionModifier ->
                SavingsAssumptionsSection(
                    strings = strings,
                    gasPriceText = gasPriceText,
                    mpgText = mpgText,
                    electricityRateText = electricityRateText,
                    onGasPriceChange = { gasPriceText = it },
                    onMpgChange = { mpgText = it },
                    onElectricityRateChange = { electricityRateText = it },
                    onReset = onReset,
                    modifier = sectionModifier,
                )
            }
            val comparisonSection: @Composable (Modifier) -> Unit = { sectionModifier ->
                SavingsComparisonSection(
                    state = state,
                    comparison = comparison,
                    currency = currency,
                    distanceUnit = distanceUnit,
                    strings = strings,
                    onRetry = onRetry,
                    modifier = sectionModifier,
                )
            }
            if (maxWidth >= WIDE_BREAKPOINT) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xl2),
                ) {
                    assumptionsSection(Modifier.weight(ASSUMPTIONS_WEIGHT))
                    comparisonSection(Modifier.weight(COMPARISON_WEIGHT))
                }
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
                ) {
                    assumptionsSection(Modifier.fillMaxWidth())
                    comparisonSection(Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/** The title row — a tinted calculator icon box beside the panel title (the web `<h3><Calculator/>…`). */
@Composable
private fun SavingsCalculatorHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBox(tone = IconBoxTone.Success, size = IconBoxSize.Md) {
            Icon(imageVector = CalculatorGlyph, contentDescription = null, size = IconSize.Lg)
        }
        PanelTitle(title)
    }
}

/** The "Your Assumptions" column — the three numeric inputs and the "Reset Defaults" button. */
@Composable
private fun SavingsAssumptionsSection(
    strings: SavingsCalculatorStrings,
    gasPriceText: String,
    mpgText: String,
    electricityRateText: String,
    onGasPriceChange: (String) -> Unit,
    onMpgChange: (String) -> Unit,
    onElectricityRateChange: (String) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Caption(strings.inputsTitle)
        Input(
            value = gasPriceText,
            onValueChange = onGasPriceChange,
            modifier = Modifier.testTag(TAG_GAS_PRICE),
            label = strings.gasPriceLabel,
            hint = SUFFIX_GAS_PRICE,
            keyboardType = KeyboardType.Decimal,
        )
        Input(
            value = mpgText,
            onValueChange = onMpgChange,
            modifier = Modifier.testTag(TAG_MPG),
            label = strings.mpgLabel,
            hint = SUFFIX_MPG,
            keyboardType = KeyboardType.Decimal,
        )
        Input(
            value = electricityRateText,
            onValueChange = onElectricityRateChange,
            modifier = Modifier.testTag(TAG_ELECTRICITY_RATE),
            label = strings.electricityRateLabel,
            hint = SUFFIX_ELECTRICITY_RATE,
            keyboardType = KeyboardType.Decimal,
        )
        Button(label = strings.resetLabel, onClick = onReset, modifier = Modifier.fillMaxWidth())
    }
}

/** The "Comparison" column — the lifecycle switch over the result cards / empty / loading / error. */
@Composable
private fun SavingsComparisonSection(
    state: UiState<SavingsBaseStats>,
    comparison: GasComparison?,
    currency: (Double, Int) -> String,
    distanceUnit: String,
    strings: SavingsCalculatorStrings,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Caption(strings.comparisonTitle)
        when (savingsSurfaceFor(isLoading = state.isLoading, isError = state.isError)) {
            SavingsSurfaceState.Loading ->
                SavingsComparisonLoading(label = stringResource(R.string.translation_common_loading))
            SavingsSurfaceState.Error -> SavingsComparisonError(onRetry = onRetry)
            SavingsSurfaceState.Ready -> {
                if (state.stale || state.refreshing || state.hasError) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        SavingsFreshnessChip(state = state)
                    }
                }
                if (comparison != null) {
                    SavingsComparisonGrid(
                        comparison = comparison,
                        currency = currency,
                        distanceUnit = distanceUnit,
                        strings = strings,
                    )
                } else {
                    EmptyState(message = strings.noDataLabel, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/** The 2×2 result grid — Gas Cost / EV Cost on the first row, Total / Monthly on the second (web grid). */
@Composable
private fun SavingsComparisonGrid(
    comparison: GasComparison,
    currency: (Double, Int) -> String,
    distanceUnit: String,
    strings: SavingsCalculatorStrings,
    modifier: Modifier = Modifier,
) {
    val cards =
        remember(comparison, currency, distanceUnit, strings) {
            SavingsCalculatorProjection.projectCards(
                comparison = comparison,
                distanceUnit = distanceUnit,
                currency = currency,
                overPeriodLabel = strings.overPeriodLabel,
                perYearLabel = strings.perYearLabel,
            )
        }
    val gasColor = TeslaTokens.status.danger
    val evColor = TeslaTokens.status.info
    val savingsColor = TeslaTokens.status.success

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SavingsMetricCard(
                label = strings.gasCostLabel,
                content = cards.gas,
                valueColor = gasColor,
                emphasized = false,
                modifier = Modifier.weight(1f),
            )
            SavingsMetricCard(
                label = strings.evCostLabel,
                content = cards.ev,
                valueColor = evColor,
                emphasized = false,
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SavingsMetricCard(
                label = strings.totalSavingsLabel,
                content = cards.total,
                valueColor = savingsColor,
                emphasized = true,
                modifier = Modifier.weight(1f),
            )
            SavingsMetricCard(
                label = strings.monthlySavingsLabel,
                content = cards.monthly,
                valueColor = savingsColor,
                emphasized = false,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/**
 * One result card — a label over a status-colored headline value over a muted sub line. [emphasized] adds the
 * success accent that reproduces the web Total-Savings green glow. The whole card reads as one TalkBack node.
 */
@Composable
private fun SavingsMetricCard(
    label: String,
    content: SavingsCardContent,
    valueColor: Color,
    emphasized: Boolean,
    modifier: Modifier = Modifier,
) {
    val description = remember(label, content) { SavingsCalculatorProjection.cardDescription(label, content) }
    GlassPanel(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        padding = PanelPadding.Sm,
        accent = if (emphasized) PanelAccent.Success else PanelAccent.None,
    ) {
        MetricLabel(label)
        Text(
            text = content.value,
            modifier = Modifier.padding(top = Spacing.xs),
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
            color = valueColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        HelperText(content.sub, modifier = Modifier.padding(top = Spacing.xs))
    }
}

/** First-load skeleton — a 2×2 grid of card-shaped bars so the comparison region is never blank. */
@Composable
private fun SavingsComparisonLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(2) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Skeleton(modifier = Modifier.weight(1f), height = CARD_SKELETON_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = CARD_SKELETON_HEIGHT, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SavingsComparisonError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip shown in the comparison header while cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun SavingsFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSavingsFreshnessFormatter(locale = currentLocale()),
    )
}

/**
 * Builds the localized [SavingsCalculatorStrings] from the i18n catalog (P1/S10): every
 * `costAnalysis.calculator.*` key the web component resolves via `t(...)`. Remembered against the resolved
 * strings so a locale change re-projects.
 */
@Composable
private fun rememberSavingsCalculatorStrings(): SavingsCalculatorStrings {
    val title = stringResource(R.string.translation_costAnalysis_calculator_title)
    val inputsTitle = stringResource(R.string.translation_costAnalysis_calculator_inputs)
    val gasPriceLabel = stringResource(R.string.translation_costAnalysis_calculator_gasPrice)
    val mpgLabel = stringResource(R.string.translation_costAnalysis_calculator_mpg)
    val electricityRateLabel = stringResource(R.string.translation_costAnalysis_calculator_elecRate)
    val resetLabel = stringResource(R.string.translation_costAnalysis_calculator_reset)
    val comparisonTitle = stringResource(R.string.translation_costAnalysis_calculator_comparison)
    val gasCostLabel = stringResource(R.string.translation_costAnalysis_calculator_gasCost)
    val evCostLabel = stringResource(R.string.translation_costAnalysis_calculator_evCost)
    val totalSavingsLabel = stringResource(R.string.translation_costAnalysis_calculator_totalSavings)
    val overPeriodLabel = stringResource(R.string.translation_costAnalysis_calculator_overPeriod)
    val monthlySavingsLabel = stringResource(R.string.translation_costAnalysis_calculator_monthlySavings)
    val perYearLabel = stringResource(R.string.translation_costAnalysis_calculator_perYear)
    val noDataLabel = stringResource(R.string.translation_costAnalysis_calculator_noData)
    return remember(
        title,
        inputsTitle,
        gasPriceLabel,
        mpgLabel,
        electricityRateLabel,
        resetLabel,
        comparisonTitle,
        gasCostLabel,
        evCostLabel,
        totalSavingsLabel,
        overPeriodLabel,
        monthlySavingsLabel,
        perYearLabel,
        noDataLabel,
    ) {
        SavingsCalculatorStrings(
            title = title,
            inputsTitle = inputsTitle,
            gasPriceLabel = gasPriceLabel,
            mpgLabel = mpgLabel,
            electricityRateLabel = electricityRateLabel,
            resetLabel = resetLabel,
            comparisonTitle = comparisonTitle,
            gasCostLabel = gasCostLabel,
            evCostLabel = evCostLabel,
            totalSavingsLabel = totalSavingsLabel,
            overPeriodLabel = overPeriodLabel,
            monthlySavingsLabel = monthlySavingsLabel,
            perYearLabel = perYearLabel,
            noDataLabel = noDataLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [locale] so the numeric substitution is locale-correct — the same render-only concern the sibling surfaces
 * resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSavingsFreshnessFormatter(locale: Locale): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

/** The active configuration [Locale] (the first in the locale list), falling back to the JVM default. */
@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SavingsCalculatorStrings(
        title = "Gas vs Electric Savings Calculator",
        inputsTitle = "Your Assumptions",
        gasPriceLabel = "Gas Price (\$/gal)",
        mpgLabel = "Gas Car MPG",
        electricityRateLabel = "Electricity Rate (\$/kWh)",
        resetLabel = "Reset Defaults",
        comparisonTitle = "Comparison",
        gasCostLabel = "Gas Cost (equivalent)",
        evCostLabel = "EV Cost (actual)",
        totalSavingsLabel = "Total Savings",
        overPeriodLabel = "over selected period",
        monthlySavingsLabel = "Monthly Savings",
        perYearLabel = "/ year",
        noDataLabel = "Not enough data for comparison",
    )

private val PREVIEW_BASE_STATS =
    SavingsBaseStats(
        totalEnergyKwh = 300.0,
        totalCost = 50.0,
        totalDistanceDisplay = 900.0,
        monthCount = 5,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SavingsCalculatorLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsCalculatorContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SavingsCalculatorEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsCalculatorContent(
            state = UiState(UiPhase.Empty, data = null),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SavingsCalculatorErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsCalculatorContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SavingsCalculatorContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsCalculatorContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BASE_STATS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SavingsCalculatorOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsCalculatorContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_BASE_STATS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
