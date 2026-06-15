// The native Jetpack Compose + Material 3 YearReviewPage analytics surface — a parity port of
// web/src/features/analytics/pages/YearReviewPage.tsx, the full-screen annual recap story deck. It reproduces the
// page's three render states (the building-your-review loading screen, the no-driving-data screen, and the
// twelve-slide deck), the `useVehicles` scope picker + auto-selected default, and the swipe-style slide
// navigation chrome (progress bar, tap zones, prev/next arrows, close, slide counter) — every visible string
// resolved from the generated res/values catalog `yearReview.*` (ADR-014).
//
// Composition: [YearReviewPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the year-review feed + the live vehicle options +
// selection); [YearReviewPageContent] is the stateless render layer (the three states); [YearReviewDeck] draws
// the slide deck. Each slide body is the concrete child feature-view (TitleSlide … SummarySlide), dispatched by
// the shared [SlideRenderer] and decoded from the single year-review document in the framework-free model
// (YearReviewPageModel.kt). The eleventh slide (Comparisons) has no child feature-view in the repo yet, so its
// body is drawn here from the model's `comparisonsFrom` decode — never a blank or empty region (ADR-011).
//
// Divergence (Honesty Covenant #9 — documented, not silent): the web page renders an optional
// `<AIYearReviewNarration>` overlay below the slide counter. That is a SEPARATE shared surface (its own P3
// prompt); its production data source — the AI-mode feature gate + the `/ai/.../narrate` SSE stream client — is,
// by that surface's own header, an out-of-scope, not-yet-shipped shared-core AI-streaming bundle that the app's
// DataContainer does not expose, and wiring it is outside this page's allowed-files scope. The overlay renders
// nothing in the baseline off-mode anyway, and is not one of this unit's parity items, so it is omitted here.
//
// SI-canonical: every distance/energy/efficiency value is read SI off the wire and converted to the user's units
// ONLY inside the child slide surfaces (their own `useUnits` ports); this page routes the raw SI document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.analytics.yearreview

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.feature.views.summaryslide.SummarySlide
import io.teslasync.android.feature.views.summaryslide.SummarySlideSource
import io.teslasync.android.featureviews.chargingbreakdownslide.ChargingBreakdownSlide
import io.teslasync.android.featureviews.drivehighlightslide.DriveHighlightSlide
import io.teslasync.android.featureviews.environmentslide.EnvironmentSlide
import io.teslasync.android.featureviews.patternsslide.PatternsSlide
import io.teslasync.android.featureviews.patternsslide.PatternsSlideData
import io.teslasync.android.featureviews.savingsslide.SavingsSlide
import io.teslasync.android.featureviews.sliderenderer.DriveHighlightField
import io.teslasync.android.featureviews.sliderenderer.SLIDE_DEFS
import io.teslasync.android.featureviews.sliderenderer.SlideContent
import io.teslasync.android.featureviews.sliderenderer.SlideRenderer
import io.teslasync.android.featureviews.statchartslide.StatChartSlide
import io.teslasync.android.featureviews.statchartslide.parseStatChartData
import io.teslasync.android.featureviews.statheroslide.StatHeroSlide
import io.teslasync.android.featureviews.statheroslide.parseStatHero
import io.teslasync.android.featureviews.titleslide.TitleSlide
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlin.math.max
import kotlin.math.min

/** The immersive story backdrop (web `bg-black`); the slide gradients are painted over it by [SlideRenderer]. */
private val STORY_BACKDROP: Color = Color.Black

/** Light story-chrome inks for the fixed-dark backdrop (web `--text-secondary` / `--text-muted` on `bg-black`). */
private val CHROME_PRIMARY: Color = Color.White
private val CHROME_SECONDARY: Color = Color.White.copy(alpha = 0.72f)
private val CHROME_MUTED: Color = Color.White.copy(alpha = 0.5f)

/** Progress-segment inks (web past/current bright, future dim). */
private val PROGRESS_ON: Color = Color.White.copy(alpha = 0.85f)
private val PROGRESS_OFF: Color = Color.White.copy(alpha = 0.22f)

/** The translucent card behind each comparison fact (web `bg-white/[0.05] border-white/[0.08]`). */
private val FACT_CARD_FILL: Color = Color.White.copy(alpha = 0.06f)

