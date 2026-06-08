//
//  DriveDetailHeader.Adapter.swift
//  TeslaSync — P4 feature view · 0137 · DriveDetailHeader (Apple)
//
//  The testable projection core: a `DriveHeaderDTO` + `DriveHeaderFormatPrefs` → the view-ready
//  `DriveHeaderProjection` (route-or-fallback title + the vehicle/timestamp subtitle), reproducing
//  the web source's render logic VERBATIM so the native masthead shows the exact same text as
//  features/driving/components/drive-detail/DriveDetailHeader.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + composition compile and run on
//  a plain host and are pinned by unit tests. The date/time helpers mirror web `lib/dateFormat.ts`
//  (`formatDate`, `formatTime`, `tzAbbreviation`) used by the web `<DateTime in="vehicle" showTz>`.
//

import Foundation

// MARK: - Date / time formatting (ported from web lib/dateFormat.ts via the `DateTime` component)

/// Locale + timezone-aware date/time formatting that mirrors the web `formatDate`
/// (`toLocaleDateString({ year:'numeric', month:'short', day:'numeric' })`), `formatTime`
/// (`toLocaleTimeString({ hour:'2-digit', minute:'2-digit' })`), and `tzAbbreviation`
/// (`Intl.DateTimeFormat({ timeZoneName:'short' })`). A `nil`/invalid date renders the web "—"
/// em-dash; a `nil` timezone uses the device's current zone (the web pure path).
public enum DriveDetailHeaderFormat {
    /// The web "no value" em-dash returned by `formatDate`/`formatTime` for null/invalid input.
    public static let emptyMarker = "—"

    private static func timeZone(_ prefs: DriveHeaderFormatPrefs) -> TimeZone {
        guard let identifier = prefs.timeZoneIdentifier, let zone = TimeZone(identifier: identifier) else {
            return .current
        }
        return zone
    }

    private static func formatter(_ prefs: DriveHeaderFormatPrefs, template: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: prefs.localeIdentifier)
        formatter.timeZone = timeZone(prefs)
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }

    /// `formatDate` — "Apr 4, 2026". Localized `year:numeric, month:short, day:numeric`.
    public static func date(_ date: Date?, prefs: DriveHeaderFormatPrefs) -> String {
        guard let date else { return emptyMarker }
        return formatter(prefs, template: "yMMMd").string(from: date)
    }

    /// `formatTime` — "2:30 PM" (12h) or "14:30" (24h), 2-digit hour + minute, chosen by the locale's
    /// hour convention (the web `{ hour:'2-digit', minute:'2-digit' }`).
    public static func time(_ date: Date?, prefs: DriveHeaderFormatPrefs) -> String {
        guard let date else { return emptyMarker }
        return formatter(prefs, template: "jjmm").string(from: date)
    }

    /// `tzAbbreviation` — the short zone name ("PST", "GMT+1") the web appends after the start time
    /// when `showTz` is set. Returns `nil` when no vehicle timezone is resolved (the web pure path
    /// renders no abbreviation) or the date is missing.
    public static func timeZoneAbbreviation(_ date: Date?, prefs: DriveHeaderFormatPrefs) -> String? {
        guard date != nil, let identifier = prefs.timeZoneIdentifier, let zone = TimeZone(identifier: identifier)
        else {
            return nil
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: prefs.localeIdentifier)
        formatter.timeZone = zone
        formatter.dateFormat = "zzz"
        let abbreviation = formatter.string(from: date ?? Date())
        return abbreviation.isEmpty ? nil : abbreviation
    }
}

// MARK: - Projected masthead (web `DriveDetailHeader` render)

