// Native Compose render layer for the Lightbox shared surface — the parity port of the web immersive image
// viewer (web/src/components/ui/Lightbox.tsx). It is a thin, stateless view over the pure
// [LightboxProjection] + the [LightboxViewModel]'s gallery [UiState] feed: it owns no business logic,
// performs no HTTP, and renders every phase the prompt's state matrix mandates — loading (skeleton chrome),
// content (the navigable, zoomable viewer), empty (a friendly empty state instead of the web's blank
// `return null`), a hard error (a `QueryError`-equivalent with retry), and the stale/offline freshness
// envelope (a chip + a one-shot auto-refresh). Within the content phase it reproduces the web viewer's full
// composition: the `n / total` counter, the close affordance, prev/next navigation disabled at the
// gallery's bounds, the per-image decode skeleton, drag-to-pan while zoomed, the caption, and the zoom
// out / level / in / reset cluster — every control localized through the P1/S10 catalog and labelled for
// TalkBack. Hardware-keyboard shortcuts (←/→, Home/End, +/-, 0, Esc) mirror the web key handling; touch
// users drive the same actions through the on-screen controls.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Lightbox) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.lightbox

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered overlay in any state. */
const val LIGHTBOX_TEST_TAG: String = "lightbox"
const val LIGHTBOX_COUNTER_TAG: String = "lightbox-counter"
const val LIGHTBOX_CLOSE_TAG: String = "lightbox-close"
const val LIGHTBOX_PREV_TAG: String = "lightbox-prev"
const val LIGHTBOX_NEXT_TAG: String = "lightbox-next"
const val LIGHTBOX_IMAGE_TAG: String = "lightbox-image"
const val LIGHTBOX_SKELETON_TAG: String = "lightbox-skeleton"
const val LIGHTBOX_CAPTION_TAG: String = "lightbox-caption"
const val LIGHTBOX_ZOOM_OUT_TAG: String = "lightbox-zoom-out"
const val LIGHTBOX_ZOOM_IN_TAG: String = "lightbox-zoom-in"
const val LIGHTBOX_ZOOM_LEVEL_TAG: String = "lightbox-zoom-level"
const val LIGHTBOX_ZOOM_RESET_TAG: String = "lightbox-zoom-reset"
const val LIGHTBOX_RETRY_TAG: String = "lightbox-retry"

private val SKELETON_HEIGHT: Dp = 220.dp
private const val SKELETON_FRACTION: Float = 0.7f
private const val SCRIM_DARKEN: Float = 0.96f
private const val PREVIEW_STAMP: Long = 1_700_000_000_000L

/**
 * The host-supplied renderer for one slide — the seam that keeps the surface decoupled from any image
 * library (web `<img src>`). It receives the [LightboxSlide] and an `onDecoded` callback to invoke once the
 * image has loaded (web `onLoad`/`onError` → `setDecoded(true)`), which hides the decode skeleton. A host
 * typically wires a Coil `AsyncImage` here; the default renders a neutral, immediately-decoded fill so
 * previews and tests need no network.
 */
internal typealias LightboxSlideRenderer = @Composable BoxScope.(slide: LightboxSlide, onDecoded: () -> Unit) -> Unit

/**
 * Stateful entry point — the parity port of the web `<Lightbox open onClose images>`. Compose it
 * conditionally (`if (open) Lightbox(...)`), the Compose idiom for the web `open` prop; it hosts the
 * immersive overlay in a full-screen [Dialog] whose scrim/back-press dismissal mirrors the web backdrop +
 * Esc. Records the one-shot `view.opened` diagnostic (P1/S11) on first composition, collects the gallery
 * [UiState], and renders the responsive chrome.
 *
 * @param viewModel the state holder bound to the shared gallery store.
 * @param onClose invoked on close (web `onClose`); the caller stops composing this surface in response.
 * @param slideContent the host image renderer; defaults to a neutral, immediately-decoded fill.
 */
@Composable
fun Lightbox(
    viewModel: LightboxViewModel,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    slideContent: LightboxSlideRenderer = { slide, onDecoded -> DefaultLightboxSlide(slide, onDecoded) },
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberLightboxStrings()
    val state by viewModel.state.collectAsStateWithLifecycle()

    Dialog(
        onDismissRequest = onClose,
        properties =
            DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = true,
                dismissOnClickOutside = false,
            ),
    ) {
        LightboxChrome(
            state = state,
            strings = strings,
            onClose = onClose,
            modifier = modifier,
            onRetry = viewModel::retry,
            slideContent = slideContent,
        )
    }
}

