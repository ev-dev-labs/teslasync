// Pure, framework-free model + projection for the GeofenceDrawer modal/dialog surface — the native analogue of
// everything the web component derives before it touches leaflet (web/src/components/maps/GeofenceDrawer.tsx). No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is a `leaflet-draw` controller mounted on the parent map (its only "hook" is `useMap`, the map
// context — it binds NO data store and makes NO request). It renders the existing `fences` as editable shapes,
// offers a draw toolbar, and emits structured `onCreate` / `onEdit` / `onDelete` callbacks. Because the source has
// no cache-then-network lifecycle, the prompt's generic loading / empty / error / stale / offline DATA states do
// not exist in the source and are NOT fabricated here (that would be drift); the states the source actually has —
// the set of renderable shapes, an in-progress draft vs. a completed one, and the no-fences case — are the
// complete state set this surface reproduces. The geometry primitives the web declares at module scope
// (`layerToGeometry`, `fenceToLayer`, `describeFence`) were already ported into `components/maps/MapsLogic.kt`
// (`draftGeofence`, the `MapGeofence.shape()` discriminator, `describeGeofence`) for the shared atomic editor, so
// this model REUSES them rather than re-porting them; it adds only the surface-specific derivation the web
// render-sync effect performs (the `fenceToLayer`-returns-null filter that decides which fences actually draw) plus
// the registry + the PII-safe diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/GeofenceDrawer — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling ConfirmDialog / AddAnnotationPopover surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.geofencedrawer

import io.teslasync.android.components.maps.GeofenceShape
import io.teslasync.android.components.maps.MapGeofence
import io.teslasync.android.components.maps.describeGeofence
import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object GeofenceDrawerRegistration {
    /** Stable surface id. */
    const val ID: String = "geofence-drawer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "GeofenceDrawer"
}

/**
 * The pure derivations the composable renders over — the native mirror of the web component's module-scope
 * geometry helpers that are NOT already covered by `MapsLogic.kt`. Stateless and side-effect-free, so the surface
 * is fully covered by the off-device unit gate.
 */
object GeofenceDrawerProjection {
    /**
     * The draw modes the surface offers by default — the web `modes = ['circle']` default, which is also the only
     * shape the app's `GeofencesPage` enables and the only one it persists ("currently only circles are persisted").
     */
    val DEFAULT_MODES: List<GeofenceShape> = listOf(GeofenceShape.Circle)

    /** Minimum vertices a ring needs to draw as an area — the web `polygon.length >= 3` guard. */
    const val MIN_POLYGON_VERTICES: Int = 3

    /**
     * Whether [fence] would produce a drawable shape — the native mirror of the web `fenceToLayer` non-null guard:
     * a circle when its center and a strictly positive radius are present (web `radius > 0`; a `NaN`/`0` radius
     * fails `> 0`), otherwise an area when the ring has at least [MIN_POLYGON_VERTICES] vertices. A fence that is
     * neither is skipped by the web render-sync effect, so it is filtered out here too rather than handed to the
     * editor as an invisible no-op.
     */
    fun isRenderable(fence: MapGeofence): Boolean {
        val radius = fence.radiusMeters
        if (fence.center != null && radius != null && radius > 0.0) return true
        return fence.polygon.size >= MIN_POLYGON_VERTICES
    }

    /**
     * The fences the editor will actually draw — the web `fences.map(fenceToLayer).filter(Boolean)` of the
     * render-sync effect. Order is preserved so the accessible list and the on-map shapes stay aligned.
     */
    fun renderableFences(fences: List<MapGeofence>): List<MapGeofence> = fences.filter(::isRenderable)

    /** Whether the surface currently has any drawable fence — drives the no-fences vs. populated branch. */
    fun hasFences(fences: List<MapGeofence>): Boolean = fences.any(::isRenderable)

    /**
     * One human-readable line per renderable fence — the screen-reader alternative the web exposes via
     * `describeFence` ("for callers that surface fences in non-visual UI"). Reuses the shared `describeGeofence`
     * so the wording stays identical to the atomic editor's own accessible list.
     */
    fun summaryLines(fences: List<MapGeofence>): List<String> = renderableFences(fences).map(::describeGeofence)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [GeofenceDrawerRegistration.SLUG] (P1/S11).
 * Carries only the slug — never a fence name, coordinate, or radius — so a diagnostics line can never leak where
 * the operator is drawing. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable
 * calls it from its first-composition effect.
 */
fun recordGeofenceDrawerOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to GeofenceDrawerRegistration.SLUG))
}
