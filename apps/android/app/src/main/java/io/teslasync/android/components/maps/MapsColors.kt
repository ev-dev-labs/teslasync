package io.teslasync.android.components.maps

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import io.teslasync.android.ui.theme.TeslaTokens

/*
 * Token-based color resolution for the maps layer. Every map color comes from the per-theme
 * TeslaTokens.status palette, the theme-invariant chart palette, or the Material 3 scheme —
 * never a raw hex literal in component code — so light / dark / high-contrast stay correct.
 */

/** Per-theme color for a marker [severity]. */
@Composable
@ReadOnlyComposable
fun markerColor(severity: MapMarkerSeverity): Color =
    when (severity) {
        MapMarkerSeverity.Info -> TeslaTokens.status.info
        MapMarkerSeverity.Active -> MaterialTheme.colorScheme.primary
        MapMarkerSeverity.Success -> TeslaTokens.status.success
        MapMarkerSeverity.Warning -> TeslaTokens.status.warning
        MapMarkerSeverity.Critical -> TeslaTokens.status.danger
    }

/** Density-graded cluster-bubble color, mirroring the web `defaultIconCreate` thresholds. */
@Composable
@ReadOnlyComposable
fun clusterColor(count: Int): Color =
    when {
        count >= CLUSTER_DENSE -> TeslaTokens.status.danger
        count >= CLUSTER_BUSY -> TeslaTokens.status.warning
        count >= CLUSTER_GROUPED -> TeslaTokens.chart.power
        else -> MaterialTheme.colorScheme.primary
    }

/** Polyline color for a replay trail. */
@Composable
@ReadOnlyComposable
fun routeTrailColor(): Color = MaterialTheme.colorScheme.primary

/** Start-of-route marker color. */
@Composable
@ReadOnlyComposable
fun routeStartColor(): Color = TeslaTokens.status.success

/** End-of-route marker color. */
@Composable
@ReadOnlyComposable
fun routeEndColor(): Color = TeslaTokens.status.danger

/** Stroke / fill color for drawn geofences. */
@Composable
@ReadOnlyComposable
fun geofenceColor(): Color = MaterialTheme.colorScheme.primary

private const val CLUSTER_GROUPED = 10
private const val CLUSTER_BUSY = 25
private const val CLUSTER_DENSE = 100