/**
 * Stateless overlay chrome — renders the surface in every phase the bound gallery feed reports. Hoisted out
 * of the ViewModel so it is preview- and screenshot-testable for each state, and so the on-device UI test
 * can drive it directly with deterministic strings. The root carries the surface test tag and a near-opaque
 * dark scrim (web `--bg-app/95`) with white content, the immersive photo-viewer surface.
 */
@Composable
fun LightboxChrome(
    state: UiState<LightboxGallery>,
    strings: LightboxStrings,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    slideContent: LightboxSlideRenderer = { slide, onDecoded -> DefaultLightboxSlide(slide, onDecoded) },
) {
    Surface(
        modifier = modifier.fillMaxSize().testTag(LIGHTBOX_TEST_TAG),
        color = MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM_DARKEN),
        contentColor = Color.White,
    ) {
        when (state.phase) {
            UiPhase.Loading -> LightboxMessageScaffold(strings, onClose) { LightboxLoading(strings) }
            UiPhase.Empty -> LightboxMessageScaffold(strings, onClose) { EmptyState(message = strings.empty, icon = TeslaGlyphs.Eye) }
            UiPhase.Error ->
                LightboxMessageScaffold(strings, onClose) {
                    QueryError(kind = LightboxProjection.queryErrorKind(state), onRetry = onRetry)
                }
            UiPhase.Content ->
                LightboxViewer(
                    gallery = state.data ?: LightboxGallery(emptyList()),
                    strings = strings,
                    freshness = LightboxProjection.freshness(state),
                    onClose = onClose,
                    onRetry = onRetry,
                    slideContent = slideContent,
                )
        }
    }
}

/**
 * Shared scaffold for the non-content phases (loading / empty / error): an always-present, labelled close
 * affordance in the top bar so the immersive overlay is never a trap, with the phase's [body] centered
 * beneath it.
 */
@Composable
private fun LightboxMessageScaffold(
    strings: LightboxStrings,
    onClose: () -> Unit,
    body: @Composable BoxScope.() -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.End,
        ) {
            LightboxCloseButton(strings.close, onClose)
        }
        Box(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.Center,
            content = body,
        )
    }
}

/** Loading chrome — a large shimmering stand-in for the resolving gallery image. */
@Composable
private fun LightboxLoading(strings: LightboxStrings) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.xl2)
                .semantics { contentDescription = strings.loading },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_FRACTION, height = SKELETON_HEIGHT, rounded = true)
        Skeleton(widthFraction = 0.4f, height = 12.dp, rounded = true)
    }
}

/**
 * The immersive viewer — the content phase. Holds the [LightboxViewerState] (index / zoom / pan / decoded)
 * in [remember] keyed on the gallery, and renders the web composition: a top bar (counter + close), the
 * pannable image area with its decode skeleton and bounded prev/next navigation, and a bottom bar (caption +
 * zoom controls). A stale/offline gallery shows a leading freshness chip; a stale gallery additionally kicks
 * a one-shot auto-refresh.
 */
