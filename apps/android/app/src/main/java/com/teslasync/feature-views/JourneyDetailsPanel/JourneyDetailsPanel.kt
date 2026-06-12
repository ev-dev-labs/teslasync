// The native Jetpack Compose + Material 3 JourneyDetailsPanel feature view — a parity port of
// web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx. The web component is a presentational
// "Journey Details" GlassPanel: a Navigation-glyph title over a two-column grid (Start, Destination), each column
// showing a location (a reverse-geocoded address, a formatted lat/lon pair, or a localized fallback), a timestamp
// rendered in the vehicle's local time, and a battery percentage.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). Like the sibling DriveDetailHeader port — the
// other zero-data-source drive-detail surface — it has no loading / error / stale / offline lifecycle to render;
// modelling those would invent behaviour the web spec does not have (honesty covenant: no silent drift). What it
// genuinely varies is its content, and every derivation flows through the pure [JourneyDetailsPanelProjection]
// (address-vs-coordinates-vs-fallback location, live-vs-completed destination time, battery value or "?"); the
// composable below is a thin render layer that resolves the i18n labels/fallbacks and paints the projected values.
//
// Token + component mapping (P1/S9 tokens, no ported Tailwind): the web `GlassPanel className="p-5"` maps to a
// [GlassPanel] with [PanelPadding.Lg] (16dp, the compact phone-first adaptation of the web 20px p-5); the `h3`
// title maps to a [Heading] Panel role (web `text-sm font-semibold`); each column's bold primary line maps to
// [BodyText] (onSurface) — an address — or [CodeText] (monospace, web `font-mono`) — a coordinate pair; the muted
// timestamp + battery lines (web `text-xs`) map to [Caption] (onSurfaceVariant). The web flex/grid spacing maps to
// the generated [Spacing] scale (web `gap-2`→sm, `gap-4`/`mb-4`→lg), and the responsive `grid-cols-1 sm:grid-cols-2`
// maps to a [BoxWithConstraints] that stacks below the web `sm` breakpoint (640dp) and lays the two columns side by
// side at or above it.
//
// Glyph + color mapping: the title `MapsGlyphs.Navigation` (web lucide `Navigation`) and Start `DataDisplayGlyphs.MapPin`
// (web lucide `MapPin`) map 1:1; the Destination glyph is one documented, intentional substitution — the vendored
// components layer (out of scope here, P3 component-library bundle) ships no flag glyph, so the destination marker
// uses `MapsGlyphs.Crosshair` (the closest shared "target/destination" affordance for web lucide `Flag`), exactly
// as the sibling DriveDetailHeader port substitutes for its missing arrow/share glyphs. The web `text-cyan-400`
// title / `text-green-400` Start / `text-red-400` Destination accents map to the semantic
// `TeslaTokens.status.info` / `.success` / `.danger` tokens, never a hand-picked hex.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/JourneyDetailsPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.journeydetailspanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** Web Tailwind `sm` breakpoint (640px): at or above this width the two columns lay out side by side. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Distinguishes the two columns so the shared column renderer can pick the right glyph, accent, and label. */
private enum class EndpointKind { Start, Destination }

/**
 * Stateful entry point for the journey-details panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), projects the raw [data] into the render-ready model, and renders it. The surface binds no data of its
 * own — the fully-loaded drive fields arrive as a prop from the owning page (web `JourneyDetailsPanelProps`).
 *
 * Timezone parity: the owning page resolves the vehicle's IANA [zone] (mirroring the web `<DateTime in="vehicle">`
 * provider that lives outside this surface's data sources) and hands it in; [zone]/[locale] default to the device
 * values so the panel renders correctly even before a host overrides them.
 *
 * @param data the loaded journey-detail inputs (the `DriveDetail` fields the web panel reads).
 * @param zone the vehicle timezone the timestamps render in; defaults to the device zone.
 * @param locale the formatting locale; defaults to the device locale.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun JourneyDetailsPanel(
    data: JourneyDetailsData,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { JourneyDetailsPanelDiagnostics.recordViewOpened(logger) }
    val model = remember(data, zone, locale) { JourneyDetailsPanelProjection.project(data, zone, locale) }
    JourneyDetailsPanelContent(model = model, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web panel: the Navigation-glyph
 * title over the Start + Destination columns. Both columns, the title, both labels, and the battery rows render in
 * every state (including the fully-degenerate [JourneyDetailsUiModel.isEmpty] drive), so the panel is never a blank
 * box; missing data degrades to the localized "No address data" / "In progress" fallbacks and the "?" battery
 * marker, exactly as the web does.
 */
@Composable
fun JourneyDetailsPanelContent(
    model: JourneyDetailsUiModel,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                JourneyDetailsTitle()
                JourneyEndpointsGrid(start = model.start, destination = model.destination)
            }
        }
    }
}

/**
 * The web `h3` title row: a cyan Navigation glyph beside the localized "Journey Details" heading. The glyph is
 * decorative (the heading text carries the meaning), so it exposes no content description.
 */
@Composable
private fun JourneyDetailsTitle() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = MapsGlyphs.Navigation,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.info,
        )
        Heading(
            text = stringResource(R.string.translation_driveDetail_journeyDetails),
            level = HeadingLevel.Panel,
        )
    }
}

/**
 * The web `grid grid-cols-1 sm:grid-cols-2 gap-4` of the two endpoint columns. Below [GRID_SM_MIN_WIDTH] the
 * columns stack into one column (web `grid-cols-1`); at or above it they share the row at equal width (web
 * `sm:grid-cols-2`). Spacing between/around them is the web `gap-4` (Spacing.lg).
 */
