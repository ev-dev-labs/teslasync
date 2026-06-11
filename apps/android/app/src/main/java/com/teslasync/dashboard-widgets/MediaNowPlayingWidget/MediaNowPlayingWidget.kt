// The native Jetpack Compose + Material 3 Now Playing dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a Music-iconed title + freshness header)
// wrapping one of: the centered compact 1×1 hero (Music icon + title + artist), or the standard / tall
// body (a Music icon tile + title / artist / — when tall — album, an optional "Playing" chip, a track
// progress bar with elapsed / duration clocks, and — when tall — the source row and the volume row), or a
// friendly empty state when no media snapshot is present. All data flows through the shared
// [MediaNowPlayingWidgetViewModel] (P1/S8); the view never performs HTTP. Media carries no SI units so
// nothing is unit-converted here; every string resolves through the i18n catalog (P1/S10) and every
// interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MediaNowPlayingWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.medianowplaying

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Binds the shared vehicles + latest-media feeds via [source] into a
 * [MediaNowPlayingWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 vehicles data
 * layer) and a unique [instanceKey] per placement; an explicit [vehicleId] pins the surface to one vehicle
 * (web `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun MediaNowPlayingWidget(
    source: MediaNowPlayingSource,
    modifier: Modifier = Modifier,
    size: MediaNowPlayingSize = MediaNowPlayingRegistration.DEFAULT_SIZE,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = MediaNowPlayingRegistration.ID,
) {
    val viewModel: MediaNowPlayingWidgetViewModel =
        viewModel(key = instanceKey, factory = MediaNowPlayingWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    MediaNowPlayingWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the Music title + freshness
 * header over the compact / standard / tall now-playing body, or the empty state. The web media widget
 * does not pass `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the header
 * freshness chip (offline) + the refresh control (the retry affordance) above the empty body — never a
 * blanked panel — and a stale/offline cached snapshot keeps its now-playing body visible with the
 * freshness chip flagged.
 */
@Composable
fun MediaNowPlayingWidgetContent(
    state: UiState<JsonElement>,
    size: MediaNowPlayingSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> MediaLoading(modifier)
        else -> MediaLoaded(state = state, size = size, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun MediaLoaded(
    state: UiState<JsonElement>,
    size: MediaNowPlayingSize,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val display = remember(state.data, size) { MediaNowPlayingProjection.project(state.data, size) }
    Column(modifier = modifier.fillMaxSize()) {
        MediaHeader(state = state, size = size, onRefresh = onRefresh)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            when {
                !display.hasData -> MediaEmpty()
                display.isCompact -> MediaCompact(display)
                else -> MediaStandard(display)
            }
        }
    }
}

@Composable
private fun MediaHeader(
    state: UiState<JsonElement>,
    size: MediaNowPlayingSize,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!size.isCompact) {
            Icon(
                imageVector = MediaMusicGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(
                stringResource(R.string.translation_widget_nowPlaying),
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
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

// ── Compact 1×1 hero (web `isCompact`) ────────────────────────────────────────────────────────────────
@Composable
private fun MediaCompact(display: MediaNowPlayingDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            imageVector = MediaMusicGlyph,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
        BodyText(display.title, maxLines = 1)
        BodyText(display.artist, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

// ── Standard / tall body (web non-compact branch) ─────────────────────────────────────────────────────
@Composable
private fun MediaStandard(display: MediaNowPlayingDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MediaTrackRow(display)
        if (display.showProgress) {
            MediaProgress(display)
        }
        val source = display.source
        if (display.isTall) {
            if (source != null) MediaSourceRow(source)
            if (display.showVolume) MediaVolumeRow(fraction = display.volumeFraction, volumeText = display.volumeText)
        } else if (source != null) {
            MediaSourceRow(source)
        }
    }
}

@Composable
private fun MediaTrackRow(display: MediaNowPlayingDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MediaIconTile()
        Column(modifier = Modifier.weight(1f)) {
            BodyText(display.title, maxLines = 1)
            BodyText(display.artist, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            val album = display.album
            if (display.isTall && album != null) {
                BodyText(album, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        if (display.isPlaying) {
            Badge(stringResource(R.string.translation_widget_playing), variant = BadgeVariant.Success)
        }
    }
}

@Composable
private fun MediaIconTile() {
    Box(
        modifier =
            Modifier
                .size(ICON_TILE_SIZE)
                .clip(RoundedCornerShape(Radius.md))
                .background(TeslaTokens.status.info.copy(alpha = ICON_TILE_WASH_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = MediaMusicGlyph,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
    }
}

@Composable
private fun MediaProgress(display: MediaNowPlayingDisplay) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        MediaBar(fraction = display.progressFraction, fillColor = TeslaTokens.status.info)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            MetricLabel(display.elapsedText)
            MetricLabel(display.durationText)
        }
    }
}

@Composable
private fun MediaSourceRow(source: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = MediaRadioGlyph,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BodyText(source, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

@Composable
private fun MediaVolumeRow(
    fraction: Float,
    volumeText: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = MediaVolumeGlyph,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // The web volume bar fills with var(--surface-2) — the track color — so its level reads as a flat
        // track; the native bar uses a subdued onSurfaceVariant fill so the level is a visible, polished,
        // accessible readout alongside the numeric value (data + composition are otherwise identical).
        MediaBar(
            fraction = fraction,
            fillColor = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        MetricLabel(volumeText)
    }
}

/** Thin rounded track with a proportional [fraction] fill — the web `h-1 rounded-full` progress/volume bar. */
@Composable
private fun MediaBar(
    fraction: Float,
    fillColor: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .height(BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(fillColor),
        )
    }
}

@Composable
private fun MediaEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noMedia),
        icon = MediaMusicGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun MediaLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

/**
 * Builds the localized relative-age formatter the header freshness chip folds [FreshnessAge] buckets
 * through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

// ── Local glyphs — the web `Music` / `Radio` / `Volume2` (lucide), authored as 24×24 stroked vectors. The
// data-display layer ships none of these and this surface's allowed files cannot extend that catalog, so
// they are hand-authored here, mirroring the approach in components/datadisplay/DataDisplayGlyphs and the
// sibling ClimateStatusWidget's local thermometer glyph. ──────────────────────────────────────────────

private fun mediaGlyph(
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

private val MediaMusicGlyph: ImageVector =
    mediaGlyph("MediaMusic") {
        // Two stems joined by a top beam, with a note head at the foot of each (lucide `Music`).
        moveTo(9f, 18f)
        lineTo(9f, 5f)
        lineTo(20f, 3f)
        lineTo(20f, 16f)
        glyphCircle(6f, 18f, 3f)
        glyphCircle(17f, 16f, 3f)
    }

private val MediaRadioGlyph: ImageVector =
    mediaGlyph("MediaRadio") {
        // A center tuner dot flanked by near + far broadcast arcs on each side (lucide `Radio`).
        glyphCircle(12f, 12f, 1.6f)
        moveTo(8.5f, 8.7f)
        arcTo(4.5f, 4.5f, 0f, false, false, 8.5f, 15.3f)
        moveTo(15.5f, 8.7f)
        arcTo(4.5f, 4.5f, 0f, false, true, 15.5f, 15.3f)
        moveTo(6f, 6.2f)
        arcTo(7.5f, 7.5f, 0f, false, false, 6f, 17.8f)
        moveTo(18f, 6.2f)
        arcTo(7.5f, 7.5f, 0f, false, true, 18f, 17.8f)
    }

private val MediaVolumeGlyph: ImageVector =
    mediaGlyph("MediaVolume") {
        // Speaker cone (face right) plus a small + large sound wave on the right (lucide `Volume2`).
        moveTo(11f, 5f)
        lineTo(6f, 9f)
        lineTo(2f, 9f)
        lineTo(2f, 15f)
        lineTo(6f, 15f)
        lineTo(11f, 19f)
        close()
        moveTo(15.5f, 9f)
        arcTo(3.5f, 3.5f, 0f, false, true, 15.5f, 15f)
        moveTo(18.5f, 6.5f)
        arcTo(6.5f, 6.5f, 0f, false, true, 18.5f, 17.5f)
    }

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (note heads / tuner dot). */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private val ICON_TILE_SIZE = 40.dp
private const val ICON_TILE_WASH_ALPHA = 0.12f
private val BAR_HEIGHT = 4.dp
private const val LOADING_BAR_COUNT = 4
private val LOADING_BAR_HEIGHT = 16.dp

// ── Previews — one per rendered state (content / compact / empty / loading / error / offline). ──────────

private fun previewMedia(): JsonElement =
    buildJsonObject {
        put("now_playing_title", "Starlight")
        put("now_playing_artist", "Muse")
        put("now_playing_album", "Black Holes and Revelations")
        put("playback_source", "Spotify")
        put("playback_status", "Playing")
        put("now_playing_duration", 240_000.0)
        put("now_playing_elapsed", 72_000.0)
        put("audio_volume", 7.0)
        put("audio_volume_max", 11.0)
    }

@Preview(name = "Media · content", showBackground = true)
@Composable
private fun MediaContentPreview() {
    TeslaSyncTheme {
        MediaNowPlayingWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewMedia(), fetchedAt = System.currentTimeMillis()),
            size = MediaNowPlayingRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Media · compact", showBackground = true)
@Composable
private fun MediaCompactPreview() {
    TeslaSyncTheme {
        MediaNowPlayingWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewMedia(), fetchedAt = System.currentTimeMillis()),
            size = MediaNowPlayingSize(cols = 1, rows = 1),
        )
    }
}

@Preview(name = "Media · empty", showBackground = true)
@Composable
private fun MediaEmptyPreview() {
    TeslaSyncTheme {
        MediaNowPlayingWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            size = MediaNowPlayingRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Media · loading", showBackground = true)
@Composable
private fun MediaLoadingPreview() {
    TeslaSyncTheme {
        MediaNowPlayingWidgetContent(
            state = UiState.loading(),
            size = MediaNowPlayingRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Media · error", showBackground = true)
@Composable
private fun MediaErrorPreview() {
    TeslaSyncTheme {
        MediaNowPlayingWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = MediaNowPlayingRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Media · offline (cached)", showBackground = true)
@Composable
private fun MediaOfflinePreview() {
    TeslaSyncTheme {
        MediaNowPlayingWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewMedia(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            size = MediaNowPlayingRegistration.DEFAULT_SIZE,
        )
    }
}
