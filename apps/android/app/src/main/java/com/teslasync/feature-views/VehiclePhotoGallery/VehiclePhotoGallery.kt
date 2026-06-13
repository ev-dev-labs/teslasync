// The native Jetpack Compose + Material 3 VehiclePhotoGallery feature view — a parity port of
// web/src/features/vehicles/components/VehiclePhotoGallery.tsx. The web component is a display-only wrapper
// around the shared Lightbox: given `photos` (`LightboxImage[]` of `{ src, alt, caption }`) and an optional
// `vehicleName`, it renders a responsive square thumbnail grid (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4`)
// whose `<ul>` carries the "{{name}} photo gallery" / "Photo gallery" group label, each thumbnail a
// `<button aria-label="Open photo {{i+1}} of {{total}}">` that opens the shared `<Lightbox>` at that index;
// when `photos` is empty it renders a dashed-border empty-state card (Image icon + "No photos uploaded yet."
// + "Photos uploaded for this vehicle will appear here.") instead of a blank box.
//
// This port keeps that contract end to end and performs NO HTTP. Two entry points are offered. The web-parity
// overload takes the photo list directly (the web component likewise receives `photos` as a prop and never
// fetches) and renders exactly the source's two branches — empty and populated. The host may instead supply
// the photos through the shared P1/S8 state-holder layer as a [UiState], so this view also renders every
// lifecycle state that layer can produce — the loading skeleton grid, the hard-error retry surface, the
// friendly empty card, the populated grid, and the stale/offline "last known + retry" freshness chrome the
// sibling surfaces standardize — without ever fetching. The lightbox image itself is supplied through the
// [image] slot (defaulting to a token-styled image surface), mirroring the shared Lightbox's own decoupling
// from any image-loading library; a host wires real pixels there. Every string resolves through the i18n
// catalog (P1/S10), and the one `view.opened` diagnostic carries the surface slug (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehiclePhotoGallery — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclephotogallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Lightbox
import io.teslasync.android.components.ui.LightboxImage
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Layout constants (named, token-derived) ────────────────────────────────────────────────────────────────

/** Em dash shown for an unknown freshness age — the shared freshness "no value" fallback. */
internal const val EM_DASH: String = "\u2014"

/** Inter-cell + inter-row gap — the web `gap-3`. */
private val GRID_GAP: Dp = Spacing.md

/** Width at/above which the grid steps from 2 → 3 columns — the web `sm:` breakpoint, mapped to the Material
 * compact→medium boundary. */
private val MEDIUM_WIDTH_BREAKPOINT: Dp = 600.dp

/** Width at/above which the grid steps from 3 → 4 columns — the web `md:` breakpoint, mapped to the Material
 * medium→expanded boundary. */
private val EXPANDED_WIDTH_BREAKPOINT: Dp = 840.dp

/** Phone-baseline column count — the web `grid-cols-2`. */
private const val COLUMNS_COMPACT: Int = 2

/** Medium-width column count — the web `sm:grid-cols-3`. */
private const val COLUMNS_MEDIUM: Int = 3

/** Expanded-width column count — the web `md:grid-cols-4`. */
private const val COLUMNS_EXPANDED: Int = 4

/** First-load skeleton row count, so the loading grid is never blank. */
private const val SKELETON_ROWS: Int = 2

/** Low-alpha wash behind a thumbnail's image surface — the web `bg-[var(--surface-1)]`. */
private const val TILE_FILL_ALPHA: Float = 0.35f

/** Low-alpha wash behind the empty-state card — the web `bg-[var(--surface-1)]/50`. */
private const val EMPTY_FILL_ALPHA: Float = 0.5f

/** Dashed-outline on/off lengths for the empty-state card — the web `border-dashed`. */
private val DASH_ON: Dp = 6.dp
private val DASH_OFF: Dp = 4.dp

/** Authored glyph geometry (lucide stroke style). */
private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the [galleryLabel]
 * group label (web `{{name}} photo gallery` / `Photo gallery`), the empty-state [empty] + [emptyHelp] lines,
 * and the [openLabel] interpolator (web `Open photo {{index}} of {{total}}`). The lightbox control labels and
 * the lifecycle chrome (loading / error / freshness) are resolved inline at their call sites, so this holder
 * stays a thin content carrier.
 */
data class VehiclePhotoGalleryStrings(
    val galleryLabel: String,
    val empty: String,
    val emptyHelp: String,
    val openLabel: (position: Int, total: Int) -> String,
)

