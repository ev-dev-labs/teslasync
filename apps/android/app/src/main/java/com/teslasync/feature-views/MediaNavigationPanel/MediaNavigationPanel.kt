// The native Jetpack Compose + Material 3 MediaNavigationPanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx. The web component renders a
// `GlassPanel` titled "Media & Navigation" (a headphones glyph + heading) over two stacked sections:
//   • Now Playing — a rounded inset card with the track title (or "Nothing playing"), the artist (or "Unknown
//     artist"), an optional source chip, and a Playing/Paused/neutral status `Badge`; or "No media data" when
//     there is no media snapshot.
//   • Navigation — an active-destination inset card (a map-pin glyph + name, with distance-to-arrival and
//     minutes-to-arrival) or "No active destination", followed by home / work / favorite presence chips; or
//     "No location data" when there is no location snapshot.
// This port keeps that contract: the panel + title always render, every value falls back to its localized
// inline empty rather than collapsing, and the distance is converted to the user's display unit exactly once
// (`useUnits`) at the render boundary.
//
// The web component is presentational — its parent (a vehicle telemetry page) owns the media + location
// queries and their loading / error / stale / offline handling. So this surface binds no data fetch; its two
// web data sources are `useTranslation` (the generated i18n catalog, P1/S10) and `useUnits` (the live distance
// display preference + locale + precision from the data container, P1/S8). The host supplies the combined
// snapshot through the shared state-holder layer as a [UiState], so the surface ALSO renders every lifecycle
// state that layer can carry — a loading skeleton, a hard error with retry, a friendly empty state, and a
// refreshing/stale/offline freshness chip — without ever fetching. A web-parity overload that takes the raw
// `mediaData` + `locationData` (web `{ mediaData, locationData }`) is also provided for hosts that already
// hold those values; it renders the content branch directly.
//
// Every derivation flows through the pure [MediaNavigationPanelProjection]; the composable is a thin render
// layer that records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition. The title
// and every label resolve through the catalog; the only non-key strings are server-supplied data the web
// shows verbatim (the track/source/status text, the destination name) and the unit-symbol the web derives from
// the unit preference — so there is no English UI copy literal in the shipped render path.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MediaNavigationPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.medianavigationpanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/** The em-dash the freshness chip renders for an unknown relative age. */
private const val DASH: String = "\u2014"

/** Loading chrome: the panel always shows both section's shapes while the first fetch is in flight. */
private const val SKELETON_SECTIONS: Int = 2
private const val SKELETON_LABEL_FRACTION: Float = 0.4f
private val SKELETON_LABEL_HEIGHT: Dp = 10.dp
private val SKELETON_CARD_HEIGHT: Dp = 72.dp

/** Inset-card wash + border alpha — the native expression of the web `bg-white/[0.02] border-white/[0.06]`. */
private const val INSET_CARD_BG_ALPHA: Float = 0.4f
private const val INSET_CARD_BORDER_ALPHA: Float = 0.5f
private val INSET_BORDER_WIDTH: Dp = 1.dp

/** Presence-chip wash + border alpha — the native expression of the web `bg-{c}/10 border-{c}/20`. */
private const val CHIP_BG_ALPHA: Float = 0.12f
private const val CHIP_BORDER_ALPHA: Float = 0.25f

// Local 24×24 stroked glyphs for the two lucide icons the shared [TeslaGlyphs] set does not carry (the web
// `Headphones` title accent and the `Navigation2` section accent); the destination's `MapPin` reuses the
// shared [TeslaGlyphs.Pin]. Authored here exactly as the sibling feature-view surfaces author their locals.
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE_WIDTH: Float = 2f
private val GLYPH_SIZE: Dp = 24.dp

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary, keeping
 * the rest of the surface free of any English literal.
 */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per localized label the web source renders.
data class MediaNavigationPanelStrings(
    val title: String,
    val nowPlaying: String,
    val nothingPlaying: String,
    val unknownArtist: String,
    val noMediaData: String,
    val navigation: String,
    val minShort: String,
    val noActiveDestination: String,
    val noLocationData: String,
    val placeHome: String,
    val placeWork: String,
    val placeFavorite: String,
    val noData: String,
)

