// Pure, framework-free model + projection for the Geofence Status dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/GeofenceWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. Geofence radius + the vehicle position arrive SI (meters, degrees) from the API; the
// radius is converted at this display boundary exactly as the web does
// (`convertDistanceFromSI(radius, unitPrefs.distance)`), and the inside/outside test uses the same
// great-circle (haversine) distance in meters the web computes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/GeofenceWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.geofence

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDistance
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

private const val EM_DASH = "\u2014"

/**
 * A WGS-84 vehicle position, in degrees, as read from the latest `GET /vehicles/{id}/state` envelope.
 * Modelled as a nullable value on [GeofenceFeed]: a `null` coordinate is the web `hasCoords === false`
 * branch (no state, or a `(0, 0)` reading), where every fence's distance is treated as infinite so none
 * resolve as "inside".
 */
public data class GeoCoordinate(
    val latitude: Double,
    val longitude: Double,
)

/**
 * One decoded combined reading the widget renders: the current vehicle [coords] (or `null` when the
 * vehicle has no usable position) plus the vehicle-agnostic [fences] list from `GET /geofences`. The
 * native mirror of the two web hooks the component composes (`useVehicleState` + `useGeofences`); the
 * fence list is the primary, freshness-bearing content and the coordinate is folded in to drive the
 * inside/outside test, exactly as the web derives `vLat`/`vLon` from the state query.
 */
