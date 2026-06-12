//
//  UptimeHeatmap.Adapter.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  The testable, dependency-light core for the rolling N-day status grid — the SwiftUI parity of
//  components/status/UptimeHeatmap.tsx. This file is the Foundation-only heart of the native peer: the
//  surface identity (the diagnostics slug), the status axis (``UptimeStatus`` — the native peer of the
//  web `HeroStatus` union), the per-day value type (``UptimeDay``), the structural props value type
//  (``UptimeHeatmapInputs``), the i18n resolver shape, and the pure percent formatter (the port of the
//  web `fmtPercent`). No SwiftUI, no @Observable — so every rule is unit testable in isolation.
//
//  Faithful-parity note: the web `UptimeHeatmap` is a PURE presentational component. It takes its data
//  as plain props (`days`, optional `title`, optional `footnote`) and renders — there is no fetch, no
//  React-Query cache, and no Promise — so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to). Inventing such chrome would fabricate states
//  the source does not have, so this surface reproduces ONLY the source's REAL branches, exactly as the
//  sibling presentational status primitive HealthRow (0197) and the props-driven ActiveFilterChips
//  (0147) did. The real branches are:
//    • data  — one square per day (oldest-first), each tinted by its status, with a tap popover
//              (date · status label · optional summary) and a tier-coloured uptime % caption.
//    • empty — zero days (web `days.length === 0` → `uptimePct = null`, an empty grid): the heading +
//              footnote still render, and the grid region shows a friendly empty state (the native HIG
//              improvement over a bare empty box).
//    • per-square — the five statuses (healthy / degraded / unhealthy / unknown / maintenance) and the
//              summary present / absent variants; plus the title override vs. the default heading.
//
//  Dropped web-only props: `className` (Tailwind) and `id` (DOM anchor / IntersectionObserver target)
//  have no native peer and are intentionally omitted.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum UptimeHeatmapSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "UptimeHeatmap"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias UptimeHeatmapResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - UptimeStatus (web `HeroStatus` union)

/// One day's health status — the native peer of the web `HeroStatus`
/// (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`) imported from `StatusHero`. It
/// drives the square's fill colour (web `SQUARE_BG`) and the popover's status label (web
/// `STATUS_LABEL`), and decides whether the day counts towards uptime (web: `healthy` OR `maintenance`).
/// Mapped to the shared, theme-aware semantic tone tokens (P1/S9) in UptimeHeatmap.Views.swift, so each
/// status recolours across light / dark / high-contrast rather than the web's fixed `*-400` hues.
public enum UptimeStatus: String, Sendable, Equatable, CaseIterable {
    /// Operational — counts towards uptime (web `healthy` → green square, "Operational").
    case healthy
    /// Degraded performance (web `degraded` → amber square, "Degraded").
    case degraded
    /// Service outage (web `unhealthy` → red square, "Outage").
    case unhealthy
    /// Status unknown (web `unknown` → zinc square, "Unknown").
    case unknown
    /// Scheduled maintenance — counts towards uptime (web `maintenance` → blue square, "Maintenance").
    case maintenance

    /// Whether the day counts as "up" for the uptime % (web `status === 'healthy' || === 'maintenance'`).
    public var countsTowardUptime: Bool {
        self == .healthy || self == .maintenance
    }
}

// MARK: - UptimeDay (web `UptimeDay`)

/// One day in the rolling window — the native peer of the web `UptimeDay` (`date`, `status`, optional
/// `summary`). `date` is the caller-supplied ISO `yyyy-mm-dd` string (rendered verbatim, like the web,
/// in the popover + the accessibility label); `summary` is the optional short description the popover
/// shows beneath the status label (web `day.summary`).
public struct UptimeDay: Sendable, Equatable, Identifiable {
    /// ISO date (`yyyy-mm-dd`) — the web `key={day.date}` and the popover / a11y date run.
    public let date: String
    /// The day's health status (web `day.status`).
    public let status: UptimeStatus
    /// Optional short description shown inside the popover (web `day.summary`).
    public let summary: String?

    /// Stable identity for the web `key={day.date}`. The grid iterates the index-keyed
    /// ``UptimeSquare`` so a (rare) duplicate date never collides at render time.
    public var id: String {
        date
    }

    public init(date: String, status: UptimeStatus, summary: String? = nil) {
        self.date = date
        self.status = status
        self.summary = summary
    }
}

// MARK: - UptimeHeatmapInputs (web props, closure-free)

/// The component's props — the native peer of `UptimeHeatmapProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a
/// prop change cheaply when the page rebinds a fresh window. `title` overrides the default heading (web
/// `title`); `footnote` is the optional line beneath the squares (web `footnote`).
public struct UptimeHeatmapInputs: Sendable, Equatable {
    /// The ordered days, oldest-first (web `days`).
    public let days: [UptimeDay]
    /// Optional heading override (web `title`); the default heading is composed from the day count.
    public let title: String?
    /// Optional footnote shown beneath the squares (web `footnote`).
    public let footnote: String?

    public init(days: [UptimeDay], title: String? = nil, footnote: String? = nil) {
        self.days = days
        self.title = title
        self.footnote = footnote
    }
}

// MARK: - UptimeHeatmapFormat (web `fmtPercent`)

/// The surface's pure number formatting — the port of the web `fmtPercent(value, 2)` used for the
/// uptime caption. `fmtPercent` is `fmtNumber(value, decimals) + '%'`, and `fmtNumber` runs the value
/// through `safeNumber` (non-finite → 0) before fixing the fraction digits. The uptime % is bounded to
/// `0…100`, so the web's locale grouping never engages; a fixed-fraction decimal string is exact parity
/// and stays deterministic for the unit tests (independent of device locale).
public enum UptimeHeatmapFormat {
    /// Web `fmtPercent(value, decimals)` → e.g. `99.50%`. Clamps non-finite input to `0` (web
    /// `safeNumber`) and pins exactly `decimals` fraction digits (web `min/maxFractionDigits`).
    public static func percent(_ value: Double, decimals: Int = 2) -> String {
        let safe = value.isFinite ? value : 0
        let places = max(0, decimals)
        return String(format: "%.\(places)f%%", safe)
    }
}