@Composable
private fun LightboxViewer(
    gallery: LightboxGallery,
    strings: LightboxStrings,
    freshness: LightboxFreshness,
    onClose: () -> Unit,
    onRetry: () -> Unit,
    slideContent: LightboxSlideRenderer,
) {
    var viewer by remember(gallery) { mutableStateOf(LightboxProjection.initialViewerState(gallery)) }
    val total = gallery.total
    val slide = LightboxProjection.currentSlide(gallery, viewer) ?: return
    val counterText = strings.counter(viewer.index + 1, total)
    val reduceMotion = rememberReducedMotion()

    LaunchedEffect(freshness) {
        if (freshness == LightboxFreshness.Stale) onRetry()
    }

    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .focusRequester(focusRequester)
                .focusable()
                .onKeyEvent { event ->
                    val command = handleLightboxKey(event) ?: return@onKeyEvent false
                    if (command == LightboxCommand.Close) {
                        onClose()
                    } else {
                        viewer = nextStateForCommand(command, viewer, total)
                    }
                    true
                }.semantics { paneTitle = counterText },
    ) {
        LightboxTopBar(counterText = counterText, closeLabel = strings.close, onClose = onClose)
        if (freshness != LightboxFreshness.Live) {
            LightboxFreshnessRow(freshness = freshness, strings = strings, reduceMotion = reduceMotion, onRetry = onRetry)
        }
        Box(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.Center,
        ) {
            LightboxImage(slide = slide, viewer = viewer, onPan = { dx, dy -> viewer = LightboxProjection.pan(viewer, dx, dy) }) {
                slideContent(slide) { viewer = LightboxProjection.markDecoded(viewer) }
            }
            if (!viewer.decoded) {
                Skeleton(
                    modifier = Modifier.fillMaxWidth(SKELETON_FRACTION).testTag(LIGHTBOX_SKELETON_TAG),
                    height = SKELETON_HEIGHT,
                    rounded = true,
                )
            }
            if (total > 1) {
                IconButton(
                    imageVector = TeslaGlyphs.ChevronLeft,
                    contentDescription = strings.previous,
                    onClick = { viewer = LightboxProjection.goPrev(viewer, total) },
                    enabled = !LightboxProjection.atFirst(viewer),
                    modifier = Modifier.align(Alignment.CenterStart).padding(Spacing.sm).testTag(LIGHTBOX_PREV_TAG),
                    size = IconSize.Xl,
                    tint = Color.White,
                )
                IconButton(
                    imageVector = TeslaGlyphs.ChevronRight,
                    contentDescription = strings.next,
                    onClick = { viewer = LightboxProjection.goNext(viewer, total) },
                    enabled = !LightboxProjection.atLast(viewer, total),
                    modifier = Modifier.align(Alignment.CenterEnd).padding(Spacing.sm).testTag(LIGHTBOX_NEXT_TAG),
                    size = IconSize.Xl,
                    tint = Color.White,
                )
            }
        }
        LightboxBottomBar(
            slide = slide,
            viewer = viewer,
            strings = strings,
            onZoomOut = { viewer = LightboxProjection.zoomOut(viewer) },
            onZoomIn = { viewer = LightboxProjection.zoomIn(viewer) },
            onZoomReset = { viewer = LightboxProjection.zoomReset(viewer) },
        )
    }
}

/** Top bar — the counter (a polite live region so navigation is announced) and the close affordance. */
@Composable
private fun LightboxTopBar(
    counterText: String,
    closeLabel: String,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = counterText,
            modifier = Modifier.testTag(LIGHTBOX_COUNTER_TAG).semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.labelLarge,
            color = Color.White,
        )
        LightboxCloseButton(closeLabel, onClose)
    }
}

/** The close affordance — a labelled icon button reused by every phase's top bar. */
@Composable
private fun LightboxCloseButton(
    closeLabel: String,
    onClose: () -> Unit,
) {
    IconButton(
        imageVector = TeslaGlyphs.Close,
        contentDescription = closeLabel,
        onClick = onClose,
        modifier = Modifier.testTag(LIGHTBOX_CLOSE_TAG),
        size = IconSize.Lg,
        tint = Color.White,
    )
}

/** The pannable, zoomable image host — wraps the host [slideContent] in the transform + drag surface. */
@Composable
private fun LightboxImage(
    slide: LightboxSlide,
    viewer: LightboxViewerState,
    onPan: (Float, Float) -> Unit,
    slideContent: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .testTag(LIGHTBOX_IMAGE_TAG)
                .graphicsLayer {
                    scaleX = viewer.zoom
                    scaleY = viewer.zoom
                    translationX = viewer.panX
                    translationY = viewer.panY
                }.pointerInput(viewer.index, viewer.isZoomed) {
                    detectDragGestures { change, dragAmount ->
                        if (viewer.isZoomed) {
                            change.consume()
                            onPan(dragAmount.x, dragAmount.y)
                        }
                    }
                }.semantics {
                    if (slide.alt.isNotBlank()) contentDescription = slide.alt
                },
        contentAlignment = Alignment.Center,
        content = slideContent,
    )
}