/**
 * Stateful entry point for the Media & Navigation panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), reads the live display units (web `useUnits`), and renders every lifecycle [state] the
 * shared feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this
 * view never performs HTTP.
 *
 * @param state the cache-then-network projection of the combined [MediaNavSnapshot] (media + location).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param units the live SI → display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MediaNavigationPanel(
    state: UiState<MediaNavSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MediaNavigationPanelDiagnostics.recordViewOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    MediaNavigationPanelContent(state = state, onRetry = onRetry, prefs = formatter.prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `{ mediaData, locationData }` props, for hosts that already
 * hold the latest media + location snapshots. Projects them onto a content [UiState] via
 * [MediaNavigationPanelProjection.projectUiState] and delegates to the stateful entry, which records
 * `view.opened`. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun MediaNavigationPanel(
    media: MediaInfo?,
    location: LocationInfo?,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(media, location) {
            MediaNavigationPanelProjection.projectUiState(MediaNavSnapshot(media, location), isLoading = false)
        }
    MediaNavigationPanel(state = state, onRetry = {}, modifier = modifier, units = units, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always renders the
 * `GlassPanel` + headphones title (web's always-present panel chrome); then the loading skeleton, the
 * hard-error retry surface, the friendly empty state, or the two-section content, with a freshness chip in the
 * header whenever the feed is refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the
 * web freshness contract. [prefs] supplies the SI → display unit conversion + formatting.
 */
@Composable
fun MediaNavigationPanelContent(
    state: UiState<MediaNavSnapshot>,
    onRetry: () -> Unit,
    prefs: UnitPref,
    modifier: Modifier = Modifier,
    strings: MediaNavigationPanelStrings = rememberMediaNavigationPanelStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    FadeIn(modifier = modifier) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            MediaNavHeader(title = strings.title)
            Spacer(modifier = Modifier.height(Spacing.md))
            val snapshot = state.data
            when {
                state.isLoading -> MediaNavSkeleton(loadingLabel = loadingLabel)
                state.isError -> MediaNavError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> EmptyState(message = strings.noData)
                else -> MediaNavLoaded(snapshot = snapshot, state = state, prefs = prefs, strings = strings)
            }
        }
    }
}

/**
 * The panel header — a decorative headphones glyph (web `<Headphones className="text-purple-300">`) ahead of
 * the section title, the title carrying the TalkBack heading role so the panel is navigable by heading.
 */
@Composable
private fun MediaNavHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = mediaNavHeadphones,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.tertiary,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
    }
}

/**
 * The content branch — the two web sections stacked with the web `space-y-5` gap, preceded by an optional
 * freshness chip whenever the feed is refreshing/stale/offline (the chrome the host's feed implies; a clean
 * first load shows no chip, matching the web source's chip-free panel). Everything is projected once by the
 * pure [MediaNavigationPanelProjection].
 */
@Composable
private fun MediaNavLoaded(
    snapshot: MediaNavSnapshot,
    state: UiState<MediaNavSnapshot>,
    prefs: UnitPref,
    strings: MediaNavigationPanelStrings,
) {
    val display =
        remember(snapshot, prefs) {
            MediaNavigationPanelProjection.display(snapshot, prefs, resolveDisplayLocale(prefs.locale))
        }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (state.stale || state.refreshing || state.hasError) {
            MediaNavFreshnessRow(state = state)
        }
        NowPlayingSection(nowPlaying = display.nowPlaying, strings = strings)
        NavigationSection(navigation = display.navigation, strings = strings)
    }
}

/**
 * The optional freshness chip shown above the content whenever the feed is refreshing, stale, or serving
 * cached data after a failed refresh (offline) — the render-only chrome the host's feed implies. Right-aligned
 * so it sits in the panel's top-right corner the way the web page-level freshness affordance does.
 */
