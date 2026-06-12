// The native Jetpack Compose + Material 3 PresetGallery feature view — a parity port of
// web/src/features/automations/pages/PresetGallery.tsx. The web component renders a responsive card grid
// of automation preset templates: each `PresetCard` is a `<GlassPanel hover glow="cyan">` holding a
// cyan icon tile, the preset name, the first trigger's label (or "No trigger configured"), a neutral
// "{{count}} actions" `<Badge>`, the description (clamped to two lines), and a full-width secondary
// "Install" `<Button>` (Plus icon) that navigates to `/automations/new?preset=${preset.id}`. While the
// query loads it shows four `PresetCardSkeleton`s; when the list is empty it shows a friendly
// `<EmptyState>` ("No preset templates available", Clock icon); otherwise a `<FadeIn>` + `<StaggerContainer>`
// staggers the cards in.
//
// This port keeps that contract end to end and performs NO HTTP. The host owns the preset feed through the
// shared P1/S8 state-holder layer (web `useAutomationPresets`) and supplies it as a [UiState], plus the
// [onInstall] navigation action (web `useNavigate`) and [onRetry] (the feed's refetch). Because the host's
// feed carries the full cache-then-network lifecycle, this view renders every state that layer can produce —
// the web's loading / empty / content branches PLUS the hard-error retry surface and the stale/offline
// "last known + retry" chrome the sibling surfaces standardize. A web-parity overload taking the already
// loaded list is provided for hosts that hold the presets. The cyan accent maps to `TeslaTokens.status.info`
// (never a raw hex), the icon glyphs are authored 24dp vectors (Android bundles no lucide set, and a feature
// view may not expand the shared icon library), and every string resolves through the i18n catalog (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PresetGallery — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.presetgallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

/** Em dash shown for an unknown freshness age — the shared freshness "no value" fallback. */
internal const val EM_DASH: String = "\u2014"

/** First-load skeleton card count — the web `Array.from({ length: 4 })`. */
private const val SKELETON_COUNT: Int = 4

/** Icon tile edge — the web `w-10 h-10`. */
private val ICON_TILE: Dp = 40.dp

/** Description clamp — the web `line-clamp-2`. */
private const val DESCRIPTION_MAX_LINES: Int = 2

/** Low-alpha wash behind the icon tile — the web `bg-cyan-500/10`. */
private const val TILE_FILL_ALPHA: Float = 0.10f

