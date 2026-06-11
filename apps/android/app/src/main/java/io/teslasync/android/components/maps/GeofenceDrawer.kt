package io.teslasync.android.components.maps

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.maps.android.compose.Circle
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.Polygon
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.roundToInt

/*
 * Interactive geofence editor — the Android counterpart of the web `GeofenceDrawer` (leaflet-draw).
 * Renders existing fences (circles / polygons / rectangles), offers a draw-mode toolbar, builds a
 * draft from map taps (circle: tap a center + radius slider; rectangle: two corners; polygon: tap
 * vertices), and emits a [DraftGeofence] on save. The geometry assembly is the unit-tested
 * `draftGeofence` / `rectangleRing`; an accessible list mirrors the fences with delete actions.
 */

private const val FENCE_STROKE = 2f
private const val FILL_ALPHA = 0.15f
private const val FENCE_ZOOM = 12f

/** Editor for [fences]; [onCreate] receives a finished draft, [onDelete] removes an existing fence. */
@Composable
fun GeofenceDrawer(
    fences: List<MapGeofence>,
    onCreate: (DraftGeofence) -> Unit,
    modifier: Modifier = Modifier,
    onDelete: (String) -> Unit = {},
    modes: List<GeofenceShape> = listOf(GeofenceShape.Circle),
    heightDp: Int = 360,
    initialStyle: MapStyleId = MapStyleId.Dark,
    defaultRadiusMeters: Float = 150f,
    minRadiusMeters: Float = 25f,
    maxRadiusMeters: Float = 2000f,
    mapContentDescription: String = "Geofence editor map",
    summaryLabel: String = "Geofences",
    labels: GeofenceLabels = GeofenceLabels(),
) {
    var mode by remember(modes) { mutableStateOf(modes.first()) }
    var draftCenter by remember { mutableStateOf<GeoPoint?>(null) }
    var radius by remember { mutableStateOf(defaultRadiusMeters) }
    var vertices by remember { mutableStateOf<List<GeoPoint>>(emptyList()) }
    var rectCorner by remember { mutableStateOf<GeoPoint?>(null) }
    val camera = rememberMapCameraState(CameraSnapshot(fences.firstOrNull()?.center ?: DEFAULT_MAP_CAMERA.target, FENCE_ZOOM))

    fun resetDraft() {
        draftCenter = null
        vertices = emptyList()
        rectCorner = null
    }

    fun handleTap(point: GeoPoint) {
        when (mode) {
            GeofenceShape.Circle -> draftCenter = point
            GeofenceShape.Rectangle -> {
                val first = rectCorner
                if (first == null) {
                    rectCorner = point
                    vertices = emptyList()
                } else {
                    vertices = rectangleRing(first, point)
                    rectCorner = null
                }
            }
            GeofenceShape.Polygon -> vertices = vertices + point
        }
    }

    val draft = draftGeofence(mode, draftCenter, radius * 1.0, vertices)

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        GlassPanel(padding = PanelPadding.None) {
            Box(modifier = Modifier.fillMaxWidth().height(heightDp.dp)) {
                TeslaMap(
                    modifier = Modifier.fillMaxSize(),
                    cameraPositionState = camera,
                    style = initialStyle,
                    contentDescription = mapContentDescription,
                    onMapClick = { handleTap(it) },
                ) {
                    fences.forEach { fence -> key(fence.id) { GeofenceShapeRender(fence) } }
                    DraftPreview(mode = mode, center = draftCenter, radiusMeters = radius, vertices = vertices)
                }
                GeofenceToolbar(
                    modes = modes,
                    active = mode,
                    canSave = draft != null,
                    labels = labels,
                    onModeChange = {
                        mode = it
                        resetDraft()
                    },
                    onClear = { resetDraft() },
                    onSave = {
                        draft?.let(onCreate)
                        resetDraft()
                    },
                    modifier = Modifier.align(Alignment.TopStart).padding(Spacing.sm),
                )
            }
            if (mode == GeofenceShape.Circle && draftCenter != null) {
                Slider(
                    value = radius,
                    onValueChange = { radius = it },
                    label = labels.radius,
                    valueText = "${radius.roundToInt()} m",
                    valueRange = minRadiusMeters..maxRadiusMeters,
                    modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                )
            }
        }
        GeofenceList(fences = fences, onDelete = onDelete, title = summaryLabel, deleteLabel = labels.delete)
    }
}

