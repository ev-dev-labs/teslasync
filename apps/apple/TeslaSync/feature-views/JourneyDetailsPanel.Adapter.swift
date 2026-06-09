//
//  JourneyDetailsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0144 · JourneyDetailsPanel (Apple)
//
//  The testable projection core: a `JourneyDriveDTO` + `JourneyFormatPrefs` → the view-ready
//  `JourneyDetailsProjection` (the Start + Destination endpoints), reproducing the web source's
//  render logic VERBATIM so the native panel shows the exact same text as
//  features/driving/components/drive-detail/JourneyDetailsPanel.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + composition compile and run on
//  a plain host and are pinned by unit tests. The number helper mirrors web `lib/numberFormat.ts`
//  (`fmtNumber`); the timestamp helper mirrors web `lib/dateFormat.ts` (`formatDateTime`) used by the
//  web `<DateTime in="vehicle">`.
//

import Foundation

// MARK: - Formatting (ported from web lib/numberFormat.ts + lib/dateFormat.ts)

/// Locale-aware number + date/time formatting that mirrors the web `fmtNumber`
/// (`toLocaleString({ minimumFractionDigits:d, maximumFractionDigits:d })`) and `formatDateTime`
/// (`toLocaleString({ year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })`).
/// A `nil`/invalid date renders the web "—" em-dash; a `nil` timezone uses the device's current zone
/// (the web pure path).
public enum JourneyDetailsFormat {
    /// The web "no value" em-dash returned by `formatDateTime` for null/invalid input.
    public static let emptyMarker = "—"

    /// The web unknown-battery sentinel (`drive.startBatteryPct ?? '?'`). Hardcoded in the web source
    /// (not localized), so it stays a non-localized formatting sentinel for parity.
    public static let unknownBattery = "?"

    private static func timeZone(_ prefs: JourneyFormatPrefs) -> TimeZone {
        guard let identifier = prefs.timeZoneIdentifier, let zone = TimeZone(identifier: identifier) else {
            return .current
        }
        return zone
    }

    /// `fmtNumber` — locale-grouped, fixed `decimalPrecision` fractional digits (default 2). Mirrors
    /// `Number.prototype.toLocaleString(locale, { minimumFractionDigits:d, maximumFractionDigits:d })`.
    public static func number(_ value: Double, prefs: JourneyFormatPrefs) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: prefs.localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = prefs.decimalPrecision
        formatter.maximumFractionDigits = prefs.decimalPrecision
        return formatter.string(from: NSNumber(value: value)) ?? emptyMarker
    }

    /// `formatDateTime` — "Apr 4, 2026 at 2:30 PM" (en) / "4. Apr. 2026, 14:30" (de): localized
    /// `year:numeric, month:short, day:numeric` + 2-digit `hour:minute`, rendered in the vehicle's
    /// IANA zone. The Apple-idiomatic peer of the web combined date-time run. `nil`/invalid → "—".
    public static func dateTime(_ date: Date?, prefs: JourneyFormatPrefs) -> String {
        guard let date else { return emptyMarker }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: prefs.localeIdentifier)
        formatter.timeZone = timeZone(prefs)
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjjmm")
        return formatter.string(from: date)
    }

    /// The web coordinate run, reproduced VERBATIM including its asymmetry:
    /// `${fmtNumber(lat)}°${lat >= 0 ? 'N' : 'S'}, ${fmtNumber(abs(lon))}°${lon >= 0 ? 'E' : 'W'}`.
    /// The latitude keeps its sign (it is NOT `Math.abs`'d in the source — only the longitude is), so
    /// a southern latitude reads e.g. "-33.87°S".
    public static func coordinate(latitude: Double, longitude: Double, prefs: JourneyFormatPrefs) -> String {
        let lat = number(latitude, prefs: prefs)
        let latHemisphere = latitude >= 0 ? "N" : "S"
        let lon = number(abs(longitude), prefs: prefs)
        let lonHemisphere = longitude >= 0 ? "E" : "W"
        return "\(lat)°\(latHemisphere), \(lon)°\(lonHemisphere)"
    }

    /// The web battery run `{pct ?? '?'}` — the raw percent for a known value (incl. 0), else the "?"
    /// sentinel. The trailing "%" is appended at the call site (web `…%`).
    public static func battery(_ percent: Int?) -> String {
        guard let percent else { return unknownBattery }
        return "\(percent)"
    }
}

// MARK: - Projected endpoint (one of the web's two `<div>` columns)

/// One resolved journey endpoint — the Start or the Destination column. Carries the localized label,
/// the primary location line (resolved address / coordinate / fallback), whether that line is a
/// coordinate (the web `font-mono`), the formatted timestamp line, and the battery value (without the
/// trailing "%"). Kept individually so the view + the accessibility summary read them without
/// re-deriving.
public struct JourneyEndpoint: Equatable, Sendable {
    /// Which endpoint this is — drives the icon + tint (web green Start / red Destination).
    public enum Tone: Equatable, Sendable {
        case start
        case destination
    }

    public let tone: Tone
    public let labelKey: String
    public let labelFallback: String
    /// The resolved location line: a non-empty address, else the lat/lon coordinate, else the
    /// localized "No address data" / "In progress" fallback.
    public let primaryText: String
    /// `true` when `primaryText` is a coordinate string (rendered monospaced — web `font-mono`).
    public let isCoordinate: Bool
    /// The timestamp line: the formatted vehicle-local time, or the localized "In progress".
    public let timestampText: String
    /// The battery percent value (web raw number or the "?" sentinel); the view appends "%".
    public let batteryValue: String