private val PROGRESS_HEIGHT = 3.dp
private val SELECTOR_MAX_WIDTH = 260.dp
private val FACT_EMOJI_SIZE = 28.sp
private const val FACTS_PER_ROW = 2

/** A unique view-model key for the embedded SummarySlide child so it keeps its own holder within the deck. */
private const val SUMMARY_INSTANCE_KEY: String = "YearReviewPage:summary"

// ── Stateful entry point ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [YearReviewPageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Analytics holders via [yearReviewPageSourceOf]) for the recap [year]. [logger] defaults to the app's
 * redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun YearReviewPage(
    source: YearReviewPageSource,
    year: Int,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: YearReviewPageViewModel =
        viewModel(
            key = YearReviewPageRegistration.SLUG,
            factory = viewModelFactory { initializer { YearReviewPageViewModel(source, year, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val vehicleOptions by viewModel.vehicleOptions.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()

    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher

    YearReviewPageContent(
        state = state,
        year = viewModel.year,
        vehicleOptions = vehicleOptions,
        selectedVehicleId = selectedVehicleId,
        summarySource = viewModel.summarySource,
        onSelectVehicle = viewModel::select,
        onClose = { backDispatcher?.onBackPressed() },
        modifier = modifier,
    )
}

// ── Stateless content ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the full-screen black story surface (web `fixed inset-0 bg-black`) carrying the
 * accessible page title (web `usePageTitle`), then one of the three render states: the building-your-review
 * loader (web `isLoading || !data`), the no-driving-data screen (web `total_drives === 0 && total_charge_sessions
 * === 0`), or the slide deck.
 */
@Composable
fun YearReviewPageContent(
    state: UiState<JsonElement>,
    year: Int,
    vehicleOptions: List<YearReviewVehicleOption>,
    selectedVehicleId: Long?,
    summarySource: SummarySlideSource,
    onSelectVehicle: (Long) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pageTitle = stringResource(R.string.translation_yearReview_pageTitle, year.toString())
    val data = state.data
    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(STORY_BACKDROP)
                .semantics { paneTitle = pageTitle },
    ) {
        when {
            state.isEmpty -> YearReviewNoData(year = yearOf(data, year), onGoBack = onClose)
            state.isContent && data != null ->
                YearReviewDeck(
                    data = data,
                    year = year,
                    vehicleOptions = vehicleOptions,
                    selectedVehicleId = selectedVehicleId,
                    summarySource = summarySource,
                    onSelectVehicle = onSelectVehicle,
                    onClose = onClose,
                )
            else -> YearReviewLoading()
        }
    }
}

/** The first-load surface — a centered spinner + caption (web full-screen `Spinner` + `yearReview.loading`). */
@Composable
private fun YearReviewLoading() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Spinner(label = stringResource(R.string.translation_yearReview_loading))
    }
}

/**
 * The no-data surface (web second short-circuit) — a centered 🚗 + "No driving data for {year}" + the hint + a
 * Go Back affordance, all on the black backdrop.
 */
@Composable
private fun YearReviewNoData(
    year: Int,
    onGoBack: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = NO_DATA_EMOJI, fontSize = 56.sp)
        Spacer(Modifier.height(Spacing.md))
        Text(
            text = stringResource(R.string.translation_yearReview_noData, year.toString()),
            style = MaterialTheme.typography.titleLarge,
            color = CHROME_SECONDARY,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Spacing.xs))
        Text(
            text = stringResource(R.string.translation_yearReview_noDataHint),
            style = MaterialTheme.typography.bodyMedium,
            color = CHROME_MUTED,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Spacing.lg))
        Button(
            label = stringResource(R.string.translation_yearReview_goBack),
            onClick = onGoBack,
            variant = ButtonVariant.Ghost,
        )
    }
}

// ── Slide deck ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The twelve-slide deck (web success branch). [SlideRenderer] paints the current slide's gradient + child body;
 * the page overlays the progress bar, the vehicle scope picker (only when more than one vehicle is enrolled), the
 * left/right tap zones + prev/next arrows, the close affordance, and the slide counter. Switching vehicles resets
 * the deck to the first slide (web `setSlideIndex(0)`), keyed via [rememberSaveable].
 */