/** Caller-supplied (translatable) control labels for [GeofenceDrawer]. */
data class GeofenceLabels(
    val circle: String = "Circle",
    val polygon: String = "Polygon",
    val rectangle: String = "Rectangle",
    val clear: String = "Clear",
    val save: String = "Save",
    val radius: String = "Radius",
    val delete: String = "Delete",
)

@Composable
@GoogleMapComposable
private fun GeofenceShapeRender(fence: MapGeofence) {
    val stroke = geofenceColor()
    val fill = stroke.copy(alpha = FILL_ALPHA)
    if (fence.shape() == GeofenceShape.Circle && fence.center != null && fence.radiusMeters != null) {
        Circle(
            center = fence.center.toLatLng(),
            radius = fence.radiusMeters,
            fillColor = fill,
            strokeColor = stroke,
            strokeWidth = FENCE_STROKE,
        )
    } else if (fence.polygon.size >= 3) {
        Polygon(
            points = fence.polygon.map { it.toLatLng() },
            fillColor = fill,
            strokeColor = stroke,
            strokeWidth = FENCE_STROKE,
        )
    }
}

@Composable
@GoogleMapComposable
private fun DraftPreview(
    mode: GeofenceShape,
    center: GeoPoint?,
    radiusMeters: Float,
    vertices: List<GeoPoint>,
) {
    val stroke = geofenceColor()
    val fill = stroke.copy(alpha = FILL_ALPHA)
    if (mode == GeofenceShape.Circle && center != null) {
        Circle(
            center = center.toLatLng(),
            radius = radiusMeters * 1.0,
            fillColor = fill,
            strokeColor = stroke,
            strokeWidth = FENCE_STROKE,
        )
        MapDotMarker(center, stroke)
    } else if (vertices.size >= 2) {
        Polygon(
            points = vertices.map { it.toLatLng() },
            fillColor = fill,
            strokeColor = stroke,
            strokeWidth = FENCE_STROKE,
        )
    }
}

@Composable
private fun GeofenceToolbar(
    modes: List<GeofenceShape>,
    active: GeofenceShape,
    canSave: Boolean,
    labels: GeofenceLabels,
    onModeChange: (GeofenceShape) -> Unit,
    onClear: () -> Unit,
    onSave: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = Elevation.overlay,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            modes.forEach { shape ->
                IconButton(
                    imageVector = shapeGlyph(shape),
                    contentDescription = shapeLabel(shape, labels),
                    onClick = { onModeChange(shape) },
                    variant = if (shape == active) IconButtonVariant.Tonal else IconButtonVariant.Standard,
                    size = IconSize.Sm,
                )
            }
            IconButton(MapsGlyphs.Trash, contentDescription = labels.clear, onClick = onClear, size = IconSize.Sm)
            IconButton(
                imageVector = TeslaGlyphs.Check,
                contentDescription = labels.save,
                onClick = onSave,
                enabled = canSave,
                variant = IconButtonVariant.Tonal,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun GeofenceList(
    fences: List<MapGeofence>,
    onDelete: (String) -> Unit,
    title: String,
    deleteLabel: String,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        PanelTitle(title)
        if (fences.isEmpty()) {
            Caption("No geofences yet.")
        } else {
            fences.forEach { fence ->
                key(fence.id) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        Icon(shapeGlyph(fence.shape()), contentDescription = null, size = IconSize.Sm)
                        BodyText(describeGeofence(fence), modifier = Modifier.weight(1f))
                        IconButton(
                            MapsGlyphs.Trash,
                            contentDescription = "$deleteLabel ${fence.name ?: fence.id}",
                            onClick = { onDelete(fence.id) },
                            size = IconSize.Sm,
                        )
                    }
                }
            }
        }
    }
}

private fun shapeGlyph(shape: GeofenceShape) =
    when (shape) {
        GeofenceShape.Circle -> MapsGlyphs.CircleShape
        GeofenceShape.Rectangle -> MapsGlyphs.SquareShape
        GeofenceShape.Polygon -> MapsGlyphs.PolygonShape
    }

private fun shapeLabel(
    shape: GeofenceShape,
    labels: GeofenceLabels,
) = when (shape) {
    GeofenceShape.Circle -> labels.circle
    GeofenceShape.Rectangle -> labels.rectangle
    GeofenceShape.Polygon -> labels.polygon
}