/**
 * Stateful entry point for the vehicle photo gallery. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the host's photo feed (P1/S8) can carry. The host owns the feed
 * and any retry; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the vehicle's photos.
 * @param vehicleName optional display name used to compose the gallery group label (web `vehicleName`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param image renders one photo's pixels into the given [Modifier]; defaults to a token-styled image surface,
 *   and is reused for both the thumbnail and the full-screen lightbox image so a host wires its loader once.
 */
@Composable
fun VehiclePhotoGallery(
    state: UiState<List<VehiclePhoto>>,
    modifier: Modifier = Modifier,
    vehicleName: String? = null,
    onRetry: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    image: @Composable (slide: VehiclePhotoSlide, modifier: Modifier) -> Unit = { _, tileModifier ->
        PhotoImageTile(tileModifier)
    },
) {
    LaunchedEffect(Unit) { recordVehiclePhotoGalleryOpened(logger) }
    VehiclePhotoGalleryContent(
        state = state,
        modifier = modifier,
        vehicleName = vehicleName,
        onRetry = onRetry,
        image = image,
    )
}

/**
 * Web-parity overload mirroring the web component's loaded `photos` prop, for hosts that already hold the
 * photos. A `null`/empty list renders the empty-state card (web `photos.length === 0`); otherwise the grid
 * renders. Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no retry.
 */
@Composable
fun VehiclePhotoGallery(
    photos: List<VehiclePhoto>?,
    modifier: Modifier = Modifier,
    vehicleName: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
    image: @Composable (slide: VehiclePhotoSlide, modifier: Modifier) -> Unit = { _, tileModifier ->
        PhotoImageTile(tileModifier)
    },
) {
    val state =
        remember(photos) {
            val items = photos ?: emptyList()
            UiState(phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content, data = items)
        }
    VehiclePhotoGallery(state = state, modifier = modifier, vehicleName = vehicleName, logger = logger, image = image)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's empty / populated branches and adds the lifecycle chrome the host's feed implies: a first-load
 * skeleton grid, a hard-error retry surface, and a freshness chip that reflects refreshing / stale / offline.
 * Stale (non-error) data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 */
@Composable
fun VehiclePhotoGalleryContent(
    state: UiState<List<VehiclePhoto>>,
    modifier: Modifier = Modifier,
    vehicleName: String? = null,
    onRetry: () -> Unit = {},
    image: @Composable (slide: VehiclePhotoSlide, modifier: Modifier) -> Unit = { _, tileModifier ->
        PhotoImageTile(tileModifier)
    },
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val strings = rememberVehiclePhotoGalleryStrings(vehicleName)
    val result = remember(state.data) { VehiclePhotoGalleryProjection.project(state.data ?: emptyList()) }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when {
            state.isLoading -> VehiclePhotoGalleryLoading(stringResource(R.string.translation_common_loading))
            state.isError -> VehiclePhotoGalleryError(onRetry = onRetry)
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    VehiclePhotoGalleryFreshnessRow(state)
                }
                if (result.isEmpty) {
                    VehiclePhotoGalleryEmpty(strings = strings)
                } else {
                    VehiclePhotoGalleryGallery(slides = result.slides, strings = strings, image = image)
                }
            }
        }
    }
}

/**
 * The populated gallery — the web grid plus the shared lightbox. Owns only the ephemeral open / active-index UI
 * state (the web `useState`): tapping a thumbnail opens the [Lightbox] at that index; navigation and zoom are
 * the shared component's concern.
 */
@Composable
private fun VehiclePhotoGalleryGallery(
    slides: List<VehiclePhotoSlide>,
    strings: VehiclePhotoGalleryStrings,
    image: @Composable (slide: VehiclePhotoSlide, modifier: Modifier) -> Unit,
) {
    val lightboxImages =
        remember(slides) {
            slides.map { LightboxImage(contentDescription = it.alt, caption = it.caption) }
        }
    var open by rememberSaveable { mutableStateOf(false) }
    var activeIndex by rememberSaveable { mutableIntStateOf(0) }

    VehiclePhotoGalleryGrid(
        slides = slides,
        galleryLabel = strings.galleryLabel,
        openLabel = strings.openLabel,
        image = image,
        onOpen = { index ->
            activeIndex = index
            open = true
        },
    )

    if (open) {
        Lightbox(
            images = lightboxImages,
            index = activeIndex,
            onIndexChange = { activeIndex = it },
            onClose = { open = false },
            closeLabel = stringResource(R.string.translation_lightbox_close),
            previousLabel = stringResource(R.string.translation_lightbox_previous),
            nextLabel = stringResource(R.string.translation_lightbox_next),
            zoomInLabel = stringResource(R.string.translation_lightbox_zoomIn),
            zoomOutLabel = stringResource(R.string.translation_lightbox_zoomOut),
            resetLabel = stringResource(R.string.translation_lightbox_zoomReset),
        ) { idx ->
            image(slides[idx], Modifier.fillMaxSize())
        }
    }
}