/** Icon tile border alpha — the web `border-cyan-500/20`. */
private const val TILE_BORDER_ALPHA: Float = 0.20f

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the [install]
 * button label, the four trigger labels + the [noTrigger] fallback the first-trigger subtitle picks from,
 * the [empty] message, and the [actionCountLabel] interpolator (web `{{count}} actions`). The lifecycle
 * chrome strings (loading / error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, so this holder stays a thin content carrier.
 */
data class PresetGalleryStrings(
    val install: String,
    val noTrigger: String,
    val empty: String,
    val triggerSchedule: String,
    val triggerEvent: String,
    val triggerGeofence: String,
    val triggerSignal: String,
    val actionCountLabel: (Int) -> String,
)

/**
 * Stateful entry point for the preset gallery. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the host's preset feed (P1/S8) can carry. The host owns the
 * feed and navigation; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the preset templates (web `useAutomationPresets`).
 * @param onInstall fires the host's navigation for a preset id (web `navigate('/automations/new?preset=…')`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PresetGallery(
    state: UiState<List<AutomationPresetData>>,
    onInstall: (presetId: String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordPresetGalleryOpened(logger) }
    PresetGalleryContent(state = state, onInstall = onInstall, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's loaded `presetList`, for hosts that already hold the
 * presets. A `null`/empty list renders the empty state (web `presetList.length === 0`); otherwise the card
 * grid renders. Records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no
 * retry affordance.
 */
@Composable
fun PresetGallery(
    presets: List<AutomationPresetData>?,
    onInstall: (presetId: String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(presets) {
            val items = presets ?: emptyList()
            UiState(phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content, data = items)
        }
    PresetGallery(state = state, onInstall = onInstall, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * loading-skeleton / empty / card-grid branches and adds the lifecycle chrome the host's feed implies: a
 * hard-error retry surface and a freshness chip that reflects refreshing / stale / offline. Stale (non-error)
 * data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 */
@Composable
fun PresetGalleryContent(
    state: UiState<List<AutomationPresetData>>,
    onInstall: (presetId: String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: PresetGalleryStrings = rememberPresetGalleryStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data) {
            PresetGalleryProjection.project(state.data ?: emptyList())
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when {
            state.isLoading -> PresetGalleryLoading()
            state.isError -> PresetGalleryError(onRetry = onRetry)
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    PresetGalleryFreshnessRow(state)
                }
                if (result.isEmpty) {
                    PresetGalleryEmpty(message = strings.empty)
                } else {
                    PresetGalleryGrid(cards = result.cards, strings = strings, onInstall = onInstall)
                }
            }
        }
    }
}

/**
 * The populated card grid — the web `<FadeIn><StaggerContainer>`. The native [StaggerContainer] is a vertical
 * column (the web mobile-baseline `grid-cols-1`), so the cards stagger in as a single-column gallery, the
 * idiomatic phone layout. Each card is delayed by its ordinal via [StaggerItem].
 */
@Composable
private fun PresetGalleryGrid(
    cards: List<PresetCardProjection>,
    strings: PresetGalleryStrings,
    onInstall: (presetId: String) -> Unit,
) {
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        StaggerContainer(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.forEachIndexed { index, card ->
                StaggerItem(index = index) {
                    PresetCard(card = card, strings = strings, onInstall = onInstall)
                }
            }
        }
    }
}

/**
 * One preset template card — the web `PresetCard`. A cyan icon tile, the truncated name, the first-trigger
 * label, a neutral action-count badge, the two-line description, and a full-width "Install" button wired to
 * [onInstall] with [PresetCardProjection.id] (web `navigate('/automations/new?preset=' + preset.id)`).
 */
@Composable
private fun PresetCard(
    card: PresetCardProjection,
    strings: PresetGalleryStrings,
    onInstall: (presetId: String) -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = PanelAccent.Info) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.Top,
            ) {
                PresetIconTile(icon = card.icon)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Heading(text = card.name, level = HeadingLevel.Panel, maxLines = 1)
                    Caption(triggerLabel(card.triggerKind, strings))
                }
                Badge(strings.actionCountLabel(card.actionCount), variant = BadgeVariant.Neutral)
            }
            BodyText(
                card.description,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = DESCRIPTION_MAX_LINES,
            )
            Button(
                label = strings.install,
                onClick = { onInstall(card.id) },
                modifier = Modifier.fillMaxWidth(),
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Plus,
            )
        }
    }
}

/** The web cyan icon tile (`w-10 h-10 rounded-lg bg-cyan-500/10 border-cyan-500/20`), token-resolved. */
@Composable
private fun PresetIconTile(icon: PresetIconKind) {
    val accent = TeslaTokens.status.info
    val shape = RoundedCornerShape(Radius.md)
    Box(
        modifier =
            Modifier
                .size(ICON_TILE)
                .clip(shape)
                .background(accent.copy(alpha = TILE_FILL_ALPHA))
                .border(1.dp, accent.copy(alpha = TILE_BORDER_ALPHA), shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyphFor(icon), contentDescription = null, size = IconSize.Lg, tint = accent)
    }
}

/** First-load skeleton grid — four shimmering cards so the surface is never blank (web four skeletons). */
@Composable
private fun PresetGalleryLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_COUNT) { PresetCardSkeleton() }
    }
}

