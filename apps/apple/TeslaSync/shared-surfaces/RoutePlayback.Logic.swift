//
//  RoutePlayback.Logic.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The pure decision + transform core for the route-playback surface — the parts of
//  `components/maps/RoutePlayback.tsx` that are neither rendering nor map plumbing: the localisation
//  seam (web `t(key, default)`), the geometry value types (a Foundation-only coordinate + span so the
//  pure core needs no MapKit), the plottable-coordinate guard (web `Number.isFinite(lat) &&
//  Number.isFinite(lng)` trail filter, widened with a valid-range check), the playback math (the web
//  `buildOffsets` / `indexAtTime` binary search / `computeHeading` great-circle bearing / `fmtDuration`
//  / the `tick` advance), the replay-speed ladder (web `SPEEDS = [1, 10, 25, 50, 100]`), and the trail
//  colour parse (the web `trailColor` / `markerColor` hex props). Foundation-only, so every branch is
//  asserted without rendering.
//

import Foundation

// MARK: - Localisation seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: production passes the
/// P1/S10 facade, tests pass the identity resolver.
public typealias RoutePlaybackResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Geometry value types (Foundation-only; MapKit at the view boundary only)

/// A geographic coordinate — the native value type for the web `[lat, lng]` tuple. Kept MapKit-free so
/// the trail + heading + fit logic stay pure and unit tested; the map view converts to
/// `CLLocationCoordinate2D` at its boundary.
public struct RoutePlaybackCoordinate: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// Resolved sRGB colour components (0…1) — the parsed form of the web `trailColor` / `markerColor` hex
/// props. Carried MapKit/SwiftUI-free so the parse is pure; the view converts to a SwiftUI `Color`.
public struct RoutePlaybackColorComponents: Sendable, Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

// MARK: - Geometry helpers

/// The pure helpers backing the trail geometry + heading. All total + side-effect-free.
public enum RoutePlaybackGeo {
    /// Whether a coordinate is plottable on the trail — finite and in valid lat/lng range. The native
    /// port of the web trail filter `Number.isFinite(p.lat) && Number.isFinite(p.lng)`, widened with a
    /// range check. Unlike the live marker, the route trail keeps `(0, 0)` (the web filter does not
    /// special-case the null island).
    public static func isPlottable(_ coordinate: RoutePlaybackCoordinate) -> Bool {
        guard coordinate.latitude.isFinite, coordinate.longitude.isFinite else { return false }
        return abs(coordinate.latitude) <= 90 && abs(coordinate.longitude) <= 180
    }

    /// The compass bearing (0…360) from `start` to `end` — the verbatim port of the web `computeHeading`
    /// great-circle formula fed to the playhead's heading. Returns 0 for a degenerate pair.
    public static func heading(from start: RoutePlaybackCoordinate, to end: RoutePlaybackCoordinate) -> Double {
        let lat1 = start.latitude * .pi / 180
        let lat2 = end.latitude * .pi / 180
        let deltaLon = (end.longitude - start.longitude) * .pi / 180
        let yComponent = sin(deltaLon) * cos(lat2)
        let xComponent = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        let bearing = atan2(yComponent, xComponent) * 180 / .pi
        return (bearing + 360).truncatingRemainder(dividingBy: 360)
    }
}

// MARK: - Playback timing (web `buildOffsets` / `indexAtTime` / `fmtDuration` / `tick`)

/// The pure timeline math driving the playhead — offsets from the first sample, the nearest-sample
/// binary search, the elapsed clock advance, and the time readout formatter. Milliseconds throughout,
/// mirroring the web source's `Date.getTime()` arithmetic.
public enum RoutePlaybackTiming {
    /// The replay tick cadence in milliseconds (web `TICK_MS = 50`).
    public static let tickMs: Double = 50

    /// The relative millisecond offset of every sample from the first — the port of the web
    /// `buildOffsets`. A non-finite timestamp contributes a `0` offset (web `Number.isNaN(t) ? 0`).
    public static func offsets(from timestamps: [Date?]) -> [Double] {
        guard let first = timestamps.first ?? nil else { return [] }
        let base = first.timeIntervalSince1970 * 1000
        return timestamps.map { stamp in
            guard let stamp else { return 0 }
            let value = stamp.timeIntervalSince1970 * 1000
            return value.isFinite ? value - base : 0
        }
    }

    /// The index of the offset nearest `target` — the verbatim port of the web `indexAtTime` binary
    /// search (lower-bound, then pick whichever neighbour is closer). Empty offsets resolve to 0.
    public static func index(at target: Double, in offsets: [Double]) -> Int {
        if offsets.isEmpty { return 0 }
        var low = 0
        var high = offsets.count - 1
        while low < high {
            let mid = (low + high) / 2
            if offsets[mid] < target {
                low = mid + 1
            } else {
                high = mid
            }
        }
        if low > 0, target - offsets[low - 1] < offsets[low] - target {
            return low - 1
        }
        return low
    }

    /// Advances the elapsed clock one tick — the pure core of the web `tick`. Returns the new elapsed
    /// time clamped to `[0, total]` and whether playback reached the end (web stops + clamps there).
    public static func advance(
        elapsed: Double,
        total: Double,
        speedMultiplier: Int
    ) -> (elapsed: Double, reachedEnd: Bool) {
        guard total > 0 else { return (0, true) }
        let next = elapsed + tickMs * Double(speedMultiplier)
        if next >= total { return (total, true) }
        return (max(0, next), false)
    }

    /// Formats a millisecond duration as the web `fmtDuration` does — `m:ss` under an hour, `h:mm:ss`
    /// at or above it. Negative input is clamped to zero.
    public static func formatDuration(_ milliseconds: Double) -> String {
        let totalSeconds = Int((max(0, milliseconds) / 1000).rounded(.down))
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        let mm = String(format: "%02d", minutes)
        let ss = String(format: "%02d", seconds)
        return hours > 0 ? "\(hours):\(mm):\(ss)" : "\(mm):\(ss)"
    }
}

// MARK: - Trail colour (web `trailColor` / `markerColor` hex props)

/// Parses the web `trailColor` / `markerColor` hex props (`#RGB` / `#RRGGBB` / `#RRGGBBAA`). Returns
/// `nil` for an absent / malformed value so the view falls back to a semantic theme token (the toned
/// parity that keeps the surface light/dark-correct). Pure + total.
public enum RoutePlaybackPalette {
    /// The web `trailColor = '#22d3ee'` default, surfaced for tests / reference.
    public static let defaultTrailHex = "#22d3ee"
    /// The web `markerColor = '#00b4d8'` default, surfaced for tests / reference.
    public static let defaultMarkerHex = "#00b4d8"

    /// Parses a hex string to sRGB components, or `nil` for nil / empty / malformed input. Accepts an
    /// optional leading `#`, 3-digit shorthand, 6-digit, and 8-digit (with alpha).
    public static func parse(_ hex: String?) -> RoutePlaybackColorComponents? {
        guard var raw = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        if raw.hasPrefix("#") { raw.removeFirst() }

        let expanded: String
        switch raw.count {
        case 3: expanded = raw.map { "\($0)\($0)" }.joined()
        case 6, 8: expanded = raw
        default: return nil
        }

        guard let value = UInt64(expanded, radix: 16) else { return nil }

        if expanded.count == 8 {
            return RoutePlaybackColorComponents(
                red: Double((value >> 24) & 0xFF) / 255,
                green: Double((value >> 16) & 0xFF) / 255,
                blue: Double((value >> 8) & 0xFF) / 255,
                alpha: Double(value & 0xFF) / 255
            )
        }
        return RoutePlaybackColorComponents(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