/**
 * The populated thumbnail grid — the web `<ul>`. Column count steps 2 → 3 → 4 with available width (the web
 * `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`); the container carries the gallery group label, and the photos
 * are chunked into weighted rows with a trailing spacer so the last row's cells keep their square size.
 */
@Composable
private fun VehiclePhotoGalleryGrid(
    slides: List<VehiclePhotoSlide>,
    galleryLabel: String,
    openLabel: (position: Int, total: Int) -> String,
    image: @Composable (slide: VehiclePhotoSlide, modifier: Modifier) -> Unit,
    onOpen: (index: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = galleryLabel },
    ) {
        val columns = columnsFor(maxWidth)
        Column(verticalArrangement = Arrangement.spacedBy(GRID_GAP)) {
            slides.chunked(columns).forEach { rowSlides ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GRID_GAP),
                ) {
                    rowSlides.forEach { slide ->
                        PhotoThumbnail(
                            slide = slide,
                            openLabel = openLabel(slide.position, slide.total),
                            onClick = { onOpen(slide.position - 1) },
                            image = image,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowSlides.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * One tappable square thumbnail — the web `<button>`. Carries the "Open photo {{index}} of {{total}}" label
 * and the Button role for TalkBack, clips its image surface, and opens the lightbox via [onClick]. The image
 * pixels come from the [image] slot; the inner content is decorative so TalkBack announces only the button.
 */
@Composable
private fun PhotoThumbnail(
    slide: VehiclePhotoSlide,
    openLabel: String,
    onClick: () -> Unit,
    image: @Composable (slide: VehiclePhotoSlide, modifier: Modifier) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(Radius.md)
    Box(
        modifier =
            modifier
                .aspectRatio(1f)
                .clip(shape)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    contentDescription = openLabel
                }.clickable(onClick = onClick),
    ) {
        image(slide, Modifier.fillMaxSize())
    }
}

/**
 * The default rendering for a photo's pixels when the host wires no image loader — a token surface centered on
 * the framed-image glyph. Reused for the thumbnail and the lightbox image; a host overrides the [image] slot to
 * draw real pixels (the shared Lightbox is likewise decoupled from any image-loading library).
 */
@Composable
private fun PhotoImageTile(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TILE_FILL_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = ImageGlyph,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The empty-state card — web parity for the `photos.length === 0` branch: a dashed-outline rounded card with a
 * muted Image icon, the "No photos uploaded yet." primary line, and the "Photos uploaded for this vehicle will
 * appear here." help line, so the surface is never a blank box. The card carries the primary message as its
 * TalkBack description.
 */
@Composable
private fun VehiclePhotoGalleryEmpty(
    strings: VehiclePhotoGalleryStrings,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(Radius.lg)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = EMPTY_FILL_ALPHA))
                .dashedBorder(MaterialTheme.colorScheme.outlineVariant, Radius.lg)
                .padding(vertical = Spacing.xl3, horizontal = Spacing.lg)
                .semantics { contentDescription = strings.empty },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = ImageGlyph,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BodyText(strings.empty, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(strings.emptyHelp)
    }
}

/**
 * First-load skeleton grid — a shimmering grid of square tiles in the same responsive column layout as the
 * content, so the surface is never blank while the first fetch is in flight. The accessible label marks the
 * region as loading for TalkBack.
 */
@Composable
private fun VehiclePhotoGalleryLoading(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
    ) {
        val columns = columnsFor(maxWidth)
        val cellSize = ((maxWidth - GRID_GAP * (columns - 1)) / columns).coerceAtLeast(0.dp)
        Column(verticalArrangement = Arrangement.spacedBy(GRID_GAP)) {
            repeat(SKELETON_ROWS) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GRID_GAP),
                ) {
                    repeat(columns) {
                        Skeleton(modifier = Modifier.weight(1f), height = cellSize, rounded = false)
                    }
                }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun VehiclePhotoGalleryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the grid when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance the sibling surfaces standardize. Offline (a failed refresh over cached
 * data) reads the localized "Offline" label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun VehiclePhotoGalleryFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberVehiclePhotoFreshnessFormatter(),
        )
    }
}

/** Maps available width to the responsive column count (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-4`). */
private fun columnsFor(maxWidth: Dp): Int =
    when {
        maxWidth < MEDIUM_WIDTH_BREAKPOINT -> COLUMNS_COMPACT
        maxWidth < EXPANDED_WIDTH_BREAKPOINT -> COLUMNS_MEDIUM
        else -> COLUMNS_EXPANDED
    }