/** Bottom bar — the optional caption and the zoom out / level / in / reset cluster with their bounds. */
@Composable
private fun LightboxBottomBar(
    slide: LightboxSlide,
    viewer: LightboxViewerState,
    strings: LightboxStrings,
    onZoomOut: () -> Unit,
    onZoomIn: () -> Unit,
    onZoomReset: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        val caption = slide.caption
        if (!caption.isNullOrBlank()) {
            Text(
                text = caption,
                modifier = Modifier.widthIn(max = CAPTION_MAX_WIDTH).testTag(LIGHTBOX_CAPTION_TAG),
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = CAPTION_ALPHA),
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            IconButton(
                imageVector = TeslaGlyphs.Minus,
                contentDescription = strings.zoomOut,
                onClick = onZoomOut,
                enabled = viewer.canZoomOut,
                modifier = Modifier.testTag(LIGHTBOX_ZOOM_OUT_TAG),
                size = IconSize.Md,
                tint = Color.White,
            )
            Text(
                text = strings.zoomPercent(viewer.zoomPercent),
                modifier = Modifier.testTag(LIGHTBOX_ZOOM_LEVEL_TAG).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.labelMedium,
                color = Color.White,
            )
            IconButton(
                imageVector = TeslaGlyphs.Plus,
                contentDescription = strings.zoomIn,
                onClick = onZoomIn,
                enabled = viewer.canZoomIn,
                modifier = Modifier.testTag(LIGHTBOX_ZOOM_IN_TAG),
                size = IconSize.Md,
                tint = Color.White,
            )
            Button(
                label = strings.zoomReset,
                onClick = onZoomReset,
                modifier = Modifier.testTag(LIGHTBOX_ZOOM_RESET_TAG),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = viewer.resetEnabled,
            )
        }
    }
}

