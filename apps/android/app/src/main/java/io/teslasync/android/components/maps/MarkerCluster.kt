@file:OptIn(MapsComposeExperimentalApi::class)

package io.teslasync.android.components.maps

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.MapsComposeExperimentalApi
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberUpdatedMarkerState

/*
 * Grid-clustering marker layer — the Android counterpart of the web `MarkerCluster`. The pure
 * `clusterMarkers` logic groups points for the current [zoom]; grouped cells render as a counted
 * bubble (density-graded color) and singletons as full vehicle markers. The grouping is unit-
 * tested in `MapsLogicTest`; this composable only renders the result.
 */

private val BADGE_DP = 36.dp

/** Renders [markers] clustered for the given camera [zoom]. */
@Composable
@GoogleMapComposable
fun MarkerClusterLayer(
    markers: List<MapMarker>,
    zoom: Double,
    onClusterClick: (MarkerCluster) -> Unit = {},
    onMarkerClick: (MapMarker) -> Unit = {},
) {
    val byId = remember(markers) { markers.associateBy { it.id } }
    val clusters = remember(markers, zoom) { clusterMarkers(markers, zoom) }
    clusters.forEach { cluster ->
        key(cluster.memberIds.first(), cluster.count) {
            if (cluster.isCluster) {
                ClusterBubble(cluster = cluster, onClick = { onClusterClick(cluster) })
            } else {
                byId[cluster.memberIds.first()]?.let { marker ->
                    VehicleMarker(
                        marker = marker,
                        onClick = { tapped ->
                            onMarkerClick(tapped)
                            true
                        },
                    )
                }
            }
        }
    }
}

@Composable
@GoogleMapComposable
private fun ClusterBubble(
    cluster: MarkerCluster,
    onClick: () -> Unit,
) {
    val color = clusterColor(cluster.count)
    val state = rememberUpdatedMarkerState(position = cluster.point.toLatLng())
    MarkerComposable(
        cluster.count,
        cluster.point.lat,
        cluster.point.lng,
        state = state,
        onClick = {
            onClick()
            true
        },
    ) {
        ClusterBadge(count = cluster.count, color = color)
    }
}

@Composable
private fun ClusterBadge(
    count: Int,
    color: Color,
) {
    Box(
        modifier =
            Modifier
                .size(BADGE_DP)
                .clip(CircleShape)
                .background(color)
                .border(2.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = count.toString(),
            color = Color.White,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
        )
    }
}