/**
 * Builds the localized [VehiclePhotoGalleryStrings] from the i18n catalog (P1/S10): the `vehicles.photos.*`
 * keys the web component reads. The gallery group label picks the named or generic variant by [vehicleName]
 * (web `vehicleName ? galleryNamed : gallery`); the "Open photo {{index}} of {{total}}" interpolation resolves
 * through `Context.getString` per the active locale.
 */
@Composable
private fun rememberVehiclePhotoGalleryStrings(vehicleName: String?): VehiclePhotoGalleryStrings {
    val context = LocalContext.current
    val gallery = stringResource(R.string.translation_vehicles_photos_gallery)
    val galleryLabel =
        vehicleName
            ?.takeIf { it.isNotBlank() }
            ?.let { stringResource(R.string.translation_vehicles_photos_galleryNamed, it) }
            ?: gallery
    val empty = stringResource(R.string.translation_vehicles_photos_empty)
    val emptyHelp = stringResource(R.string.translation_vehicles_photos_emptyHelp)
    return remember(context, galleryLabel, empty, emptyHelp) {
        VehiclePhotoGalleryStrings(
            galleryLabel = galleryLabel,
            empty = empty,
            emptyHelp = emptyHelp,
            openLabel = { position, total ->
                context.getString(R.string.translation_vehicles_photos_openAt, position, total)
            },
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberVehiclePhotoFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Strokes a dashed rounded-rect outline behind the content — the web `border-dashed` empty-state affordance. */
private fun Modifier.dashedBorder(
    color: Color,
    cornerRadius: Dp,
    strokeWidth: Dp = 1.dp,
): Modifier =
    drawBehind {
        val radius = cornerRadius.toPx()
        drawRoundRect(
            color = color,
            cornerRadius = CornerRadius(radius, radius),
            style =
                Stroke(
                    width = strokeWidth.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH_ON.toPx(), DASH_OFF.toPx()), 0f),
                ),
        )
    }

// ── Authored lucide-style glyph ────────────────────────────────────────────────────────────────────────────
// The web empty state + thumbnails draw the lucide `image` icon. Android bundles no lucide set, and a feature
// view may not expand the shared icon library from a surface prompt, so it is authored here as a 24×24 stroked
// vector (a frame, a sun disc, and a mountain ridge) — recolored at render time by the `Icon` tint, exactly as
// the sibling surfaces author their glyphs.

/** lucide `image` — a frame holding a sun disc above a mountain ridge. */
private val ImageGlyph: ImageVector =
    strokedImageGlyph("Image") {
        moveTo(3f, 4f)
        lineTo(21f, 4f)
        lineTo(21f, 20f)
        lineTo(3f, 20f)
        close()
        circleApprox(8.5f, 9f, 1.7f)
        moveTo(4f, 18f)
        lineTo(9f, 12.5f)
        lineTo(13f, 16.5f)
        lineTo(16f, 13.5f)
        lineTo(20f, 18f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun strokedImageGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
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
                pathBuilder = build,
            )
        }.build()

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circleApprox(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Previews (tooling-only) ────────────────────────────────────────────────────────────────────────────────

private fun previewPhotos(): List<VehiclePhoto> =
    listOf(
        VehiclePhoto(src = "front.jpg", alt = "Front three-quarter", caption = "Front"),
        VehiclePhoto(src = "side.jpg", alt = "Driver side"),
        VehiclePhoto(src = "rear.jpg", alt = "Rear three-quarter"),
        VehiclePhoto(src = "interior.jpg", alt = "Interior"),
    )

@Preview(name = "Populated gallery", showBackground = true)
@Composable
private fun VehiclePhotoGalleryPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoGalleryContent(
            state = UiState(phase = UiPhase.Content, data = previewPhotos()),
            vehicleName = "Model 3 Performance",
        )
    }
}

@Preview(name = "Empty gallery", showBackground = true)
@Composable
private fun VehiclePhotoGalleryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoGalleryContent(state = UiState(phase = UiPhase.Empty, data = emptyList()))
    }
}

@Preview(name = "Loading gallery", showBackground = true)
@Composable
private fun VehiclePhotoGalleryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoGalleryContent(state = UiState(phase = UiPhase.Loading))
    }
}

@Preview(name = "Error gallery", showBackground = true)
@Composable
private fun VehiclePhotoGalleryErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePhotoGalleryContent(state = UiState(phase = UiPhase.Error))
    }
}