/// The fully-projected masthead content: the resolved title (the "start → end" route when both
/// addresses are present, else `nil` so the view renders the localized "Drive Details" fallback) plus
/// the composed `vehicleName · date · time tz [→ endTime]` subtitle and the pieces that build it (kept
/// individually so the view + the accessibility summary can read them without re-parsing).
public struct DriveHeaderProjection: Equatable, Sendable {
    /// The drive identifier the Replay action routes to (`/drives/{id}/replay`).
    public let driveID: String
    /// "start → end" when both addresses are present; `nil` → the view shows the localized fallback.
    public let routeTitle: String?
    public let vehicleName: String
    public let dateText: String
    public let startTimeText: String
    public let timeZoneAbbreviation: String?
    /// The end time, present only when the drive has finished (web `drive.endTs && …`).
    public let endTimeText: String?

    public init(
        driveID: String,
        routeTitle: String?,
        vehicleName: String,
        dateText: String,
        startTimeText: String,
        timeZoneAbbreviation: String?,
        endTimeText: String?
    ) {
        self.driveID = driveID
        self.routeTitle = routeTitle
        self.vehicleName = vehicleName
        self.dateText = dateText
        self.startTimeText = startTimeText
        self.timeZoneAbbreviation = timeZoneAbbreviation
        self.endTimeText = endTimeText
    }

    /// `true` when the masthead shows the localized "Drive Details" fallback because the drive has no
    /// start/end address pair (the web `!(startAddress && endAddress)` branch).
    public var usesFallbackTitle: Bool {
        routeTitle == nil
    }

    /// The resolved title for display + accessibility: the route when present, else the localized
    /// "Drive Details" fallback resolved through the P1/S10 facade.
    public var resolvedTitle: String {
        routeTitle ?? DriveDetailHeaderStrings.string("driveDetail.title", "Drive Details")
    }

    /// The composed subtitle, byte-for-byte the web run: `vehicleName · date · startTime tz [→ endTime]`.
    /// The timezone abbreviation follows the start time (the web `showTz` span); the end-time segment
    /// is appended only for a finished drive.
    public var subtitle: String {
        var parts = "\(vehicleName) · \(dateText) · \(startTimeText)"
        if let abbreviation = timeZoneAbbreviation, !abbreviation.isEmpty {
            parts += " \(abbreviation)"
        }
        if let endTimeText {
            parts += " → \(endTimeText)"
        }
        return parts
    }
}

/// Pure projector: `DriveHeaderDTO` + `DriveHeaderFormatPrefs` → `DriveHeaderProjection`. Every value
/// is computed with the same address/timestamp logic + formatting as the web component so the web and
/// native mastheads show identical text side by side.
public enum DriveDetailHeaderProjector {
    public static func project(drive: DriveHeaderDTO, prefs: DriveHeaderFormatPrefs) -> DriveHeaderProjection {
        DriveHeaderProjection(
            driveID: drive.driveID,
            routeTitle: routeTitle(start: drive.startAddress, end: drive.endAddress),
            vehicleName: drive.vehicleName,
            dateText: DriveDetailHeaderFormat.date(drive.startTs, prefs: prefs),
            startTimeText: DriveDetailHeaderFormat.time(drive.startTs, prefs: prefs),
            timeZoneAbbreviation: DriveDetailHeaderFormat.timeZoneAbbreviation(drive.startTs, prefs: prefs),
            endTimeText: drive.endTs.map { DriveDetailHeaderFormat.time($0, prefs: prefs) }
        )
    }

    /// The web title condition: `startAddress && endAddress ? "start → end" : fallback`. A missing or
    /// empty string is falsy in JS, so both addresses must be non-empty for the route title to show.
    private static func routeTitle(start: String?, end: String?) -> String? {
        guard let start, !start.isEmpty, let end, !end.isEmpty else { return nil }
        return "\(start) → \(end)"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the masthead header element. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum DriveDetailHeaderAccessibility {
    /// The header read as one phrase: the resolved title followed by the subtitle, e.g.
    /// "Home → Office. Model 3 · Apr 4, 2026 · 2:30 PM PST → 3:10 PM".
    public static func summary(for projection: DriveHeaderProjection) -> String {
        "\(projection.resolvedTitle). \(projection.subtitle)"
    }
}
