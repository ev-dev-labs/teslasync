// The native Jetpack Compose + Material 3 SlideRenderer feature view — a parity port of
// web/src/features/analytics/components/review/SlideRenderer.tsx. The web component is a purely-
// presentational dispatcher: its parent (the Year-in-Review page) loads the `YearReview` document and
// passes it down with the current `slide` + `slideIndex`; the component switches on `slide.type`, renders
// one of ten child slides inside an `AnimatePresence` + `motion.div` keyed by `slideIndex` (a fade +
// horizontal slide), over a `bg-gradient-to-br ${slide.bg}` background.
//
// The ten child slides are separate, out-of-scope surfaces (each its own P3 prompt), so this view binds no
// child body of its own. It reproduces exactly what `SlideRenderer.tsx` owns — the per-slide gradient, the
// keyed slide transition, the `type` → [SlideContent] dispatch (incl. the drive-highlight branch's drive
// selection + i18n label + emoji), and the two `useTranslation` labels (mapped to the i18n catalog P1/S10)
// — and hands the resolved [SlideContent] to a host-provided `slideContent` slot that wires the concrete
// child surfaces (the idiomatic Compose port of the web import-and-dispatch composition).
//
// The web component assumes a present `data` (its parent gates loading/empty). The native surface instead
// binds the shared P1/S8 cache-then-network feed as a [UiState] and renders every lifecycle state that
// layer can carry — a loading slide, a hard-error slide with retry, a friendly empty slide, content, and
// stale/offline (a freshness chip + auto-refresh) — all inside the slide's gradient frame so the surface
// is never a blank box. A web-parity overload taking the raw `data` document is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SlideRenderer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sliderenderer

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.effectiveDurationMs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Web `transition={{ duration: 0.35 }}` — the slide enter/exit duration in milliseconds. */
private const val SLIDE_TRANSITION_MS: Int = 350

