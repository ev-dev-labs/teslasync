// File named after its primary @Composable; the co-located enum/data class are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** A trip endpoint: a resolved [address] (preferred) or a [lat]/[lon] coordinate fallback. */
data class RouteEndpoint(
    val address: String? = null,
    val lat: Double? = null,
    val lon: Double? = null,
)

/** Classification of a route for display. */
enum class RouteKind { NoLocation, RoundTrip, PointToPoint }

private const val EARTH_RADIUS_M = 6_371_000.0
private const val DEFAULT_ROUND_TRIP_M = 100.0

/** Great-circle distance between two coordinates, in metres. */
fun haversineMeters(
    aLat: Double,
    aLon: Double,
    bLat: Double,
    bLon: Double,
): Double {
    val dLat = Math.toRadians(bLat - aLat)
    val dLon = Math.toRadians(bLon - aLon)
    val lat1 = Math.toRadians(aLat)
    val lat2 = Math.toRadians(bLat)
    val x = sin(dLat / 2).let { it * it } + cos(lat1) * cos(lat2) * sin(dLon / 2).let { it * it }
    return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(x)))
}

/** Pretty label for an endpoint: address, else "lat, lon" (2 dp), else `null`. */
fun endpointLabel(
    endpoint: RouteEndpoint,
    locale: Locale = Locale.getDefault(),
): String? {
    val address = endpoint.address?.trim()
    return when {
        !address.isNullOrEmpty() -> address
        endpoint.lat != null && endpoint.lon != null -> String.format(locale, "%.2f, %.2f", endpoint.lat, endpoint.lon)
        else -> null
    }
}

/** Classifies a [start]/[end] pair as no-location / round-trip / point-to-point. */
fun routeKind(
    start: RouteEndpoint,
    end: RouteEndpoint? = null,
    roundTripThresholdM: Double = DEFAULT_ROUND_TRIP_M,
): RouteKind {
    val startLabel = endpointLabel(start)
    val endLabel = end?.let { endpointLabel(it) }
    if (startLabel == null && endLabel == null) return RouteKind.NoLocation
    val explicitSingle = end == null
    val addressesMatch = startLabel != null && endLabel != null && startLabel == endLabel
    val coordsClose =
        start.lat != null &&
            start.lon != null &&
            end?.lat != null &&
            end.lon != null &&
            haversineMeters(start.lat, start.lon, end.lat, end.lon) < roundTripThresholdM
    val isRoundTrip = startLabel != null && (explicitSingle || addressesMatch || coordsClose)
    return if (isRoundTrip) RouteKind.RoundTrip else RouteKind.PointToPoint
}

/**
 * "From → To" / "round trip" / "single location" / "no location" line — the Android counterpart
 * of the web `RouteDisplay`. Used by every history row (Drives, Charging, Trips). Pass localized
 * [noLocationLabel] / [roundTripLabel] to override the English defaults.
 */
@Composable
fun RouteDisplay(
    start: RouteEndpoint,
    modifier: Modifier = Modifier,
    end: RouteEndpoint? = null,
    roundTripThresholdM: Double = DEFAULT_ROUND_TRIP_M,
    showIcon: Boolean = true,
    noLocationLabel: String = "No location data",
    roundTripLabel: String = "round trip",
) {
    val startLabel = endpointLabel(start)
    val endLabel = end?.let { endpointLabel(it) }
    val kind = routeKind(start, end, roundTripThresholdM)
    val text =
        when (kind) {
            RouteKind.NoLocation -> noLocationLabel
            RouteKind.RoundTrip ->
                if (end != null) "${startLabel.orEmpty()} \u21bb $roundTripLabel" else startLabel.orEmpty()
            RouteKind.PointToPoint -> "${startLabel ?: noLocationLabel} \u2192 ${endLabel ?: noLocationLabel}"
        }
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showIcon) {
            Icon(DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
