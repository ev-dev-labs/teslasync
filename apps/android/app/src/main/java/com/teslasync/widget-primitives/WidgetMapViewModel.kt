// Pure, framework-free model + projection + diagnostics for the WidgetMapView widget primitive — the native
// analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetMapView.tsx) before Compose paints anything. No Compose, no
// Android, no gms, no HTTP: every declaration here runs off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a presentational map
// "frame" shared by many dashboard widgets. It takes a `center` ([lat, lng]), an optional `zoom` (default 13),
// a `compact` flag, an arbitrary `children` node (markers / polylines), and an `isEmpty` flag with an
// `emptyMessage` (default "No location data available"). When `isEmpty` it renders the shared EmptyState.
// Otherwise it renders a rounded, overflow-clipped box holding a dark-tile map centered at `center` / `zoom`
// whose pan + zoom interactions (web `dragging` / `scrollWheelZoom` / `zoomControl`) are each enabled only when
// NOT `compact`, plus the caller's children. It fetches nothing and owns no text of its own beyond that one
// empty-state default.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive performs no query — it is a layout frame whose location is handed to it fully resolved by the owning
// widget. There is nothing here to be loading, to error, to go stale, or to go offline; the `isEmpty` flag the
// caller passes IS the one data-driven branch the web source has, and it is reproduced exactly. Inventing the
// async states would model a dependency the web spec does not have (honesty covenant: no scope narrowing, no
// silent drift). The surface's REAL, fully-reproduced states are therefore: the empty state, and the populated
// map (interactive when wide, static when compact). Each is reduced here by [widgetMapViewPlan] /
// [widgetMapInteraction] and asserted off-device, doubling as the per-state snapshot. The owning widget that DOES
// fetch renders its own data states and drops its resolved center / children into this frame.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling WidgetChartSummary surface does. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetmapview

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no coordinates, no children,
 * and no caller text — only this constant identifier — so a diagnostics line can never leak a vehicle's location.
 */
const val WIDGET_MAP_VIEW_SLUG: String = "WidgetMapView"

/**
 * Canonical registry metadata for the WidgetMapView surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetMapView`).
 */
object WidgetMapViewRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its root. */
    const val ID: String = "widget-map-view"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = WIDGET_MAP_VIEW_SLUG
}

/**
 * The default map zoom — the native mirror of the web `zoom = 13` default. A pure Float (no Compose) so the
 * defaulting + clamping is unit-tested off-device.
 */
const val DEFAULT_WIDGET_MAP_ZOOM: Float = 13f

/** The lowest zoom the Google Maps camera accepts (whole-world view); a malformed caller is clamped up to it. */
const val MIN_WIDGET_MAP_ZOOM: Float = 2f

/** The highest zoom the Google Maps camera accepts (street level); a malformed caller is clamped down to it. */
const val MAX_WIDGET_MAP_ZOOM: Float = 21f

/**
 * A neutral whole-world center used only when a caller hands the populated (non-empty) frame a non-finite or
 * out-of-envelope coordinate. The web trusts Leaflet with the raw center; the native camera would reject a NaN,
 * so this guard degrades to a valid view rather than crashing — the caller still owns the true "no data" path via
 * `isEmpty`. Itself always valid (asserted in the model test).
 */
val WIDGET_MAP_FALLBACK_CENTER: GeoPoint = GeoPoint(lat = 20.0, lng = 0.0)

/**
 * Which region the frame paints — the reduced result of the web component's two render branches. Pure data so the
 * composable stays a thin render layer over it and both branches are asserted off-device (doubling as the
 * per-state snapshot).
 *
 * @param showEmptyState the web `isEmpty` branch — the shared EmptyState replaces the map.
 * @param showMap the web `else` branch — the dark map frame with the caller's children.
 */