@Composable
private fun YearReviewDeck(
    data: JsonElement,
    year: Int,
    vehicleOptions: List<YearReviewVehicleOption>,
    selectedVehicleId: Long?,
    summarySource: SummarySlideSource,
    onSelectVehicle: (Long) -> Unit,
    onClose: () -> Unit,
) {
    val slides = SLIDE_DEFS
    val lastIndex = slides.lastIndex
    var slideIndex by rememberSaveable(selectedVehicleId) { mutableIntStateOf(0) }
    val safeIndex = slideIndex.coerceIn(0, lastIndex)
    val goPrev = { slideIndex = max(safeIndex - 1, 0) }
    val goNext = { slideIndex = min(safeIndex + 1, lastIndex) }

    Box(modifier = Modifier.fillMaxSize()) {
        SlideRenderer(
            slideIndex = safeIndex,
            slide = slides[safeIndex],
            data = data,
            modifier = Modifier.fillMaxSize(),
        ) { content ->
            YearReviewSlideBody(
                content = content,
                summarySource = summarySource,
                selectedVehicleId = selectedVehicleId,
                year = year,
            )
        }

        // Tap navigation zones (web left/right thirds) — below the controls so the arrows/close win their hits.
        SlideTapZones(onPrev = goPrev, onNext = goNext)

        SlideProgressBar(
            count = slides.size,
            index = safeIndex,
            modifier = Modifier.align(Alignment.TopStart).fillMaxWidth().padding(Spacing.md),
        )

        if (vehicleOptions.size > 1) {
            VehicleScopePicker(
                options = vehicleOptions,
                selectedVehicleId = selectedVehicleId,
                onSelect = onSelectVehicle,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = Spacing.lg),
            )
        }

        if (safeIndex > 0) {
            IconButton(
                imageVector = YearReviewPageGlyphs.ChevronLeft,
                contentDescription = stringResource(R.string.translation_yearReview_prev),
                onClick = goPrev,
                tint = CHROME_SECONDARY,
                variant = IconButtonVariant.Standard,
                modifier = Modifier.align(Alignment.CenterStart).padding(Spacing.xs),
            )
        }
        if (safeIndex < lastIndex) {
            IconButton(
                imageVector = YearReviewPageGlyphs.ChevronRight,
                contentDescription = stringResource(R.string.translation_yearReview_next),
                onClick = goNext,
                tint = CHROME_SECONDARY,
                variant = IconButtonVariant.Standard,
                modifier = Modifier.align(Alignment.CenterEnd).padding(Spacing.xs),
            )
        }

        IconButton(
            imageVector = YearReviewPageGlyphs.Close,
            contentDescription = stringResource(R.string.translation_yearReview_close),
            onClick = onClose,
            tint = CHROME_PRIMARY,
            variant = IconButtonVariant.Standard,
            modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.xs),
        )

        Text(
            text = "${safeIndex + 1} / ${slides.size}",
            style = MaterialTheme.typography.bodySmall,
            color = CHROME_MUTED,
            modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.md),
        )
    }
}

/**
 * Dispatches the [SlideRenderer]-resolved [content] to its concrete child feature-view, decoding the slice it
 * needs from the year-review document in the framework-free model. The web `SlideRenderer` threads the same
 * `data` to each `<*Slide />`; the Comparisons slide (no child feature-view yet) is drawn by [ComparisonsSlideBody]
 * and the self-contained Summary slide binds the shared [summarySource] for [selectedVehicleId] / [year].
 */
@Composable
private fun YearReviewSlideBody(
    content: SlideContent,
    summarySource: SummarySlideSource,
    selectedVehicleId: Long?,
    year: Int,
) {
    when (content) {
        is SlideContent.Title -> TitleSlide(data = titleSlideDataOf(content.data))
        is SlideContent.StatHero -> StatHeroSlide(data = parseStatHero(content.data), field = content.field)
        is SlideContent.StatChart -> StatChartSlide(data = parseStatChartData(content.data))
        is SlideContent.DriveHighlight ->
            DriveHighlightSlide(
                drive = driveHighlightOf(content.data, longest = content.field == DriveHighlightField.Longest),
                label = content.label,
                emoji = content.emoji,
            )
        is SlideContent.ChargingBreakdown -> ChargingBreakdownSlide(data = chargingBreakdownDataOf(content.data))
        is SlideContent.Savings -> SavingsSlide(data = savingsDataOf(content.data))
        is SlideContent.Environment -> EnvironmentSlide(data = environmentDataOf(content.data))
        is SlideContent.Patterns -> PatternsSlide(data = PatternsSlideData.parse(content.data))
        is SlideContent.Comparisons -> ComparisonsSlideBody(comparisons = comparisonsFrom(content.data))
        is SlideContent.Summary ->
            SummarySlide(
                source = summarySource,
                vehicleId = selectedVehicleId,
                year = year,
                instanceKey = SUMMARY_INSTANCE_KEY,
            )
        is SlideContent.Unknown -> Unit
    }
}

