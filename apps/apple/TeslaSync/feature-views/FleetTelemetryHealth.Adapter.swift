//
//  FleetTelemetryHealth.Adapter.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  The testable projection core: cached `FleetTelemetryError*Input` DTOs → the
//  view-ready `FleetVINRow` / `FleetTelemetryHealthErrorRow` rows. Reproduces the web `isRecent`
//  (< 24h) recency rule and its timestamp emphasis (web rose/amber/secondary), the
//  `vinList.length > 0 ? danger : success` badge tone, the em-dash fallback for an
//  absent error code/message, the per-section render-phase resolution, the absolute/
//  relative time formatters, and the VoiceOver row summaries. All pure + dependency-
//  free so the adapter can be unit-tested without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Render phase (web shell loading / content / empty branches)

/// The mutually-exclusive render branches a section switches over, mirroring the web
/// `isLoading` skeleton / resolved rows / "No …" empty state. Each of the surface's two
/// sections (Error VINs, Error Log) resolves its own phase.
public enum FleetHealthPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Timestamp emphasis (web rose / amber / secondary)

/// The color emphasis a timestamp carries, mapped to a status token at render time.
/// Mirrors the web classes: recent → rose (danger), aged → amber (warning, VIN last-
/// seen), normal → secondary text (first-seen + non-recent reported-at).
public enum FleetHealthTimeEmphasis: Sendable, Equatable {
    case recent
    case aged
    case normal
}

// MARK: - Row projections (web DataTable rows)

/// One Error-VINs row (web `FleetTelemetryErrorVIN`): the VIN plus its first/last-seen
/// timestamps and the last-seen emphasis (web `isRecent ? rose : amber`).
public struct FleetVINRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let vin: String
    public let firstSeen: Date?
    public let lastSeen: Date?
    public let lastSeenEmphasis: FleetHealthTimeEmphasis

    public init(
        id: String,
        vin: String,
        firstSeen: Date?,
        lastSeen: Date?,
        lastSeenEmphasis: FleetHealthTimeEmphasis
    ) {
        self.id = id
        self.vin = vin
        self.firstSeen = firstSeen
        self.lastSeen = lastSeen
        self.lastSeenEmphasis = lastSeenEmphasis
    }
}