@Composable
private fun MediaNavFreshnessRow(state: UiState<MediaNavSnapshot>) {
    val formatAge = rememberMediaNavFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * The "Now Playing" section — the web `text-[10px] uppercase` label over either the track inset card (web
 * `mediaData ?`) or the "No media data" inline empty, so the section never collapses to a blank box.
 */
@Composable
private fun NowPlayingSection(
    nowPlaying: NowPlayingDisplay?,
    strings: MediaNavigationPanelStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(strings.nowPlaying)
        if (nowPlaying != null) {
            NowPlayingCard(nowPlaying = nowPlaying, strings = strings)
        } else {
            HelperText(strings.noMediaData)
        }
    }
}

/**
 * The track inset card — the bold (truncated) title, the muted (truncated) artist, and an optional source chip
 * + status badge row. A missing title/artist falls back to the localized "Nothing playing" / "Unknown artist"
 * (web `… || t(...)`), never a blank line.
 */
@Composable
private fun NowPlayingCard(
    nowPlaying: NowPlayingDisplay,
    strings: MediaNavigationPanelStrings,
) {
    InsetCard {
        Text(
            text = nowPlaying.title ?: strings.nothingPlaying,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = nowPlaying.artist ?: strings.unknownArtist,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (nowPlaying.source != null || nowPlaying.status != null) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                nowPlaying.source?.let { SourceChip(text = it) }
                nowPlaying.status?.let { Badge(text = it.text, variant = mediaBadgeVariant(it.badge)) }
            }
        }
    }
}

/** Neutral source chip (web `rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]`). */
@Composable
private fun SourceChip(text: String) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

/**
 * The "Navigation" section — the web `Navigation2`-prefixed label over either the location content (web
 * `locationData ?`) or the "No location data" inline empty.
 */
@Composable
private fun NavigationSection(
    navigation: NavigationDisplay?,
    strings: MediaNavigationPanelStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = mediaNavNavigation,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(strings.navigation)
        }
        if (navigation != null) {
            NavigationContent(navigation = navigation, strings = strings)
        } else {
            HelperText(strings.noLocationData)
        }
    }
}

/**
 * The location content — the web `space-y-3` stack of the active-destination card (or the "No active
 * destination" inline empty) and the home/work/favorite presence chips (shown only when at least one is set).
 */
@Composable
private fun NavigationContent(
    navigation: NavigationDisplay,
    strings: MediaNavigationPanelStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (navigation.destination != null) {
            DestinationCard(destination = navigation.destination, strings = strings)
        } else {
            HelperText(strings.noActiveDestination)
        }
        if (navigation.places.isNotEmpty()) {
            PlaceChips(places = navigation.places, strings = strings)
        }
    }
}

/**
 * The active-destination inset card — a map-pin glyph + the bold (truncated) destination name, then a row of
 * the converted distance-to-arrival and the localized minutes-to-arrival, each shown only when present.
 */
@Composable
private fun DestinationCard(
    destination: DestinationDisplay,
    strings: MediaNavigationPanelStrings,
) {
    InsetCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = TeslaGlyphs.Pin,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            Text(
                text = destination.name,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (destination.distance != null || destination.etaMinutes != null) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                destination.distance?.let { HelperText(it) }
                destination.etaMinutes?.let { HelperText("$it ${strings.minShort}") }
            }
        }
    }
}

/** The wrapping row of presence chips (web `flex items-center gap-2 flex-wrap`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlaceChips(
    places: List<MediaPlace>,
    strings: MediaNavigationPanelStrings,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        places.forEach { place -> PlaceChip(place = place, strings = strings) }
    }
}

/**
 * One presence chip — an emoji + localized label on a low-alpha wash of the place's accent color with a
 * matching outline (web `bg-{c}/10 text-{c}-400 border-{c}/20`): home → green, work → blue, favorite → the
 * accent. The chip announces its label to TalkBack.
 */