@Composable
private fun JourneyEndpointsGrid(
    start: JourneyEndpoint,
    destination: JourneyEndpoint,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        if (maxWidth >= GRID_SM_MIN_WIDTH) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                JourneyEndpointColumn(EndpointKind.Start, start, Modifier.weight(1f))
                JourneyEndpointColumn(EndpointKind.Destination, destination, Modifier.weight(1f))
            }
        } else {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                JourneyEndpointColumn(EndpointKind.Start, start, Modifier.fillMaxWidth())
                JourneyEndpointColumn(EndpointKind.Destination, destination, Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * One endpoint column (web `<div>`): the colored icon + label header, the primary location line, the timestamp
 * line, and the battery line. The location resolves to the projected address/coordinate text or the localized
 * fallback; the timestamp resolves to the projected text or — for a live destination — the "In progress" string
 * (web `endTs ? <DateTime> : t('driveDetail.inProgress')`); the battery interpolates the projected value (or "?")
 * into "Battery: {value}%".
 */
@Composable
private fun JourneyEndpointColumn(
    kind: EndpointKind,
    endpoint: JourneyEndpoint,
    modifier: Modifier = Modifier,
) {
    val batteryLabel = stringResource(R.string.translation_driveDetail_battery)
    val timeText = endpoint.timeText ?: stringResource(R.string.translation_driveDetail_inProgress)
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        EndpointLabel(kind)
        LocationLine(endpoint)
        Caption(text = timeText)
        Caption(text = "$batteryLabel: ${endpoint.batteryValue}%")
    }
}

/**
 * The web colored label row — a [MapPin]/[Crosshair] glyph beside the localized "Start"/"Destination" text, both
 * tinted with the endpoint's semantic accent (web `text-green-400`/`text-red-400`). The glyph is decorative (the
 * label text carries the meaning), so it exposes no content description.
 */
@Composable
private fun EndpointLabel(kind: EndpointKind) {
    val glyph = if (kind == EndpointKind.Start) DataDisplayGlyphs.MapPin else MapsGlyphs.Crosshair
    val color = if (kind == EndpointKind.Start) TeslaTokens.status.success else TeslaTokens.status.danger
    val labelRes =
        if (kind == EndpointKind.Start) {
            R.string.translation_driveDetail_start
        } else {
            R.string.translation_driveDetail_destination
        }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(imageVector = glyph, contentDescription = null, size = IconSize.Md, tint = color)
        BodyText(text = stringResource(labelRes), color = color)
    }
}

/**
 * The web bold primary location line: the address as plain body text, a coordinate pair as monospace text (web
 * `font-mono`), or the localized fallback — "No address data" or, for a live destination, "In progress" — when the
 * projection resolved no concrete location.
 */
@Composable
private fun LocationLine(endpoint: JourneyEndpoint) {
    val location = endpoint.location
    when {
        location == null -> {
            val fallbackRes =
                when (endpoint.locationFallback) {
                    LocationFallback.NoAddress -> R.string.translation_driveDetail_noAddress
                    LocationFallback.InProgress -> R.string.translation_driveDetail_inProgress
                }
            BodyText(text = stringResource(fallbackRes))
        }
        location.monospace -> CodeText(text = location.text)
        else -> BodyText(text = location.text)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_ZONE: ZoneId = ZoneId.of("America/Los_Angeles")

private fun previewModel(data: JourneyDetailsData): JourneyDetailsUiModel =
    JourneyDetailsPanelProjection.project(data, PREVIEW_ZONE, Locale.US)

@Preview(name = "Completed (addresses)", showBackground = true)
@Composable
private fun JourneyDetailsPanelCompletedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        JourneyDetailsPanelContent(
            model =
                previewModel(
                    JourneyDetailsData(
                        startAddress = "Cupertino, CA",
                        endAddress = "San Francisco, CA",
                        startLat = 37.33,
                        startLon = -122.03,
                        endLat = 37.77,
                        endLon = -122.42,
                        startBatteryPct = 87.0,
                        endBatteryPct = 64.0,
                        startTsIso = "2026-01-15T18:30:00Z",
                        endTsIso = "2026-01-15T19:42:00Z",
                    ),
                ),
        )
    }
}

@Preview(name = "Live (coords start, in progress)", showBackground = true)
@Composable
private fun JourneyDetailsPanelLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        JourneyDetailsPanelContent(
            model =
                previewModel(
                    JourneyDetailsData(
                        startAddress = null,
                        endAddress = null,
                        startLat = -33.86,
                        startLon = 151.20,
                        endLat = null,
                        endLon = null,
                        startBatteryPct = 92.0,
                        endBatteryPct = null,
                        startTsIso = "2026-01-15T18:30:00Z",
                        endTsIso = null,
                    ),
                ),
        )
    }
}

@Preview(name = "Empty (degenerate drive)", showBackground = true)
@Composable
private fun JourneyDetailsPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        JourneyDetailsPanelContent(
            model =
                previewModel(
                    JourneyDetailsData(
                        startAddress = null,
                        endAddress = null,
                        startLat = null,
                        startLon = null,
                        endLat = null,
                        endLon = null,
                        startBatteryPct = null,
                        endBatteryPct = null,
                        startTsIso = null,
                        endTsIso = null,
                    ),
                ),
        )
    }
}
