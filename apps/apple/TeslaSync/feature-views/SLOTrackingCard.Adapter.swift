//
//  SLOTrackingCard.Adapter.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The testable transport + identity core for the personal "Uptime & SLO" surface
//  — the faithful port of features/system/components/status/SLOTrackingCard.tsx.
//  Everything here is pure and dependency-free (Foundation only) so it can be
//  unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web card reads ONE interval-refetched query — `request('/status/uptime?
//      window=…')` keyed on the selected window (`useQuery(['status-uptime', win])`,
//      refetch 60s). The native source seam (P1/S8) hands this adapter the same
//      shape via `UptimeWindowDTO`, and the projections derive the percentage tone,
//      the "healthy / total components" subtitle, the snapshot caveat, and the
//      render phase from it.
//    • The window union `'24h' | '7d' | '30d' | '90d' | '1y'` + its `WINDOW_LABEL`
//      record become `SLOWindow`, carrying the exact API query value, the short tab
//      token (web `{w}`), and the long label (web `WINDOW_LABEL[win]`).
//    • The personal target (web `localStorage` `teslasync.status.slo.target`,
//      default 99, clamped `0 < n ≤ 100`) is owned by the `SLOTargetStore` seam in
//      `.Model`; the clamp/parse rules live in `.Projection` so they are testable.
//

import Foundation

// MARK: - Shared display constants

/// Display helpers shared by the projections.
public enum SLOTrackingDisplay {
    /// The universal em-dash fallback the web renders for a missing percentage or
    /// component tally (web `pct == null ? '—'` / `?? '—'`).
    public static let emDash = "—"
}

// MARK: - Window selection (web `Window` union + `WINDOW_LABEL`)

/// The uptime window the card is showing — the native parity of the web
/// `type Window = '24h' | '7d' | '30d' | '90d' | '1y'`. Each case carries the
/// exact API query value (web `?window=${win}`), the short tab token the selector
/// renders (web `{w}`), and the long descriptive label (web `WINDOW_LABEL[win]`).
public enum SLOWindow: String, Sendable, Equatable, CaseIterable, Identifiable {
    case h24
    case d7
    case d30
    case d90
    case y1

    public var id: String {
        rawValue
    }

    /// The API query value sent as `?window=…` (web union literal). This is the
    /// short token too — the web tab renders the union value verbatim (`{w}`).
    public var apiValue: String {
        switch self {
        case .h24: "24h"
        case .d7: "7d"
        case .d30: "30d"
        case .d90: "90d"
        case .y1: "1y"
        }
    }

    /// The short selector-tab label key (web `{w}`), e.g. "24h". The token is
    /// locale-invariant, so the key IS the fallback.
    public var shortLabelKey: String {
        apiValue
    }

    /// The long descriptive label key (web `WINDOW_LABEL[win]`), the English value
    /// being the key per the surface's "label is the key" i18n convention.
    public var longLabelKey: String {
        switch self {
        case .h24: "Last 24 hours"
        case .d7: "Last 7 days"
        case .d30: "Last 30 days"
        case .d90: "Last 90 days"
        case .y1: "Last year"
        }
    }

    /// Resolves a `SLOWindow` from an API value (e.g. a snapshot's `window` field),
    /// returning `nil` for anything outside the known set.
    public static func from(apiValue: String) -> SLOWindow? {
        allCases.first { $0.apiValue == apiValue }
    }
}

// MARK: - Transport DTO (the P1/S8 source seam input)

/// One uptime-window snapshot as handed to the surface by its bound source — the
/// native parity of the web `UptimeWindow` interface (snake_case JSON → here). The
/// `historicalSource` discriminator drives the "current snapshot" caveat exactly
/// like the web `data.historical_source !== 'series'` guard.
public struct UptimeWindowDTO: Sendable, Equatable {
    /// The window the figure is for (web `window`), e.g. "30d".
    public var window: String
    /// The uptime percentage for the window (web `uptime_percent`), 0…100.
    public var uptimePercent: Double
    /// Healthy component count at the snapshot (web `healthy_count`).
    public var healthyCount: Int
    /// Total component count at the snapshot (web `total_count`).
    public var totalCount: Int
    /// When the figure was generated (web `generated_at`, ISO-8601).
    public var generatedAt: String
    /// How the figure was derived (web `historical_source`) — `"series"` means a
    /// true per-window line; anything else means a current-snapshot caveat.
    public var historicalSource: String
    /// An optional source-provided caveat note (web `note`), shown in place of the
    /// default caveat copy when present.
    public var note: String?

    public init(
        window: String,
        uptimePercent: Double,
        healthyCount: Int,
        totalCount: Int,
        generatedAt: String = "",
        historicalSource: String = "series",
        note: String? = nil
    ) {
        self.window = window
        self.uptimePercent = uptimePercent
        self.healthyCount = healthyCount
        self.totalCount = totalCount
        self.generatedAt = generatedAt
        self.historicalSource = historicalSource
        self.note = note
    }

    /// Whether the figure is a real per-window series (web `historical_source ===
    /// 'series'`). When `false`, the surface shows the snapshot caveat.
    public var isSeries: Bool {
        historicalSource == "series"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SLOTrackingSurface {
    public static let slug = "SLOTrackingCard"
}