/// One Error-Log row (web `FleetTelemetryError`): VIN + optional code/message (nil →
/// em-dash in the view) + reported-at with its emphasis (web `isRecent ? rose : secondary`).
public struct FleetTelemetryHealthErrorRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let vin: String
    public let errorCode: String?
    public let errorMessage: String?
    public let reportedAt: Date?
    public let reportedAtEmphasis: FleetHealthTimeEmphasis

    public init(
        id: String,
        vin: String,
        errorCode: String?,
        errorMessage: String?,
        reportedAt: Date?,
        reportedAtEmphasis: FleetHealthTimeEmphasis
    ) {
        self.id = id
        self.vin = vin
        self.errorCode = errorCode
        self.errorMessage = errorMessage
        self.reportedAt = reportedAt
        self.reportedAtEmphasis = reportedAtEmphasis
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection + presentation rules shared by the model and the views. No store,
/// no bundle, no SwiftUI view — only value-typed inputs/outputs (plus `TSTone`).
public enum FleetHealthProjection {
    /// The em-dash the web renders for an absent code / message / timestamp.
    public static let emDash = "—"

    /// One day in seconds — the web `isRecent` window (`24 * 60 * 60 * 1000` ms).
    public static let recencyWindow: TimeInterval = 24 * 60 * 60

    /// Web `isRecent`: `Date.now() - date < 24h` (an absent date is never recent; a
    /// future date is treated as recent, matching the web's signed comparison).
    public static func isRecent(_ date: Date?, now: Date, window: TimeInterval = recencyWindow) -> Bool {
        guard let date else { return false }
        return now.timeIntervalSince(date) < window
    }

    /// Trims a raw optional string and folds empty → nil (web treats `''` as falsy, so
    /// an empty error code renders the em-dash rather than an empty badge).
    public static func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    /// Projects the cached error-VINs into view rows, preserving the source order (the
    /// web renders them in API order). `now` drives the last-seen recency emphasis.
    public static func vinRows(from inputs: [FleetTelemetryErrorVINInput], now: Date) -> [FleetVINRow] {
        inputs.map { input in
            FleetVINRow(
                id: input.vin,
                vin: input.vin,
                firstSeen: input.firstSeenAt,
                lastSeen: input.lastSeenAt,
                lastSeenEmphasis: isRecent(input.lastSeenAt, now: now) ? .recent : .aged
            )
        }
    }

    /// Projects the cached error records into view rows, preserving the source order.
    /// `now` drives the reported-at recency emphasis.
    public static func errorRows(from inputs: [FleetTelemetryErrorInput], now: Date) -> [FleetTelemetryHealthErrorRow] {
        inputs.map { input in
            FleetTelemetryHealthErrorRow(
                id: input.id,
                vin: input.vin,
                errorCode: normalized(input.errorCode),
                errorMessage: normalized(input.errorMessage),
                reportedAt: input.reportedAt,
                reportedAtEmphasis: isRecent(input.reportedAt, now: now) ? .recent : .normal
            )
        }
    }

    /// Resolves a section's render phase. The skeleton shows only on the initial fetch
    /// (no rows yet); cached rows stay visible behind a refresh/failure, with the
    /// freshness chip + banner reflecting staleness — mirroring the web shell.
    public static func resolvePhase(_ status: FleetHealthLoadStatus, hasRows: Bool) -> FleetHealthPhase {
        switch status {
        case .loading:
            hasRows ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasRows ? .content : .empty
        case let .failed(message):
            hasRows ? .content : .error(message)
        }
    }

    /// Web `variant={vinList.length > 0 ? 'danger' : 'success'}` for the affected badge.
    public static func vinBadgeTone(count: Int) -> TSTone {
        count > 0 ? .danger : .success
    }

    /// Maps a timestamp emphasis to its status color token.
    public static func color(for emphasis: FleetHealthTimeEmphasis) -> Color {
        switch emphasis {
        case .recent: Color.TS.statusDanger
        case .aged: Color.TS.statusWarning
        case .normal: Color.TS.textSecondary
        }
    }
}

// MARK: - Timestamp formatting (web `TimeStamp`)

/// Localized timestamp rendering for a cell (web `TimeStamp`): an absolute body with a
/// relative alternate for the accessibility hint. `nil`/absent → the em-dash sentinel.
public enum FleetHealthTimestamp {
    /// Absolute, locale-aware "Apr 4, 2:30 AM" body (web `formatDateTime`); em-dash when nil.
    public static func absolute(for date: Date?) -> String {
        guard let date else { return FleetHealthProjection.emDash }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Relative "2h ago" alternate (web `formatRelative`), delegated to the OS so it's
    /// localized without hardcoded English. `now` is injectable for deterministic tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the table rows. Pure + public so the spoken content
/// can be unit-tested without rendering. Labels resolve through the injected localizer
/// (bundle-free in tests); absent code/message segments are omitted (not read as "dash").
public enum FleetHealthAccessibility {
    public static func vinRowSummary(_ row: FleetVINRow, localize: (String, String) -> String) -> String {
        let first = FleetHealthTimestamp.absolute(for: row.firstSeen)
        let last = FleetHealthTimestamp.absolute(for: row.lastSeen)
        return [
            "\(localize("devtools.health.vin", "VIN")) \(row.vin)",
            "\(localize("devtools.health.firstSeen", "First Seen")) \(first)",
            "\(localize("devtools.health.lastSeen", "Last Seen")) \(last)"
        ].joined(separator: ", ")
    }

    public static func errorRowSummary(
        _ row: FleetTelemetryHealthErrorRow,
        localize: (String, String) -> String
    ) -> String {
        var parts = ["\(localize("devtools.health.vin", "VIN")) \(row.vin)"]
        if let code = row.errorCode {
            parts.append("\(localize("devtools.health.errorCode", "Error Code")) \(code)")
        }
        if let message = row.errorMessage {
            parts.append("\(localize("devtools.health.message", "Message")) \(message)")
        }
        let reported = FleetHealthTimestamp.absolute(for: row.reportedAt)
        parts.append("\(localize("devtools.health.reportedAt", "Reported At")) \(reported)")
        return parts.joined(separator: ", ")
    }
}