/** Web `initial={{ x: 50 }}` / `exit={{ x: -50 }}` — the enter/exit horizontal travel. */
private val SLIDE_OFFSET = 50.dp

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for one Year-in-Review slide. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared review feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`) and the [slideContent] slot that renders
 * the concrete child surface for the dispatched [SlideContent]; this view never performs HTTP.
 *
 * @param slideIndex the deck position (web `slideIndex`) — the key the slide transition animates on.
 * @param slide the slide definition (web `slide`): its `type`, gradient `bg`, and optional `field`.
 * @param state the cache-then-network projection of the `YearReview` document (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param slideContent host slot that maps a resolved [SlideContent] to its child slide composable.
 */
@Composable
fun SlideRenderer(
    slideIndex: Int,
    slide: SlideDefinition,
    state: UiState<JsonElement>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    slideContent: @Composable (SlideContent) -> Unit,
) {
    LaunchedEffect(Unit) { recordSlideRendererOpened(logger) }
    SlideRendererContent(
        slideIndex = slideIndex,
        slide = slide,
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        slideContent = slideContent,
    )
}

/**
 * Web-parity overload mirroring the web component's `data: YearReview` prop, for hosts that already hold
 * the loaded document. Projects [data] onto a content [UiState] (there is no fetch behind it, so it offers
 * no retry affordance) and records `view.opened` like the stateful entry.
 */
@Composable
fun SlideRenderer(
    slideIndex: Int,
    slide: SlideDefinition,
    data: JsonElement,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    slideContent: @Composable (SlideContent) -> Unit,
) {
    val state = remember(data) { UiState(phase = UiPhase.Content, data = data) }
    SlideRenderer(
        slideIndex = slideIndex,
        slide = slide,
        state = state,
        onRetry = {},
        modifier = modifier,
        logger = logger,
        slideContent = slideContent,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web frame (the
 * `slide.bg` gradient + the keyed slide transition over the dispatched child) and adds the lifecycle chrome
 * the host's feed implies: a loading slide, a hard-error retry slide, a friendly empty slide, and a
 * freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. Every state is painted inside the slide's gradient so the surface is never a
 * blank box.
 */
@Composable
fun SlideRendererContent(
    slideIndex: Int,
    slide: SlideDefinition,
    state: UiState<JsonElement>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: SlideRendererStrings = rememberSlideRendererStrings(),
    slideContent: @Composable (SlideContent) -> Unit,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    Box(modifier = modifier.fillMaxSize()) {
        val data = state.data
        when {
            state.isLoading -> SlideLoading(background = slide.background)
            state.isError -> SlideError(background = slide.background, onRetry = onRetry)
            data == null || !hasReviewData(data) -> SlideEmpty(background = slide.background)
            else -> {
                AnimatedSlide(
                    slideIndex = slideIndex,
                    slide = slide,
                    data = data,
                    strings = strings,
                    slideContent = slideContent,
                )
                if (state.stale || state.refreshing || state.hasError) {
                    SlideFreshnessOverlay(
                        state = state,
                        modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.sm),
                    )
                }
            }
        }
    }
}

/**
 * The animated slide frame — the native analogue of `AnimatePresence mode="wait"` + `motion.div` keyed by
 * `slideIndex`. Resolves the [SlideContent] for ([slide], [data]) and cross-fades + horizontally slides the
 * gradient frame + child body whenever [slideIndex] changes (an instant swap under reduced motion). The
 * gradient lives inside the animated content so it travels with the body, exactly as the web `motion.div`
 * carries its `bg-gradient-to-br` class.
 */
@Composable
private fun AnimatedSlide(
    slideIndex: Int,
    slide: SlideDefinition,
    data: JsonElement,
    strings: SlideRendererStrings,
    slideContent: @Composable (SlideContent) -> Unit,
) {
    val durationMs = effectiveDurationMs(rememberReducedMotion(), SLIDE_TRANSITION_MS)
    val slidePx = with(LocalDensity.current) { SLIDE_OFFSET.roundToPx() }
    val frame =
        remember(slideIndex, slide, data, strings) {
            ResolvedSlideFrame(
                slideIndex = slideIndex,
                background = slide.background,
                content = SlideRendererProjection.resolve(slide, data, strings),
            )
        }
    AnimatedContent(
        targetState = frame,
        modifier = Modifier.fillMaxSize(),
        transitionSpec = {
            val fadeSpec = tween<Float>(durationMs, easing = MotionDefaults.standard)
            val offsetSpec = tween<IntOffset>(durationMs, easing = MotionDefaults.standard)
            (fadeIn(fadeSpec) + slideInHorizontally(offsetSpec) { slidePx }) togetherWith
                (fadeOut(fadeSpec) + slideOutHorizontally(offsetSpec) { -slidePx })
        },
        contentKey = { it.slideIndex },
        label = "slide-renderer",
    ) { current ->
        SlideFrame(background = current.background) {
            slideContent(current.content)
        }
    }
}

/** The equatable per-slide state [AnimatedSlide] animates over; [slideIndex] is the transition key. */
private data class ResolvedSlideFrame(
    val slideIndex: Int,
    val background: SlideBackground,
    val content: SlideContent,
)

/** A full-bleed slide surface painted with [background]'s diagonal gradient (web `bg-gradient-to-br`). */
@Composable
private fun SlideFrame(
    background: SlideBackground,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier.fillMaxSize().background(background.toBrush()),
        content = content,
    )
}

/** Loading slide — the gradient frame with a centered, TalkBack-labeled spinner. */
@Composable
private fun SlideLoading(background: SlideBackground) {
    val label = stringResource(R.string.translation_common_loading)
    SlideFrame(background = background) {
        Spinner(modifier = Modifier.align(Alignment.Center), label = label)
    }
}

/** Hard-error slide — the gradient frame with a centered retry surface (the web `QueryError` equivalent). */
@Composable
private fun SlideError(
    background: SlideBackground,
    onRetry: () -> Unit,
) {
    SlideFrame(background = background) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.align(Alignment.Center).padding(Spacing.lg),
        )
    }
}

/** Empty slide — the gradient frame with a centered friendly "no year-in-review data" state. */
@Composable
private fun SlideEmpty(background: SlideBackground) {
    SlideFrame(background = background) {
        EmptyState(
            message = stringResource(R.string.translation_widget_yearReview_noData),
            icon = FormsGlyphs.Calendar,
            modifier = Modifier.align(Alignment.Center).padding(Spacing.lg),
        )
    }
}

/** Freshness chip overlaid on a content slide when the feed is refreshing / stale / offline. */
@Composable
private fun SlideFreshnessOverlay(
    state: UiState<JsonElement>,
    modifier: Modifier = Modifier,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        modifier = modifier,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSlideFreshnessFormatter(),
    )
}

/** Builds [SlideBackground]'s three Tailwind `*-900` stops into a top-left → bottom-right linear brush. */
private fun SlideBackground.toBrush(): Brush = Brush.linearGradient(listOf(Color(from), Color(via), Color(to)))

/**
 * Builds the localized [SlideRendererStrings] from the i18n catalog (P1/S10): the `yearReview.longestDrive`
 * + `yearReview.mostEfficient` keys the web `renderSlideContent` reads. Remembered against the resolved
 * strings so a locale change re-resolves the labels.
 */
@Composable
fun rememberSlideRendererStrings(): SlideRendererStrings {
    val longestDrive = stringResource(R.string.translation_yearReview_longestDrive)
    val mostEfficient = stringResource(R.string.translation_yearReview_mostEfficient)
    return remember(longestDrive, mostEfficient) {
        SlideRendererStrings(longestDrive = longestDrive, mostEfficient = mostEfficient)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure model.
 */
@Composable
private fun rememberSlideFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; render every state with a demo slot) ─────────────────────────────────────

/** A minimal demo slot for previews — names the dispatched [content] kind / drive-highlight label. */
@Composable
private fun PreviewSlideBody(content: SlideContent) {
    val text =
        when (content) {
            is SlideContent.DriveHighlight -> "${content.emoji} ${content.label}"
            else -> content.kind.name
        }
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text = text, color = Color.White)
    }
}

private val PREVIEW_DATA: JsonElement =
    buildJsonObject {
        put("year", 2026)
        put(
            "longest_drive",
            buildJsonObject {
                put("drive_id", 42)
                put("date", "2026-04-04")
                put("distance_km", 412.5)
                put("duration_min", 287)
                put("start_address", "San Jose, CA")
                put("end_address", "Los Angeles, CA")
                put("efficiency_wh_km", 165.0)
            },
        )
    }

private val PREVIEW_STRINGS = SlideRendererStrings(longestDrive = "Longest Drive", mostEfficient = "Most Efficient Drive")

@Preview(name = "Content — drive highlight")
@Composable
private fun SlideRendererContentPreview() {
    TeslaSyncTheme {
        SlideRendererContent(
            slideIndex = 3,
            slide = SLIDE_DEFS[3],
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            slideContent = { PreviewSlideBody(it) },
        )
    }
}

@Preview(name = "Stale — freshness chip")
@Composable
private fun SlideRendererStalePreview() {
    TeslaSyncTheme {
        SlideRendererContent(
            slideIndex = 0,
            slide = SLIDE_DEFS[0],
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA, stale = true, fetchedAt = 1L),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            slideContent = { PreviewSlideBody(it) },
        )
    }
}

@Preview(name = "Loading")
@Composable
private fun SlideRendererLoadingPreview() {
    TeslaSyncTheme {
        SlideRendererContent(
            slideIndex = 0,
            slide = SLIDE_DEFS[0],
            state = UiState(phase = UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            slideContent = { PreviewSlideBody(it) },
        )
    }
}

@Preview(name = "Error")
@Composable
private fun SlideRendererErrorPreview() {
    TeslaSyncTheme {
        SlideRendererContent(
            slideIndex = 5,
            slide = SLIDE_DEFS[5],
            state = UiState(phase = UiPhase.Error),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            slideContent = { PreviewSlideBody(it) },
        )
    }
}

@Preview(name = "Empty")
@Composable
private fun SlideRendererEmptyPreview() {
    TeslaSyncTheme {
        SlideRendererContent(
            slideIndex = 11,
            slide = SLIDE_DEFS[11],
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            slideContent = { PreviewSlideBody(it) },
        )
    }
}