public data class GeofenceFeed(
    val coords: GeoCoordinate?,
    val fences: List<Geofence>,
) {
    public companion object {
        /** The resolved-but-empty feed (no coordinate, no fences) — the web "No geofences configured" body. */
        public val EMPTY: GeofenceFeed = GeofenceFeed(coords = null, fences = emptyList())
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the two
 * branches in the web source: a single column renders the compact body (the crosshair + current-zone
 * badge), and the standard body only renders the inline map when there are 3+ rows
 * (`showMap = hasCoords && size.rows >= 3`).
 */
public data class GeofenceSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact body. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    public companion object {
        private const val COMPACT_MAX_COLS = 1

        /** Registry default footprint (2×4). */
        public val Default: GeofenceSize = GeofenceSize(cols = 2, rows = 4)

        /** Registry minimum footprint (1×2). */
        public val MinSize: GeofenceSize = GeofenceSize(cols = 1, rows = 2)

        /** Registry maximum footprint (4×40). */
        public val MaxSize: GeofenceSize = GeofenceSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        public fun withinBounds(size: GeofenceSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        public fun clamp(size: GeofenceSize): GeofenceSize =
            GeofenceSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/maps.ts (`geofence-status`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
public object GeofenceRegistration {
    /** Stable registry id (matches the web registry). */
    public const val ID: String = "geofence-status"

    /** Widget category (matches the web registry). */
    public const val CATEGORY: String = "maps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    public const val SLUG: String = "GeofenceWidget"

    /** Default footprint: 2 columns × 4 rows. */
    public val defaultSize: GeofenceSize get() = GeofenceSize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    public val minSize: GeofenceSize get() = GeofenceSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    public val maxSize: GeofenceSize get() = GeofenceSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    public fun withinBounds(size: GeofenceSize): Boolean = GeofenceSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    public fun clamp(size: GeofenceSize): GeofenceSize = GeofenceSize.clamp(size)
}

/**
 * The per-fence status badge family — the native analogue of the web component's three badge branches
 * (`!enabled` → "Disabled", `inside` → "Inside", else → "Outside"). The badge tone is resolved at the
 * render boundary (Inside → success, Disabled/Outside → neutral, mirroring the web variant map).
 */
public enum class FenceStatusKind {
    /** The fence is disabled (web `!f.enabled` → neutral "Disabled" badge). */
    Disabled,

    /** The vehicle is inside an enabled fence (web `f.inside` → success "Inside" badge). */
    Inside,

    /** The vehicle is outside the fence (web fallthrough → neutral "Outside" badge). */
    Outside,
}

/**
 * The localized labels the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [GeofenceProjection.project] stays pure and
 * JVM-testable. Keys mirror the web `t('widget.geofence.*')` calls verbatim. The header
 * refresh/refreshing/offline microcopy + the relative-time formatter are render-only chrome shared with
 * the freshness chip.
 */
public data class GeofenceStrings(
    val title: String,
    val noZone: String,
    val noFences: String,
    val radiusLabel: String,
    val disabled: String,
    val inside: String,
    val outside: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
) {
    /** The localized badge label for a [kind] (web "Disabled" / "Inside" / "Outside"). */
    public fun labelFor(kind: FenceStatusKind): String =
        when (kind) {
            FenceStatusKind.Disabled -> disabled
            FenceStatusKind.Inside -> inside
            FenceStatusKind.Outside -> outside
        }
}

/**
 * One fully projected, render-ready fence row — the native analogue of the web `FenceStatus` interface
 * plus the per-row derivations the component performs inline (the unit-converted radius label, the
 * inside/disabled badge selection, and the highlighted-row flag). Pure data so the projection is
 * unit-tested without a UI host.
 *
 * @property radiusMeters the SI radius carried verbatim (used by the inline map's circle).
 * @property inside whether the vehicle is within [radiusMeters] of the fence centre (web `f.inside`).
 * @property distanceMeters great-circle distance to the fence centre, or +∞ when the vehicle has no
 *   position (web `Infinity`).
 * @property radiusText the unit-converted, formatted radius (web `fmtRadius(f.radius)`, e.g. "0.2 km").
 * @property status the badge family for this row (web's `!enabled` / `inside` / else branches).
 * @property statusLabel the localized badge text for [status].
 * @property highlighted whether the row is the active zone (web `f.inside && f.enabled` → ring + wash).
 * @property contentDescription the row's TalkBack announcement (name + status + radius).
 */
public data class FenceStatus(
    val id: String,
    val name: String,
    val radiusMeters: Double,
    val latitude: Double,
    val longitude: Double,
    val enabled: Boolean,
    val inside: Boolean,
    val distanceMeters: Double,
    val radiusText: String,
    val status: FenceStatusKind,
    val statusLabel: String,
    val highlighted: Boolean,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of one combined reading for one footprint + unit preference —
 * the native analogue of everything the web component computes before returning JSX (the `fences` map,
 * the `currentZone` lookup, the `isCompact` / `isEmpty` / `showMap` flags, and the map centre). Pure
 * data so the projection is unit-tested without a UI host.
 *
 * @property currentZoneName the name of the first enabled fence the vehicle is inside (web `currentZone`),
 *   or `null` when none — the compact body shows this or the "No zone" badge.
 * @property showMap whether the inline map renders (web `hasCoords && size.rows >= 3`).
 * @property centerLatitude / [centerLongitude] the vehicle position the map centres on + marks.
 */
public data class GeofenceDisplay(
    val isCompact: Boolean,
    val isEmpty: Boolean,
    val showMap: Boolean,
    val hasCoords: Boolean,
    val centerLatitude: Double,
    val centerLongitude: Double,
    val currentZoneName: String?,
    val fences: List<FenceStatus>,
    val title: String,
    val noZoneText: String,
    val noFencesText: String,
    val radiusLabel: String,
)

/**
 * Pure projection from a decoded [GeofenceFeed] (+ footprint + unit preference) to the
 * [GeofenceDisplay] — the native port of the web component's `fences` derivation, `currentZone` lookup,
 * and the compact / standard / map branch flags. The radius is converted from SI meters to the user's
 * distance unit (web `convertDistanceFromSI(meters, unitPrefs.distance)` + `fmtNumber(_, 1)`), and the
 * inside test uses the same great-circle distance the web computes with [haversineMeters].
 */
public object GeofenceProjection {
    /** Radius fraction digits (web `fmtRadius` → `fmtNumber(value, 1)`). */
    public const val RADIUS_PRECISION: Int = 1

    /** Minimum rows before the standard body renders the inline map (web `size.rows >= 3`). */
    public const val MAP_MIN_ROWS: Int = 3

    private const val EARTH_RADIUS_M = 6_371_000.0
    private const val DEG_TO_RAD = Math.PI / 180.0

    /**
     * Project [feed] for [size] + [units] using [strings] for every localized string. Mirrors the web
     * component: every geofence becomes a [FenceStatus] (distance + inside computed against the vehicle
     * position, radius unit-converted), the current zone is the first enabled fence the vehicle is
     * inside, and the compact / empty / map flags follow the web's `isCompact` / `isEmpty` / `showMap`.
     */
    public fun project(
        feed: GeofenceFeed,
        size: GeofenceSize,
        units: UnitPref,
        strings: GeofenceStrings,
    ): GeofenceDisplay {
        val coords = feed.coords
        val hasCoords = coords != null
        val fences = feed.fences.map { fenceStatus(it, coords, units, strings) }
        val currentZone = fences.firstOrNull { it.inside && it.enabled }

        return GeofenceDisplay(
            isCompact = size.isCompact,
            isEmpty = fences.isEmpty(),
            showMap = hasCoords && size.rows >= MAP_MIN_ROWS,
            hasCoords = hasCoords,
            centerLatitude = coords?.latitude ?: 0.0,
            centerLongitude = coords?.longitude ?: 0.0,
            currentZoneName = currentZone?.name,
            fences = fences,
            title = strings.title,
            noZoneText = strings.noZone,
            noFencesText = strings.noFences,
            radiusLabel = strings.radiusLabel,
        )
    }

    /** Projects one [geofence] against the vehicle [coords] (web's per-fence `raw.map` body). */
    private fun fenceStatus(
        geofence: Geofence,
        coords: GeoCoordinate?,
        units: UnitPref,
        strings: GeofenceStrings,
    ): FenceStatus {
        val radius = geofence.radius
        val name = geofence.name.ifEmpty { EM_DASH }
        val distance =
            if (coords != null) {
                haversineMeters(coords.latitude, coords.longitude, geofence.latitude, geofence.longitude)
            } else {
                Double.POSITIVE_INFINITY
            }
        val inside = distance <= radius
        val status =
            when {
                !geofence.enabled -> FenceStatusKind.Disabled
                inside -> FenceStatusKind.Inside
                else -> FenceStatusKind.Outside
            }
        val radiusText = formatDistance(radius, units, RADIUS_PRECISION)
        val statusLabel = strings.labelFor(status)
        return FenceStatus(
            id = geofence.id.toString(),
            name = name,
            radiusMeters = radius,
            latitude = geofence.latitude,
            longitude = geofence.longitude,
            enabled = geofence.enabled,
            inside = inside,
            distanceMeters = distance,
            radiusText = radiusText,
            status = status,
            statusLabel = statusLabel,
            highlighted = inside && geofence.enabled,
            contentDescription = "$name, $statusLabel, ${strings.radiusLabel} $radiusText",
        )
    }

    /**
     * Great-circle distance in meters between two WGS-84 points — a 1:1 port of the web component's
     * `haversineMeters`, using the same 6 371 000 m mean Earth radius.
     */
    public fun haversineMeters(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double,
    ): Double {
        val dLat = (lat2 - lat1) * DEG_TO_RAD
        val dLon = (lon2 - lon1) * DEG_TO_RAD
        val a =
            sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * DEG_TO_RAD) * cos(lat2 * DEG_TO_RAD) *
                sin(dLon / 2) * sin(dLon / 2)
        return EARTH_RADIUS_M * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