@Composable
private fun PlaceChip(
    place: MediaPlace,
    strings: MediaNavigationPanelStrings,
) {
    val accent = placeAccentColor(place)
    val label = placeLabel(place, strings)
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = CHIP_BG_ALPHA),
        contentColor = accent,
        border = BorderStroke(INSET_BORDER_WIDTH, accent.copy(alpha = CHIP_BORDER_ALPHA)),
        modifier = Modifier.semantics { contentDescription = label },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(placeEmoji(place), style = MaterialTheme.typography.labelSmall)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * A rounded inset card — the native expression of the web `rounded-xl bg-white/[0.02] border-white/[0.06]
 * p-4`: a subtle wash + outline over the panel surface so an inner card reads as inset without a hard fill.
 */
@Composable
private fun InsetCard(content: @Composable ColumnScope.() -> Unit) {
    val borderColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = INSET_CARD_BORDER_ALPHA)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = INSET_CARD_BG_ALPHA),
        border = BorderStroke(INSET_BORDER_WIDTH, borderColor),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = content,
        )
    }
}

/**
 * The loading branch — both section shapes (a short label bar over a card bar) in a single TalkBack "Loading"
 * region so the loading state is announced rather than read as a stack of empty boxes. No section label leaks
 * while loading.
 */
@Composable
private fun MediaNavSkeleton(loadingLabel: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        repeat(SKELETON_SECTIONS) {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
                Skeleton(height = SKELETON_CARD_HEIGHT, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun MediaNavError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [MediaNavigationPanelStrings] from the i18n catalog (P1/S10): the `telemetry.*` +
 * `common.*` keys the web component reads through `useTranslation`. Resolved once at the Compose boundary so
 * the rest of the surface stays free of any English literal.
 */
@Composable
fun rememberMediaNavigationPanelStrings(): MediaNavigationPanelStrings {
    val title = stringResource(R.string.translation_telemetry_mediaNav)
    val nowPlaying = stringResource(R.string.translation_telemetry_nowPlaying)
    val nothingPlaying = stringResource(R.string.translation_telemetry_nothingPlaying)
    val unknownArtist = stringResource(R.string.translation_telemetry_unknownArtist)
    val noMediaData = stringResource(R.string.translation_telemetry_noMediaData)
    val navigation = stringResource(R.string.translation_telemetry_navigation)
    val minShort = stringResource(R.string.translation_common_minShort)
    val noActiveDestination = stringResource(R.string.translation_telemetry_noActiveDestination)
    val noLocationData = stringResource(R.string.translation_telemetry_noLocationData)
    val placeHome = stringResource(R.string.translation_telemetry_placeHome)
    val placeWork = stringResource(R.string.translation_telemetry_placeWork)
    val placeFavorite = stringResource(R.string.translation_telemetry_placeFavorite)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(
        title,
        nowPlaying,
        nothingPlaying,
        unknownArtist,
        noMediaData,
        navigation,
        minShort,
        noActiveDestination,
        noLocationData,
        placeHome,
        placeWork,
        placeFavorite,
        noData,
    ) {
        MediaNavigationPanelStrings(
            title = title,
            nowPlaying = nowPlaying,
            nothingPlaying = nothingPlaying,
            unknownArtist = unknownArtist,
            noMediaData = noMediaData,
            navigation = navigation,
            minShort = minShort,
            noActiveDestination = noActiveDestination,
            noLocationData = noLocationData,
            placeHome = placeHome,
            placeWork = placeWork,
            placeFavorite = placeFavorite,
            noData = noData,
        )
    }
}

/** Resolves a presence chip's already-localized label from the bundled strings. */
private fun placeLabel(
    place: MediaPlace,
    strings: MediaNavigationPanelStrings,
): String =
    when (place) {
        MediaPlace.Home -> strings.placeHome
        MediaPlace.Work -> strings.placeWork
        MediaPlace.Favorite -> strings.placeFavorite
    }

/** The web presence-chip emoji (🏠 / 🏢 / ⭐), as escapes so the source stays ASCII-portable. */
private fun placeEmoji(place: MediaPlace): String =
    when (place) {
        MediaPlace.Home -> "\uD83C\uDFE0"
        MediaPlace.Work -> "\uD83C\uDFE2"
        MediaPlace.Favorite -> "\u2B50"
    }

/**
 * Resolves a [MediaPlace] to its accent color — the native mirror of the web chip color (home → green,
 * work → blue, favorite → the theme accent) so no hex literal leaks into the view.
 */
@Composable
private fun placeAccentColor(place: MediaPlace): Color =
    when (place) {
        MediaPlace.Home -> TeslaTokens.status.success
        MediaPlace.Work -> TeslaTokens.status.info
        MediaPlace.Favorite -> MaterialTheme.colorScheme.tertiary
    }

/** Maps the projected [MediaBadge] onto the shared [BadgeVariant] (web Badge color). */
private fun mediaBadgeVariant(badge: MediaBadge): BadgeVariant =
    when (badge) {
        MediaBadge.Success -> BadgeVariant.Success
        MediaBadge.Warning -> BadgeVariant.Warning
        MediaBadge.Neutral -> BadgeVariant.Neutral
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMediaNavFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> DASH
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

// ── Local glyphs (the two lucide icons absent from the shared set) ───────────────────────────────────

/** Builds a 24×24 round-capped stroked [ImageVector] tinted at render time, like the shared [TeslaGlyphs]. */
private fun stroked(
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
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** lucide `headphones` — the title accent. */
private val mediaNavHeadphones: ImageVector =
    stroked("MediaNavHeadphones") {
        moveTo(3f, 14f)
        horizontalLineToRelative(3f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
        verticalLineToRelative(3f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
        horizontalLineTo(4f)
        arcToRelative(1f, 1f, 0f, false, true, -1f, -1f)
        verticalLineToRelative(-7f)
        arcToRelative(9f, 9f, 0f, false, true, 18f, 0f)
        verticalLineToRelative(7f)
        arcToRelative(1f, 1f, 0f, false, true, -1f, 1f)
        horizontalLineToRelative(-2f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
        verticalLineToRelative(-3f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
        horizontalLineToRelative(3f)
    }

/** lucide `navigation-2` — the navigation section accent. */
private val mediaNavNavigation: ImageVector =
    stroked("MediaNavNavigation2") {
        moveTo(12f, 2f)
        lineTo(19f, 21f)
        lineTo(12f, 17f)
        lineTo(5f, 21f)
        close()
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private fun previewStrings(): MediaNavigationPanelStrings =
    MediaNavigationPanelStrings(
        title = "Media & Navigation",
        nowPlaying = "Now Playing",
        nothingPlaying = "Nothing playing",
        unknownArtist = "Unknown artist",
        noMediaData = "No media data",
        navigation = "Navigation",
        minShort = "min",
        noActiveDestination = "No active destination",
        noLocationData = "No location data",
        placeHome = "Home",
        placeWork = "Work",
        placeFavorite = "Favorite",
        noData = "No data available",
    )

private fun previewSnapshot(): MediaNavSnapshot =
    MediaNavSnapshot(
        media =
            MediaInfo(
                nowPlayingTitle = "Night Drive",
                nowPlayingArtist = "Aurora Skies",
                playbackSource = "Streaming",
                playbackStatus = "Playing",
            ),
        location =
            LocationInfo(
                destinationName = "Downtown Supercharger",
                milesToArrival = 12875.0,
                minutesToArrival = 14.0,
                locatedAtHome = false,
                locatedAtWork = false,
                locatedAtFavorite = true,
            ),
    )

@Preview(name = "Content — populated", showBackground = true)
@Composable
private fun MediaNavigationPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MediaNavigationPanelContent(
            state = MediaNavigationPanelProjection.projectUiState(previewSnapshot(), isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Content — inline empties", showBackground = true)
@Composable
private fun MediaNavigationPanelInlineEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MediaNavigationPanelContent(
            state =
                MediaNavigationPanelProjection.projectUiState(
                    MediaNavSnapshot(media = null, location = null),
                    isLoading = false,
                ),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MediaNavigationPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MediaNavigationPanelContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun MediaNavigationPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MediaNavigationPanelContent(
            state = MediaNavigationPanelProjection.projectUiState(snapshot = null, isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MediaNavigationPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MediaNavigationPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = previewStrings(),
        )
    }
}
