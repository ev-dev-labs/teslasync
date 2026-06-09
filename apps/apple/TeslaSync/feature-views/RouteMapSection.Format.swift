//
//  RouteMapSection.Format.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  Pure geo + unit + date/time helpers for the route-map projection, ported byte-for-byte from the web
//  source's libs so the native map gates the route and labels the legend / markers identically:
//    • `RouteMapGeo`      ← web `lib/geo.ts` (haversine, validity, hasMeaningfulRoute, firstValidIndex)
//    • `RouteMapUnitMath` ← web `lib/unitConversion.ts` + `lib/numberFormat.ts` (speed convert, fmt)
//    • `RouteMapFormat`   ← web `lib/dateFormat.ts` (formatTime, formatDateTime)
//
//  Foundation-only (no SwiftUI / MapKit) so the math is host-testable in isolation and shared by the
//  projector + (transitively) the views.
//

import Foundation

// MARK: - Geo helpers (ported from web lib/geo.ts)

/// Pure geospatial validation + route-meaningfulness checks, byte-for-byte with the web `lib/geo.ts` so
/// the native map gates the route exactly as the web one does.
public enum RouteMapGeo {
    /// Earth radius in meters (web `haversineDistance` `R`).
    public static let earthRadiusMeters = 6_371_000.0
    /// Web `MIN_MEANINGFUL_ROUTE_METERS`.
    public static let minMeaningfulRouteMeters = 10.0

    /// Web `isValidLatLng`: finite, non-`(0,0)`, within global bounds.
    public static func isValid(latitude: Double, longitude: Double) -> Bool {
        guard latitude.isFinite, longitude.isFinite else { return false }
        if latitude == 0, longitude == 0 { return false }
        if latitude < -90 || latitude > 90 { return false }
        if longitude < -180 || longitude > 180 { return false }
        return true
    }

    /// Web `haversineDistance` — great-circle distance in meters.
    public static func haversineDistance(
        _ lat1: Double,
        _ lon1: Double,
        _ lat2: Double,
        _ lon2: Double
    ) -> Double {
        let toRad = { (deg: Double) in deg * Double.pi / 180 }
        let dLat = toRad(lat2 - lat1)
        let dLon = toRad(lon2 - lon1)
        let aTerm = pow(sin(dLat / 2), 2)
            + cos(toRad(lat1)) * cos(toRad(lat2)) * pow(sin(dLon / 2), 2)
        return earthRadiusMeters * 2 * atan2(sqrt(aTerm), sqrt(1 - aTerm))
    }

    /// Web `hasMeaningfulRoute`: at least two valid coords ≥ `minMeaningfulRouteMeters` apart.
    public static func hasMeaningfulRoute(_ positions: [RouteMapPosition]) -> Bool {
        let anchorIndex = firstValidIndex(positions)
        guard anchorIndex >= 0 else { return false }
        let anchor = positions[anchorIndex]
        for index in (anchorIndex + 1) ..< positions.count {
            let point = positions[index]
            guard isValid(latitude: point.latitude, longitude: point.longitude) else { continue }
            let distance = haversineDistance(anchor.latitude, anchor.longitude, point.latitude, point.longitude)
            if distance >= minMeaningfulRouteMeters { return true }
        }
        return false
    }

    /// Web `firstValidIndex`: index of the first valid coordinate, or `-1`.
    public static func firstValidIndex(_ positions: [RouteMapPosition]) -> Int {
        positions.firstIndex { isValid(latitude: $0.latitude, longitude: $0.longitude) } ?? -1
    }
}

// MARK: - Unit math (ported from web lib/unitConversion.ts + lib/numberFormat.ts)

/// Web-parity SI speed conversion + number formatting for the route legend, reproducing
/// `convertSpeedFromSI` and `fmtNumber` so the thresholds read identically to the web footer.
public enum RouteMapUnitMath {
    /// 1 mph = 0.44704 m/s exactly — web route-segment threshold factor.
    public static let mphToMps = 0.44704
    /// 1 mile = 1609.344 m — web `METERS_PER_MILE`.
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m — web `METERS_PER_KM`.
    public static let metersPerKm = 1000.0
    /// Web `SECONDS_PER_HOUR`.
    public static let secondsPerHour = 3600.0

    /// Web `SPEED_SEGMENT_LOW_MPS` (30 mph in m/s).
    public static let lowThresholdMps = 30 * mphToMps
    /// Web `SPEED_SEGMENT_MED_MPS` (60 mph in m/s).
    public static let medThresholdMps = 60 * mphToMps
    /// Web `SPEED_SEGMENT_HIGH_MPS` (100 mph in m/s).
    public static let highThresholdMps = 100 * mphToMps

    /// Web `safeNumber(v)`: a finite number, else `0`.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertSpeedFromSI(mps, to)`: m/s → the display speed unit.
    public static func speedFromSI(_ mps: Double, _ unit: String) -> Double {
        switch unit {
        case "km/h":
            (mps * secondsPerHour) / metersPerKm
        default: // "mph"
            (mps * secondsPerHour) / metersPerMile
        }
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of fraction
    /// digits, with the JS `toLocaleString` half-away-from-zero rounding and the `safeNumber` guard.
    public static func fmtNumber(
        _ value: Double,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Classifies a raw SI m/s speed into its band (web `speedSegments` color ladder).
    public static func band(forSpeedMps speed: Double) -> RouteSpeedBand {
        if speed >= highThresholdMps { return .high }
        if speed >= medThresholdMps { return .midHigh }
        if speed >= lowThresholdMps { return .lowMid }
        return .low
    }
}

// MARK: - Date / time formatting (ported from web lib/dateFormat.ts)

/// Locale + timezone-aware date/time formatting mirroring web `formatTime`
/// (`{ hour:'2-digit', minute:'2-digit' }`) and `formatDateTime`
/// (`{ year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }`). A
/// `nil`/invalid date renders the web "—" em-dash; a `nil` timezone uses the device's current zone.
public enum RouteMapFormat {
    /// The web "no value" em-dash returned for null/invalid input.
    public static let emptyMarker = "—"

    private static func timeZone(_ prefs: RouteMapFormatPrefs) -> TimeZone {
        guard let identifier = prefs.timeZoneIdentifier, let zone = TimeZone(identifier: identifier) else {
            return .current
        }
        return zone
    }

    private static func formatter(_ prefs: RouteMapFormatPrefs, template: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: prefs.localeIdentifier)
        formatter.timeZone = timeZone(prefs)
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }

    /// Web `formatTime` — "2:30 PM" (12h) or "14:30" (24h), chosen by the locale's hour convention.
    public static func time(_ date: Date?, prefs: RouteMapFormatPrefs) -> String {
        guard let date else { return emptyMarker }
        return formatter(prefs, template: "jjmm").string(from: date)
    }

    /// Web `formatDate` — "Apr 4, 2026".
    public static func date(_ date: Date?, prefs: RouteMapFormatPrefs) -> String {
        guard let date else { return emptyMarker }
        return formatter(prefs, template: "yMMMd").string(from: date)
    }

    /// Web `formatDateTime` — "Apr 4, 2026, 2:30 PM" (date + ", " + time), the marker-popup stamp.
    public static func dateTime(_ date: Date?, prefs: RouteMapFormatPrefs) -> String {
        guard date != nil else { return emptyMarker }
        return "\(self.date(date, prefs: prefs)), \(time(date, prefs: prefs))"
    }
}