/** The leading freshness row shown over a cached gallery: a chip, plus a retry affordance when offline. */
@Composable
private fun LightboxFreshnessRow(
    freshness: LightboxFreshness,
    strings: LightboxStrings,
    reduceMotion: Boolean,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        when (freshness) {
            LightboxFreshness.Offline ->
                StatusPill(text = strings.offline, tone = StatusTone.Danger)
            LightboxFreshness.Stale ->
                StatusPill(text = strings.stale, tone = StatusTone.Warning, pulse = !reduceMotion)
            LightboxFreshness.Live -> Unit
        }
        if (freshness == LightboxFreshness.Offline) {
            Button(
                label = strings.retry,
                onClick = onRetry,
                modifier = Modifier.testTag(LIGHTBOX_RETRY_TAG),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The default, immediately-decoded slide fill — a neutral surface so previews/tests need no network. */
@Composable
private fun BoxScope.DefaultLightboxSlide(
    slide: LightboxSlide,
    onDecoded: () -> Unit,
) {
    LaunchedEffect(slide.src) { onDecoded() }
    Box(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = NEUTRAL_FILL_ALPHA)),
    )
}

/** The viewer commands the keyboard shortcuts map to — the native analogue of the web key handler cases. */
private enum class LightboxCommand { Prev, Next, First, Last, ZoomIn, ZoomOut, ZoomReset, Close }

/**
 * Maps a hardware-keyboard [event] to a [LightboxCommand], mirroring the web key handling (←/→ navigate,
 * Home/End jump, +/= zoom in, - zoom out, 0 reset, Esc close). Returns `null` when the key is not handled.
 */
private fun handleLightboxKey(event: KeyEvent): LightboxCommand? {
    if (event.type != KeyEventType.KeyDown) return null
    return when (event.key) {
        Key.DirectionLeft -> LightboxCommand.Prev
        Key.DirectionRight -> LightboxCommand.Next
        Key.MoveHome -> LightboxCommand.First
        Key.MoveEnd -> LightboxCommand.Last
        Key.Plus, Key.Equals -> LightboxCommand.ZoomIn
        Key.Minus -> LightboxCommand.ZoomOut
        Key.Zero -> LightboxCommand.ZoomReset
        Key.Escape -> LightboxCommand.Close
        else -> null
    }
}

/** Applies a navigation/zoom [command] to the viewer [state]; [LightboxCommand.Close] leaves it unchanged. */
private fun nextStateForCommand(
    command: LightboxCommand,
    state: LightboxViewerState,
    total: Int,
): LightboxViewerState =
    when (command) {
        LightboxCommand.Prev -> LightboxProjection.goPrev(state, total)
        LightboxCommand.Next -> LightboxProjection.goNext(state, total)
        LightboxCommand.First -> LightboxProjection.goFirst(state, total)
        LightboxCommand.Last -> LightboxProjection.goLast(state, total)
        LightboxCommand.ZoomIn -> LightboxProjection.zoomIn(state)
        LightboxCommand.ZoomOut -> LightboxProjection.zoomOut(state)
        LightboxCommand.ZoomReset -> LightboxProjection.zoomReset(state)
        LightboxCommand.Close -> state
    }

/** Builds the localized chrome labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberLightboxStrings(): LightboxStrings {
    val counterTemplate = stringResource(R.string.translation_lightbox_counter, "%1\$s", "%2\$s")
    val zoomTemplate = stringResource(R.string.translation_lightbox_zoomPercent, "%1\$s")
    return LightboxStrings(
        close = stringResource(R.string.translation_lightbox_close),
        previous = stringResource(R.string.translation_lightbox_previous),
        next = stringResource(R.string.translation_lightbox_next),
        zoomOut = stringResource(R.string.translation_lightbox_zoomOut),
        zoomIn = stringResource(R.string.translation_lightbox_zoomIn),
        zoomReset = stringResource(R.string.translation_lightbox_zoomReset),
        loading = stringResource(R.string.translation_common_loading),
        empty = stringResource(R.string.translation_common_noData),
        error = stringResource(R.string.translation_error_loadFailed),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        retry = stringResource(R.string.translation_common_retry),
        counter = { current, total -> counterTemplate.format(current.toString(), total.toString()) },
        zoomPercent = { value -> zoomTemplate.format(value.toString()) },
    )
}

private val CAPTION_MAX_WIDTH: Dp = 520.dp
private const val CAPTION_ALPHA: Float = 0.85f
private const val NEUTRAL_FILL_ALPHA: Float = 0.4f

// ── Previews — one per rendered state (loading / content / multi / empty / error / stale / offline). ──

private fun previewStrings(): LightboxStrings =
    LightboxStrings(
        close = "Close image viewer",
        previous = "Previous image",
        next = "Next image",
        zoomOut = "Zoom out",
        zoomIn = "Zoom in",
        zoomReset = "Reset zoom",
        loading = "Loading",
        empty = "No data available",
        error = "Failed to load data",
        stale = "Stale",
        offline = "Offline",
        retry = "Retry",
        counter = { current, total -> "$current / $total" },
        zoomPercent = { value -> "$value%" },
    )

private fun sampleGallery(count: Int = 3): LightboxGallery =
    LightboxGallery(
        slides =
            List(count) { i ->
                LightboxSlide(src = "preview-$i", alt = "Sample image ${i + 1}", caption = "Vehicle photo ${i + 1}")
            },
    )

@Composable
private fun PreviewLightbox(state: UiState<LightboxGallery>) {
    TeslaSyncTheme(dynamicColor = false) {
        LightboxChrome(state = state, strings = previewStrings(), onClose = {}, onRetry = {})
    }
}

@Preview(name = "Lightbox · loading", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxLoadingPreview() = PreviewLightbox(UiState.loading())

@Preview(name = "Lightbox · content", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxContentPreview() = PreviewLightbox(UiState(UiPhase.Content, data = sampleGallery(), fetchedAt = PREVIEW_STAMP))

@Preview(name = "Lightbox · single", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxSinglePreview() = PreviewLightbox(UiState(UiPhase.Content, data = sampleGallery(count = 1), fetchedAt = PREVIEW_STAMP))

@Preview(name = "Lightbox · empty", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxEmptyPreview() = PreviewLightbox(UiState(UiPhase.Empty, data = LightboxGallery(emptyList()), fetchedAt = PREVIEW_STAMP))

@Preview(name = "Lightbox · error", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxErrorPreview() = PreviewLightbox(UiState(UiPhase.Error, errorKind = ErrorKind.Unknown))

@Preview(name = "Lightbox · stale", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxStalePreview() =
    PreviewLightbox(UiState(UiPhase.Content, data = sampleGallery(), fetchedAt = PREVIEW_STAMP, stale = true, refreshing = true))

@Preview(name = "Lightbox · offline", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun LightboxOfflinePreview() =
    PreviewLightbox(
        UiState(UiPhase.Content, data = sampleGallery(), fetchedAt = PREVIEW_STAMP, stale = true, errorKind = ErrorKind.Network),
    )