data class WidgetMapViewPlan(
    val showEmptyState: Boolean,
    val showMap: Boolean,
) {
    /**
     * Always true: the frame renders exactly one of its two regions in every state, so it is never a blank box
     * (the web component also always returns one of the two).
     */
    val rendersAnyRegion: Boolean
        get() = showEmptyState || showMap
}

/**
 * Reduce the web `isEmpty` flag into the [WidgetMapViewPlan] the frame renders — pure and exhaustively covered.
 * Mirrors the web exactly: `isEmpty` shows only the EmptyState; otherwise the map shows. The two outcomes are
 * mutually exclusive and total, so a region always renders.
 */
fun widgetMapViewPlan(isEmpty: Boolean): WidgetMapViewPlan =
    WidgetMapViewPlan(
        showEmptyState = isEmpty,
        showMap = !isEmpty,
    )

/**
 * The three map interactions the web `MapContainer` toggles, each enabled only when NOT compact. The web gates
 * pan, wheel/pinch zoom, and the on-screen zoom control on `!compact`; a compact widget is therefore a static
 * preview thumbnail and a wide one is fully interactive. Pure data so the gating is asserted off-device; the
 * composable maps these onto the Google Maps `MapUiSettings` gesture flags.
 *
 * @param dragging pan gestures (web `dragging={!compact}`) → maps `scrollGesturesEnabled`.
 * @param scrollWheelZoom wheel / pinch zoom (web `scrollWheelZoom={!compact}`) → maps `zoomGesturesEnabled`.
 * @param zoomControl the on-screen +/- control (web `zoomControl={!compact}`) → maps `zoomControlsEnabled`.
 */
data class WidgetMapInteraction(
    val dragging: Boolean,
    val scrollWheelZoom: Boolean,
    val zoomControl: Boolean,
) {
    /** True when the frame is interactive at all (any gesture / control on) — the wide, non-compact mode. */
    val interactive: Boolean
        get() = dragging || scrollWheelZoom || zoomControl
}

/**
 * Choose the map interactions for a [compact] (true) or wide (false) frame — pure, so the web `!compact` gating is
 * asserted off-device. Every interaction follows `!compact` together, matching the web component which passes the
 * same `!compact` to all three `MapContainer` props.
 */
fun widgetMapInteraction(compact: Boolean): WidgetMapInteraction {
    val enabled = !compact
    return WidgetMapInteraction(
        dragging = enabled,
        scrollWheelZoom = enabled,
        zoomControl = enabled,
    )
}

/**
 * Resolve the camera zoom for the frame — pure, so the defaulting + clamping is unit-tested off-device. A
 * non-finite [zoom] (NaN / infinity from a malformed caller) falls back to [DEFAULT_WIDGET_MAP_ZOOM]; an
 * in-band value is clamped into the camera's supported [MIN_WIDGET_MAP_ZOOM]..[MAX_WIDGET_MAP_ZOOM] envelope so
 * the gms camera never receives an out-of-range pose.
 */
fun resolveWidgetMapZoom(zoom: Float): Float =
    if (!zoom.isFinite()) {
        DEFAULT_WIDGET_MAP_ZOOM
    } else {
        zoom.coerceIn(MIN_WIDGET_MAP_ZOOM, MAX_WIDGET_MAP_ZOOM)
    }

/**
 * Resolve the camera center for the frame — pure, so the validity guard is unit-tested off-device. A valid
 * [center] is used verbatim (web parity); an invalid one (non-finite or outside the lat/lng envelope) falls back
 * to [WIDGET_MAP_FALLBACK_CENTER] so the gms camera never receives a NaN. The caller still owns the genuine "no
 * location" path through `isEmpty`.
 */
fun resolveWidgetMapCenter(center: GeoPoint): GeoPoint = if (center.isValid()) center else WIDGET_MAP_FALLBACK_CENTER

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no coordinates, no children, no caller text — so observability can never leak where a vehicle is. Kept
 * free of Compose so it is unit-tested with a recording [Logger].
 */
object WidgetMapViewDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_MAP_VIEW_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