/**
 * The Comparisons slide body (web `ComparisonsSlide`) — no child feature-view exists yet, so it is drawn here:
 * the "Fun facts about your year" subtitle over a two-up grid of emoji/label/value fact cards (web grid).
 */
@Composable
private fun ComparisonsSlideBody(comparisons: List<YearReviewComparison>) {
    Column(
        modifier = Modifier.fillMaxSize().padding(Spacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(R.string.translation_yearReview_funFacts),
            style = MaterialTheme.typography.titleLarge,
            color = CHROME_SECONDARY,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Spacing.lg))
        comparisons.chunked(FACTS_PER_ROW).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth().widthIn(max = SELECTOR_MAX_WIDTH.times(2)),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { fact -> ComparisonFactCard(fact = fact, modifier = Modifier.weight(1f)) }
                repeat(FACTS_PER_ROW - rowItems.size) { Spacer(Modifier.weight(1f)) }
            }
            Spacer(Modifier.height(Spacing.sm))
        }
    }
}

/** One fun-fact card — emoji over label over value, in a translucent rounded tile (web fact card). */
@Composable
private fun ComparisonFactCard(
    fact: YearReviewComparison,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Spacing.md))
                .background(FACT_CARD_FILL)
                .padding(Spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(text = fact.emoji, fontSize = FACT_EMOJI_SIZE)
        Text(
            text = fact.label,
            style = MaterialTheme.typography.titleSmall,
            color = CHROME_PRIMARY,
            textAlign = TextAlign.Center,
        )
        Text(
            text = fact.value,
            style = MaterialTheme.typography.bodySmall,
            color = CHROME_SECONDARY,
            textAlign = TextAlign.Center,
        )
    }
}

// ── Story chrome ─────────────────────────────────────────────────────────────────────────────────────────────

/** The top progress bar — one segment per slide; past/current bright, future dim (web progress bar). */
@Composable
private fun SlideProgressBar(
    count: Int,
    index: Int,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        repeat(count) { i ->
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .height(PROGRESS_HEIGHT)
                        .clip(RoundedCornerShape(PROGRESS_HEIGHT))
                        .background(if (i <= index) PROGRESS_ON else PROGRESS_OFF),
            )
        }
    }
}

/** The full-bleed left/right tap zones (web third-width zones); the middle third is inert, as in the web. */
@Composable
private fun SlideTapZones(
    onPrev: () -> Unit,
    onNext: () -> Unit,
) {
    val prevLabel = stringResource(R.string.translation_yearReview_prev)
    val nextLabel = stringResource(R.string.translation_yearReview_next)
    Row(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClickLabel = prevLabel,
                        onClick = onPrev,
                    ),
        )
        Box(modifier = Modifier.weight(1f).fillMaxHeight())
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClickLabel = nextLabel,
                        onClick = onNext,
                    ),
        )
    }
}

/** The vehicle scope picker (web `<ControlSelect>`), shown only when more than one vehicle is enrolled. */
@Composable
private fun VehicleScopePicker(
    options: List<YearReviewVehicleOption>,
    selectedVehicleId: Long?,
    onSelect: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(R.string.translation_yearReview_selectVehicle)
    Select(
        options = options.map { SelectOption(value = it.value, label = it.label) },
        selectedValue = selectedVehicleId?.toString(),
        onSelect = { value -> value.toLongOrNull()?.let(onSelect) },
        modifier =
            modifier
                .width(SELECTOR_MAX_WIDTH)
                .semantics { contentDescription = label },
    )
}

/** The decorative 🚗 glyph on the no-data screen (web `🚗`); not an i18n string. */
private const val NO_DATA_EMOJI: String = "\uD83D\uDE97"
