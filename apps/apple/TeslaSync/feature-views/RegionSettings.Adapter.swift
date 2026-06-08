//
//  RegionSettings.Adapter.swift
//  TeslaSync — P4 feature view · 0211 · RegionSettings (Apple)
//
//  The testable projection core for the Region & API settings panel — the SwiftUI
//  parity of features/settings/components/RegionSettings.tsx plus the web helper it
//  is fed by: `formatDateTime` (lib/dateFormat.ts). Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the region-config
//  model, the "Synced …" timestamp wording, the em-dash fallback for a missing
//  Fleet API URL, and the VoiceOver summaries are all unit tested in isolation.
//
//  Parity note: the web panel reads `regionConfig.data.region` and
//  `regionConfig.data.fleet_api_base_url` from the `TeslaConfigEnvelope<TeslaRegionData>`
//  query (api/hooks/useUser.ts) and renders the envelope's `fetched_at` through
//  `formatDateTime`. The URL falls back to `'—'`. This core reproduces that
//  shaping verbatim; the values are read SI-free strings from the API, so no unit
//  conversion applies at this layer.
//

import Foundation

// MARK: - Region record (web `TeslaConfigEnvelope<TeslaRegionData>` from useUser.ts)

/// One resolved region-config snapshot — the native mirror of the web
/// `TeslaConfigEnvelope<TeslaRegionData>`. `region` and `fleetAPIBaseURL` are the
/// envelope's `data.region` / `data.fleet_api_base_url`; `fetchedAt` is the
/// envelope's `fetched_at` parsed to a `Date` (nil when the API has never synced).
public struct RegionRecord: Equatable, Sendable {
    public var region: String?
    public var fleetAPIBaseURL: String?
    public var fetchedAt: Date?

    public init(region: String? = nil, fleetAPIBaseURL: String? = nil, fetchedAt: Date? = nil) {
        self.region = region
        self.fleetAPIBaseURL = fleetAPIBaseURL
        self.fetchedAt = fetchedAt
    }
}

// MARK: - Formatting (ports of dateFormat.ts + the web `?? '—'` fallback)

/// Pure string shaping ported from the web source so the timestamp wording, the
/// trimming, and the em-dash fallback match exactly. Locale + time zone are
/// injectable so the rendered output is deterministic under test.
public enum RegionFormat {
    /// The em-dash sentinel the web renders for a missing Fleet API URL (`?? '—'`).
    public static let dash = "—"

    /// Native port of `formatDateTime` (dateFormat.ts): a nil date yields the
    /// em-dash; otherwise a locale-aware "abbreviated month, day, year, time"
    /// string (the web `toLocaleString` template `yMMMdjmm`).
    public static func dateTime(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }

    /// The region code, trimmed (web reads `data.region` directly). An empty or
    /// whitespace-only value is treated as "no region" by the projection.
    public static func region(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The Fleet API base URL, trimmed, with the web `?? '—'` fallback for a
    /// missing/blank value.
    public static func fleetURL(_ value: String?) -> String {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? dash : trimmed
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the panel's info cells and the "Synced …"
/// caption from already-localised parts, so the spoken content is asserted
/// without rendering the view.
public enum RegionAccessibility {
    /// The per-cell spoken label: "{label}, {value}".
    public static func infoLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }

    /// The header timestamp spoken label: "{prefix}, {timestamp}".
    public static func syncedLabel(prefix: String, timestamp: String) -> String {
        "\(prefix), \(timestamp)"
    }
}
