// Compose render layer for the GeofenceDrawer modal/dialog surface — the native analogue of the
// web component (web/src/components/maps/GeofenceDrawer.tsx). It is a thin shell over the pure
// [GeofenceDrawerProjection] derivations plus the shared atomic editor: the existing fences drawn as on-map
// shapes, a draw toolbar (circle by default — the web `modes = ['circle']`), a tap-to-place draft with a radius
// slider, an accessible fence list with per-row delete, and the dismiss affordance. Every string resolves from the
// generated i18n catalog (P1/S10); spacing comes from the generated theme tokens (P1/S9). The view performs NO
// HTTP and owns no store — the web component's only hook is `useMap` (the map context), and the assembled draft /
// deletion are handed back to the parent through the [onCreate] / [onDelete] callbacks exactly as the web
// `onCreate` / `onDelete` props are.
//
// Tier adaptation (declared, not silent): the web `GeofenceDrawer` mounts its controls INLINE on a
// `<MapContainer>` and renders no chrome of its own. The P3 tier classifies this artifact as a modal/dialog
// surface ("overlay surface with focus trap + dismiss semantics"), so the native surface hosts the same editor in
// the shared [Modal] shell (platform scrim, outside-tap + system-back dismiss, pane-title for TalkBack) and gates
// it on an `open` flag — the Compose idiom for the web `open` prop the sibling AddAnnotationPopover surface uses.
// The on-map shapes + draw toolbar + accessible list are the real, working atomic editor
// (io.teslasync.android.components.maps.GeofenceDrawer, the P3 component-library bundle), reused here rather than
// reimplemented, and driven entirely through its i18n-resolved label parameters.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/GeofenceDrawer) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations
// (the localized-strings carrier).
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.geofencedrawer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.maps.DraftGeofence
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.GeofenceLabels
import io.teslasync.android.components.maps.GeofenceShape
import io.teslasync.android.components.maps.MapGeofence
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.maps.GeofenceDrawer as GeofenceEditor

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier so
 * the stateless content takes plain strings and stays trivially previewable + UI-testable. The atomic editor's
 * shape buttons have no dedicated catalog keys (the web toolbar is `leaflet-draw`'s built-in icon controls, whose
 * tooltips are the library's own bundled localization, not ours), so the draw-affordance label
 * (`geofences.drawOnMap`) is reused for each shape — the surface defaults to circle-only, matching the web app.
 */
data class GeofenceDrawerStrings(
    val title: String,
    val close: String,
    val drawHint: String,
    val mapLabel: String,
    val summary: String,
    val circle: String,
    val polygon: String,
    val rectangle: String,
    val clear: String,
    val save: String,
    val radius: String,
    val delete: String,
) {
    /** Projects the resolved toolbar/list microcopy onto the atomic editor's [GeofenceLabels] carrier. */
    fun toGeofenceLabels(): GeofenceLabels =
        GeofenceLabels(
            circle = circle,
            polygon = polygon,
            rectangle = rectangle,
            clear = clear,
            save = save,
            radius = radius,
            delete = delete,
        )
}

/** Resolves every [GeofenceDrawerStrings] entry from the existing generated i18n catalog keys (P1/S10). */
@Composable
fun rememberGeofenceDrawerStrings(): GeofenceDrawerStrings =
    GeofenceDrawerStrings(
        title = stringResource(R.string.translation_geofences_drawOnMap),
        close = stringResource(R.string.translation_common_close),
        drawHint = stringResource(R.string.translation_geofences_drawHint),
        mapLabel = stringResource(R.string.translation_geofences_drawerLabel),
        summary = stringResource(R.string.translation_Geofences),
        circle = stringResource(R.string.translation_geofences_drawOnMap),
        polygon = stringResource(R.string.translation_geofences_drawOnMap),
        rectangle = stringResource(R.string.translation_geofences_drawOnMap),
        clear = stringResource(R.string.translation_common_clear),
        save = stringResource(R.string.translation_common_save),
        radius = stringResource(R.string.translation_geofences_aiSuggest_radiusLabel),
        delete = stringResource(R.string.translation_common_delete),
    )

/**
 * Stateful entry point — the native host for the web `GeofenceDrawer` editor. Renders nothing while [open] is false
 * (the Compose idiom for the web `open` prop), records the one-shot PII-safe `view.opened` diagnostic on open
 * (P1/S11), and hosts the editor in the shared [Modal]. A finished draft is handed to [onCreate]; an on-list
 * deletion to [onDelete]; [onDismiss] closes the surface. No HTTP, no store — the parent owns the callbacks exactly
 * as the web component's props are.
 *
 * @param open whether the dialog is shown (web `open`; the web source mounts inline — see the file header).
 * @param fences the existing geofences to draw as editable shapes (web `fences`).
 * @param onCreate receives a finished [DraftGeofence] when the user saves a new shape (web `onCreate`).
 * @param onDismiss dismiss callback for the overlay.
 * @param onDelete receives the id of a fence the user removes from the list (web `onDelete`).
 * @param modes the shapes the toolbar offers; defaults to circle-only (web `modes = ['circle']`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun GeofenceDrawer(
    open: Boolean,
    fences: List<MapGeofence>,
    onCreate: (DraftGeofence) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    onDelete: (String) -> Unit = {},
    modes: List<GeofenceShape> = GeofenceDrawerProjection.DEFAULT_MODES,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    LaunchedEffect(Unit) { recordGeofenceDrawerOpened(logger) }
    val strings = rememberGeofenceDrawerStrings()
    Modal(
        onDismissRequest = onDismiss,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        GeofenceDrawerContent(
            fences = fences,
            onCreate = onCreate,
            onDelete = onDelete,
            modes = modes,
            strings = strings,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Shows the localized draw hint, then the atomic
 * geofence editor (on-map shapes + draw toolbar + radius slider + accessible fence list) driven entirely through
 * its i18n-resolved label parameters. The fences are filtered through [GeofenceDrawerProjection.renderableFences]
 * first — the web render-sync effect's `fenceToLayer`-returns-null guard — so an unrenderable fence is never handed
 * to the editor as an invisible no-op.
 */
@Composable
fun GeofenceDrawerContent(
    fences: List<MapGeofence>,
    onCreate: (DraftGeofence) -> Unit,
    onDelete: (String) -> Unit,
    modes: List<GeofenceShape>,
    strings: GeofenceDrawerStrings,
    modifier: Modifier = Modifier,
) {
    val drawable = remember(fences) { GeofenceDrawerProjection.renderableFences(fences) }
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        HelperText(strings.drawHint)
        GeofenceEditor(
            fences = drawable,
            onCreate = onCreate,
            onDelete = onDelete,
            modes = modes,
            mapContentDescription = strings.mapLabel,
            summaryLabel = strings.summary,
            labels = strings.toGeofenceLabels(),
        )
    }
}