    public init(
        tone: Tone,
        labelKey: String,
        labelFallback: String,
        primaryText: String,
        isCoordinate: Bool,
        timestampText: String,
        batteryValue: String
    ) {
        self.tone = tone
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.primaryText = primaryText
        self.isCoordinate = isCoordinate
        self.timestampText = timestampText
        self.batteryValue = batteryValue
    }
}

/// The fully-projected panel content: the Start + Destination endpoints, each ready to render.
public struct JourneyDetailsProjection: Equatable, Sendable {
    public let start: JourneyEndpoint
    public let destination: JourneyEndpoint

    public init(start: JourneyEndpoint, destination: JourneyEndpoint) {
        self.start = start
        self.destination = destination
    }
}

/// Pure projector: `JourneyDriveDTO` + `JourneyFormatPrefs` → `JourneyDetailsProjection`. Every value
/// is computed with the same address/coordinate/timestamp/battery logic as the web component so the
/// web and native panels show identical text side by side.
public enum JourneyDetailsProjector {
    public static func project(drive: JourneyDriveDTO, prefs: JourneyFormatPrefs) -> JourneyDetailsProjection {
        JourneyDetailsProjection(
            start: startEndpoint(drive: drive, prefs: prefs),
            destination: destinationEndpoint(drive: drive, prefs: prefs)
        )
    }

    // MARK: Start (web first column)

    private static func startEndpoint(drive: JourneyDriveDTO, prefs: JourneyFormatPrefs) -> JourneyEndpoint {
        let location = startLocation(drive: drive, prefs: prefs)
        return JourneyEndpoint(
            tone: .start,
            labelKey: "driveDetail.start",
            labelFallback: "Start",
            primaryText: location.text,
            isCoordinate: location.isCoordinate,
            timestampText: JourneyDetailsFormat.dateTime(drive.startTimestamp, prefs: prefs),
            batteryValue: JourneyDetailsFormat.battery(drive.startBatteryPercent)
        )
    }

    /// Web: `startAddress ? startAddress : (startLat && startLon ? coords : noAddress)`.
    private static func startLocation(
        drive: JourneyDriveDTO,
        prefs: JourneyFormatPrefs
    ) -> (text: String, isCoordinate: Bool) {
        if let address = drive.startAddress, !address.isEmpty {
            return (address, false)
        }
        if let coordinate = coordinate(latitude: drive.startLatitude, longitude: drive.startLongitude, prefs: prefs) {
            return (coordinate, true)
        }
        return (JourneyDetailsStrings.string("driveDetail.noAddress", "No address data"), false)
    }

    // MARK: Destination (web second column)

    private static func destinationEndpoint(
        drive: JourneyDriveDTO,
        prefs: JourneyFormatPrefs
    ) -> JourneyEndpoint {
        let location = destinationLocation(drive: drive, prefs: prefs)
        let timestamp = drive.endTimestamp != nil
            ? JourneyDetailsFormat.dateTime(drive.endTimestamp, prefs: prefs)
            : JourneyDetailsStrings.string("driveDetail.inProgress", "In progress")
        return JourneyEndpoint(
            tone: .destination,
            labelKey: "driveDetail.destination",
            labelFallback: "Destination",
            primaryText: location.text,
            isCoordinate: location.isCoordinate,
            timestampText: timestamp,
            batteryValue: JourneyDetailsFormat.battery(drive.endBatteryPercent)
        )
    }

    /// Web: `endAddress ? endAddress : (endLat && endLon ? coords : (endTs ? noAddress : inProgress))`.
    private static func destinationLocation(
        drive: JourneyDriveDTO,
        prefs: JourneyFormatPrefs
    ) -> (text: String, isCoordinate: Bool) {
        if let address = drive.endAddress, !address.isEmpty {
            return (address, false)
        }
        if let coordinate = coordinate(latitude: drive.endLatitude, longitude: drive.endLongitude, prefs: prefs) {
            return (coordinate, true)
        }
        if drive.endTimestamp != nil {
            return (JourneyDetailsStrings.string("driveDetail.noAddress", "No address data"), false)
        }
        return (JourneyDetailsStrings.string("driveDetail.inProgress", "In progress"), false)
    }

    // MARK: Coordinate (shared JS truthiness guard)

    /// Reproduces the web `lat && lon` truthiness guard: a coordinate is produced only when BOTH
    /// values are present AND non-zero (a `null` or `0` is falsy in JS and short-circuits to the
    /// address fallback). Returns `nil` when the guard fails.
    private static func coordinate(
        latitude: Double?,
        longitude: Double?,
        prefs: JourneyFormatPrefs
    ) -> String? {
        guard let latitude, let longitude, latitude != 0, longitude != 0 else { return nil }
        return JourneyDetailsFormat.coordinate(latitude: latitude, longitude: longitude, prefs: prefs)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for one endpoint column. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum JourneyDetailsAccessibility {
    /// One column read as one phrase: "Start: Home. Apr 4, 2026 at 2:30 PM. Battery 82%".
    public static func summary(for endpoint: JourneyEndpoint) -> String {
        let label = JourneyDetailsStrings.string(endpoint.labelKey, endpoint.labelFallback)
        let battery = JourneyDetailsStrings.string("driveDetail.battery", "Battery")
        return "\(label): \(endpoint.primaryText). \(endpoint.timestampText). \(battery) \(endpoint.batteryValue)%"
    }
}