/** Loading shape for one preset card — the web `PresetCardSkeleton`. */
@Composable
private fun PresetCardSkeleton() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                Box(modifier = Modifier.size(ICON_TILE)) { Skeleton(height = ICON_TILE, rounded = true) }
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Skeleton(widthFraction = 0.6f, height = 16.dp)
                    Skeleton(widthFraction = 0.4f, height = 12.dp)
                }
            }
            Skeleton(height = 12.dp)
            Skeleton(height = 32.dp)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun PresetGalleryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Empty state — web parity: the Clock glyph + "No preset templates available", shown when the resolved list
 * is empty so the surface is never a blank box (web `<EmptyState />` branch).
 */
@Composable
private fun PresetGalleryEmpty(message: String) {
    EmptyState(message = message, icon = ClockGlyph, modifier = Modifier.fillMaxWidth())
}

/**
 * The freshness chip rendered above the grid when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance the sibling surfaces standardize. Offline (a failed refresh over cached
 * data) reads the localized "Offline" label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun PresetGalleryFreshnessRow(state: UiState<*>) {
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
            formatAge = rememberPresetFreshnessFormatter(),
        )
    }
}

/** Maps a [PresetTriggerKind] to its localized label (web `triggerLabels` lookup, else the no-trigger copy). */
private fun triggerLabel(
    kind: PresetTriggerKind,
    strings: PresetGalleryStrings,
): String =
    when (kind) {
        PresetTriggerKind.Schedule -> strings.triggerSchedule
        PresetTriggerKind.Event -> strings.triggerEvent
        PresetTriggerKind.Geofence -> strings.triggerGeofence
        PresetTriggerKind.Signal -> strings.triggerSignal
        PresetTriggerKind.None -> strings.noTrigger
    }

/** The authored vector glyph for an icon [kind] (web `iconMap`); Android bundles no lucide set. */
private fun glyphFor(kind: PresetIconKind): ImageVector =
    when (kind) {
        PresetIconKind.Shield -> ShieldGlyph
        PresetIconKind.ShieldCheck -> ShieldCheckGlyph
        PresetIconKind.Moon -> MoonGlyph
        PresetIconKind.Sun -> SunGlyph
        PresetIconKind.Lock -> LockGlyph
        PresetIconKind.UserX -> UserXGlyph
        PresetIconKind.CarFront -> CarFrontGlyph
        PresetIconKind.Siren -> SirenGlyph
    }

/**
 * Builds the localized [PresetGalleryStrings] from the i18n catalog (P1/S10): the `automations.presets.*`
 * and `automations.builder.noTrigger` keys the web component reads, plus the four app-owned trigger labels
 * (the web `automations.builder.trigger*` keys exist only as i18next fallbacks, so they are reproduced as
 * app-owned resources in `preset_gallery_strings.xml`). The "{{count}} actions" interpolation resolves
 * through `Context.getString`, with the count grouped per the active locale.
 */