// ── Previews (tooling-only; @Preview entry points exercise the populated + no-fences branches) ──────────────

private val previewStrings =
    GeofenceDrawerStrings(
        title = "Draw on map",
        close = "Close",
        drawHint = "Click the circle tool, then click and drag on the map to draw a fence.",
        mapLabel = "Geofence drawing map",
        summary = "Geofences",
        circle = "Draw on map",
        polygon = "Draw on map",
        rectangle = "Draw on map",
        clear = "Clear",
        save = "Save",
        radius = "Radius",
        delete = "Delete",
    )

private val previewFences =
    listOf(
        MapGeofence(id = "home", name = "Home", center = GeoPoint(37.7749, -122.4194), radiusMeters = 150.0),
        MapGeofence(id = "work", name = "Work", center = GeoPoint(37.3318, -122.0312), radiusMeters = 220.0),
    )

@Preview(name = "Editor with existing fences", showBackground = true, widthDp = 360)
@Composable
private fun GeofenceDrawerPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GeofenceDrawerContent(
            fences = previewFences,
            onCreate = {},
            onDelete = {},
            modes = GeofenceDrawerProjection.DEFAULT_MODES,
            strings = previewStrings,
        )
    }
}

@Preview(name = "Editor with no fences yet", showBackground = true, widthDp = 360)
@Composable
private fun GeofenceDrawerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GeofenceDrawerContent(
            fences = emptyList(),
            onCreate = {},
            onDelete = {},
            modes = GeofenceDrawerProjection.DEFAULT_MODES,
            strings = previewStrings,
        )
    }
}
