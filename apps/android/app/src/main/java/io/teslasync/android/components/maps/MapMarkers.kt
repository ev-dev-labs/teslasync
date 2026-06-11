@file:OptIn(MapsComposeExperimentalApi::class)

package io.teslasync.android.components.maps

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.MapsComposeExperimentalApi
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberMarkerState
import com.google.maps.android.compose.rememberUpdatedMarkerState
import io.teslasync.android.components.motion.rememberReducedMotion

/*
 * Vehicle / point markers rendered with Google Maps Compose's `MarkerComposable`, so the marker
 * icon is real Compose content (a token-colored, heading-rotated glyph) instead of a packaged
 * bitmap. `AnimatedVehicleMarker` smoothly interpolates between positions and honors reduced
 * motion by snapping. The web counterparts are `vehicleIcon` + `AnimatedMarker`.
 */

private const val MARKER_DP = 28
private const val DOT_DP = 16
private const val ANIM_MS = 350

/** A static vehicle marker for [marker]. [onClick] returns true to consume the tap. */
@Composable
@GoogleMapComposable
fun VehicleMarker(
    marker: MapMarker,
    onClick: (MapMarker) -> Boolean = { false },
) {
    val color = markerColor(marker.severity)
    val state = rememberUpdatedMarkerState(position = marker.point.toLatLng())
    MarkerComposable(
        color,
        marker.headingDegrees ?: NO_HEADING,
        marker.id,
        state = state,
        title = marker.title,
        snippet = marker.snippet,
        onClick = { onClick(marker) },
    ) {
        VehicleGlyph(color = color, headingDegrees = marker.headingDegrees)
    }
}

/**
 * A vehicle marker that animates from its previous position to [target] over [durationMs];
 * under reduced motion it jumps. Mirrors the web `AnimatedMarker`'s smooth `setLatLng`.
 *
 * Uses the manual (deprecated) `rememberMarkerState` deliberately: the position is driven each
 * frame at double precision, which the auto-updating `rememberUpdatedMarkerState` would override.
 */
@Composable
@GoogleMapComposable
@Suppress("DEPRECATION")
fun AnimatedVehicleMarker(
    target: GeoPoint,
    headingDegrees: Double? = null,
    severity: MapMarkerSeverity = MapMarkerSeverity.Active,
    title: String? = null,
    durationMs: Int = ANIM_MS,
) {
    val reduce = rememberReducedMotion()
    val color = markerColor(severity)
    val state = rememberMarkerState(position = target.toLatLng())
    LaunchedEffect(target.lat, target.lng, reduce) {
        if (reduce) {
            state.position = target.toLatLng()
        } else {
            val start = state.position
            Animatable(0f).animateTo(1f, tween(durationMs)) {
                state.position =
                    LatLng(
                        lerpDouble(start.latitude, target.lat, value),
                        lerpDouble(start.longitude, target.lng, value),
                    )
            }
        }
    }
    MarkerComposable(color, headingDegrees ?: NO_HEADING, state = state, title = title) {
        VehicleGlyph(color = color, headingDegrees = headingDegrees)
    }
}

/** A small filled dot marker (route start / end, generic points). */
@Composable
@GoogleMapComposable
fun MapDotMarker(
    point: GeoPoint,
    color: Color,
    title: String? = null,
) {
    val state = rememberUpdatedMarkerState(position = point.toLatLng())
    MarkerComposable(color, point.lat, point.lng, state = state, title = title) {
        DotGlyph(color = color)
    }
}

@Composable
private fun DotGlyph(color: Color) {
    Canvas(modifier = Modifier.size(DOT_DP.dp)) {
        val r = size.minDimension / 2f
        drawCircle(color = color, radius = r, center = center)
        drawCircle(color = Color.White, radius = r, center = center, style = Stroke(2f))
    }
}

@Composable
private fun VehicleGlyph(
    color: Color,
    headingDegrees: Double?,
) {
    Canvas(
        modifier =
            Modifier
                .size(MARKER_DP.dp)
                .graphicsLayer { if (headingDegrees != null) rotationZ = headingDegrees.toFloat() },
    ) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val r = size.minDimension * 0.28f
        if (headingDegrees != null) {
            val tip = size.minDimension * 0.46f
            val arrow =
                Path().apply {
                    moveTo(center.x, center.y - tip)
                    lineTo(center.x + r, center.y + r)
                    lineTo(center.x, center.y + r * 0.4f)
                    lineTo(center.x - r, center.y + r)
                    close()
                }
            drawPath(arrow, color = color)
            drawPath(arrow, color = Color.White, style = Stroke(2f))
        } else {
            drawCircle(color = color, radius = r, center = center)
            drawCircle(color = Color.White, radius = r, center = center, style = Stroke(2f))
        }
    }
}

private const val NO_HEADING = -1.0