@Composable
private fun rememberPresetGalleryStrings(): PresetGalleryStrings {
    val context = LocalContext.current
    val install = stringResource(R.string.translation_automations_presets_install)
    val noTrigger = stringResource(R.string.translation_automations_builder_noTrigger)
    val empty = stringResource(R.string.translation_automations_presets_empty)
    val triggerSchedule = stringResource(R.string.preset_gallery_trigger_schedule)
    val triggerEvent = stringResource(R.string.preset_gallery_trigger_event)
    val triggerGeofence = stringResource(R.string.preset_gallery_trigger_geofence)
    val triggerSignal = stringResource(R.string.preset_gallery_trigger_signal)
    return remember(context, install, noTrigger, empty, triggerSchedule, triggerEvent, triggerGeofence, triggerSignal) {
        PresetGalleryStrings(
            install = install,
            noTrigger = noTrigger,
            empty = empty,
            triggerSchedule = triggerSchedule,
            triggerEvent = triggerEvent,
            triggerGeofence = triggerGeofence,
            triggerSignal = triggerSignal,
            actionCountLabel = { count ->
                val grouped = NumberFormat.getIntegerInstance(Locale.getDefault()).format(count.toLong())
                context.getString(R.string.translation_automations_presets_actionCount, grouped)
            },
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberPresetFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Authored lucide-style glyphs ─────────────────────────────────────────────────────────────────────────
// The web cards draw lucide icons (Shield / ShieldCheck / Moon / Sun / Lock / UserX / CarFront / Siren) and a
// Clock for the empty state. Android bundles no lucide set, and a feature view may not expand the shared icon
// library from a surface prompt, so each is authored here as a 24×24 stroked vector in the shared monochrome
// style — recolored at render time by the `Icon` tint, exactly as the sibling surfaces author their glyphs.

/** lucide `shield` — a crest outline. */
val ShieldGlyph: ImageVector =
    strokedGlyph("Shield") { shieldOutline() }

/** lucide `shield-check` — the crest with an interior check. */
val ShieldCheckGlyph: ImageVector =
    strokedGlyph("ShieldCheck") {
        shieldOutline()
        moveTo(9f, 11.5f)
        lineTo(11f, 13.5f)
        lineTo(15f, 9.5f)
    }

/** lucide `moon` — a crescent (two arcs, mirroring the lucide relative-arc path). */
val MoonGlyph: ImageVector =
    strokedGlyph("Moon") {
        moveTo(12f, 3f)
        arcToRelative(6f, 6f, 0f, false, false, 9f, 9f)
        arcToRelative(9f, 9f, 0f, true, true, -9f, -9f)
        close()
    }

/** lucide `sun` — a small disc with eight rays. */
val SunGlyph: ImageVector =
    strokedGlyph("Sun") {
        moveTo(8f, 12f)
        arcTo(4f, 4f, 0f, false, true, 16f, 12f)
        arcTo(4f, 4f, 0f, false, true, 8f, 12f)
        close()
        ray(12f, 1.5f, 12f, 3.5f)
        ray(12f, 20.5f, 12f, 22.5f)
        ray(1.5f, 12f, 3.5f, 12f)
        ray(20.5f, 12f, 22.5f, 12f)
        ray(4.4f, 4.4f, 5.8f, 5.8f)
        ray(18.2f, 18.2f, 19.6f, 19.6f)
        ray(4.4f, 19.6f, 5.8f, 18.2f)
        ray(18.2f, 5.8f, 19.6f, 4.4f)
    }

/** lucide `lock` — a body with an arched shackle. */
val LockGlyph: ImageVector =
    strokedGlyph("Lock") {
        moveTo(5f, 11f)
        lineTo(19f, 11f)
        lineTo(19f, 21f)
        lineTo(5f, 21f)
        close()
        moveTo(7.5f, 11f)
        lineTo(7.5f, 7.5f)
        arcTo(4.5f, 4.5f, 0f, false, true, 16.5f, 7.5f)
        lineTo(16.5f, 11f)
    }

/** lucide `user-x` — a head + shoulders with an X. */
val UserXGlyph: ImageVector =
    strokedGlyph("UserX") {
        moveTo(5.5f, 7f)
        arcTo(3.5f, 3.5f, 0f, false, true, 12.5f, 7f)
        arcTo(3.5f, 3.5f, 0f, false, true, 5.5f, 7f)
        close()
        moveTo(2.5f, 21f)
        lineTo(2.5f, 19f)
        arcTo(4f, 4f, 0f, false, true, 6.5f, 15f)
        lineTo(11.5f, 15f)
        arcTo(4f, 4f, 0f, false, true, 15.5f, 19f)
        lineTo(15.5f, 21f)
        moveTo(17.5f, 8f)
        lineTo(22f, 12.5f)
        moveTo(22f, 8f)
        lineTo(17.5f, 12.5f)
    }

/** lucide `car-front` — a rounded body with headlights and a grille. */
val CarFrontGlyph: ImageVector =
    strokedGlyph("CarFront") {
        moveTo(4f, 13f)
        lineTo(5.5f, 8.5f)
        arcTo(2f, 2f, 0f, false, true, 7.5f, 7f)
        lineTo(16.5f, 7f)
        arcTo(2f, 2f, 0f, false, true, 18.5f, 8.5f)
        lineTo(20f, 13f)
        lineTo(20f, 17.5f)
        lineTo(4f, 17.5f)
        close()
        moveTo(6.5f, 13f)
        lineTo(8.5f, 13f)
        moveTo(15.5f, 13f)
        lineTo(17.5f, 13f)
        moveTo(10f, 13f)
        lineTo(14f, 13f)
    }

/** lucide `siren` — a rounded dome on a base. */
val SirenGlyph: ImageVector =
    strokedGlyph("Siren") {
        moveTo(7f, 17f)
        lineTo(7f, 12f)
        arcTo(5f, 5f, 0f, false, true, 17f, 12f)
        lineTo(17f, 17f)
        close()
        moveTo(5f, 17.5f)
        lineTo(19f, 17.5f)
        lineTo(19f, 21f)
        lineTo(5f, 21f)
        close()
    }

/** lucide `clock` — a dial with two hands (the empty-state glyph). */
val ClockGlyph: ImageVector =
    strokedGlyph("Clock") {
        moveTo(3f, 12f)
        arcTo(9f, 9f, 0f, false, true, 21f, 12f)
        arcTo(9f, 9f, 0f, false, true, 3f, 12f)
        close()
        moveTo(12f, 7f)
        lineTo(12f, 12f)
        lineTo(16f, 14f)
    }

/** The lucide `shield` crest outline, shared by [ShieldGlyph] and [ShieldCheckGlyph]. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 2.5f)
    lineTo(20f, 5.5f)
    lineTo(20f, 11.5f)
    curveTo(20f, 16f, 16.5f, 19.5f, 12f, 21.5f)
    curveTo(7.5f, 19.5f, 4f, 16f, 4f, 11.5f)
    lineTo(4f, 5.5f)
    close()
}

/** A single round-capped sun ray from ([x1], [y1]) to ([x2], [y2]). */
private fun PathBuilder.ray(
    x1: Float,
    y1: Float,
    x2: Float,
    y2: Float,
) {
    moveTo(x1, y1)
    lineTo(x2, y2)
}

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ─────────────────────────────

private val PREVIEW_STRINGS =
    PresetGalleryStrings(
        install = "Install",
        noTrigger = "No trigger configured",
        empty = "No preset templates available",
        triggerSchedule = "Schedule",
        triggerEvent = "Vehicle Event",
        triggerGeofence = "Geofence",
        triggerSignal = "Signal Threshold",
        actionCountLabel = { "$it actions" },
    )

private val PREVIEW_PRESETS =
    listOf(
        AutomationPresetData(
            id = "preset-precondition",
            name = "Morning Precondition",
            description = "Warm the cabin and battery before your weekday commute.",
            icon = "Sun",
            triggerKinds = listOf("trigger_schedule"),
            actionCount = 3,
        ),
        AutomationPresetData(
            id = "preset-arrive-home",
            name = "Secure on Arrival",
            description = "Lock the charge port and arm Sentry when you reach home.",
            icon = "Lock",
            triggerKinds = listOf("trigger_geofence"),
            actionCount = 2,
        ),
        AutomationPresetData(
            id = "preset-low-battery",
            name = "Low Battery Alert",
            description = "Notify you and start charging when the pack drops below your floor.",
            icon = "Siren",
            triggerKinds = listOf("trigger_signal"),
            actionCount = 4,
        ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun PresetGalleryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryContent(
            state = UiState(UiPhase.Loading),
            onInstall = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun PresetGalleryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onInstall = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun PresetGalleryContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryContent(
            state = UiState(UiPhase.Content, data = PREVIEW_PRESETS),
            onInstall = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun PresetGalleryErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryContent(
            state = UiState(UiPhase.Error),
            onInstall = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun PresetGalleryOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PresetGalleryContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_PRESETS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onInstall = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
