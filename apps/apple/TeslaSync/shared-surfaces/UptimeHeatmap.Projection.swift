//
//  UptimeHeatmap.Projection.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  The pure projection from the structural props to the view-ready model the SwiftUI body renders —
//  the native port of the web `UptimeHeatmap` render body. The web component collapses its props into a
//  fixed set of layout decisions: the overall uptime % across the window (web `useMemo`:
//  `healthyCount / days.length * 100`, or `null` when empty), the tier that colours that caption (web
//  `>= 99 ? green : >= 95 ? amber : red`), the per-day squares (oldest-first), whether the window is
//  empty, and the optional footnote. This projection bakes every one of those decisions into an
//  ``UptimeHeatmapProjection`` the view consumes as a pure function; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``UptimeHeatmapProjector/resolve(inputs:)`` takes the cached props (the day window a caller already
//  holds) and derives the rendered layout decisions — no networking, no clock, no SwiftUI. The localized
//  heading / caption / status labels are composed in the @Observable model (UptimeHeatmap.Model.swift),
//  which owns the i18n facade, so this projection stays prose-free and pure.
//

import Foundation

// MARK: - UptimeTier (web caption colour thresholds)

/// The uptime caption's colour tier — the native peer of the web ternary
/// `uptimePct >= 99 ? green : uptimePct >= 95 ? amber : red`. Mapped to the shared semantic tone tokens
/// (P1/S9) in UptimeHeatmap.Views.swift, so the caption recolours across themes rather than using the
/// web's fixed `text-green/amber/red-400` hues.
public enum UptimeTier: String, Sendable, Equatable, CaseIterable {
    /// `>= 99%` — green (web `text-green-400`).
    case high
    /// `>= 95%` and `< 99%` — amber (web `text-amber-400`).
    case medium
    /// `< 95%` — red (web `text-red-400`).
    case low

    /// Classifies a percentage into the web's three caption tiers.
    public init(percent: Double) {
        if percent >= 99 {
            self = .high
        } else if percent >= 95 {
            self = .medium
        } else {
            self = .low
        }
    }
}

// MARK: - UptimeSquare (one rendered day)

/// One rendered square — the view-ready, index-keyed projection of an ``UptimeDay``. `id` is the day's
/// position in the window (oldest = 0), which keys the SwiftUI `ForEach` so a duplicate `date` never
/// collides (the web keys by `date`; the index is the safe native equivalent). `date` + `status` +
/// `summary` pass through for the square fill, the tap popover, and the accessibility label.
public struct UptimeSquare: Sendable, Equatable, Identifiable {
    /// The day's position in the window, oldest-first (the `ForEach` key).
    public let id: Int
    /// ISO date (`yyyy-mm-dd`) shown verbatim in the popover + a11y label (web `day.date`).
    public let date: String
    /// The day's status driving the fill colour + the popover label (web `day.status`).
    public let status: UptimeStatus
    /// Optional summary shown in the popover beneath the status label (web `day.summary`).
    public let summary: String?

    public init(id: Int, date: String, status: UptimeStatus, summary: String?) {
        self.id = id
        self.date = date
        self.status = status
        self.summary = summary
    }
}

// MARK: - UptimeHeatmapProjection (web render output)

/// The resolved, view-ready layout decisions — the native bundle of everything the web `UptimeHeatmap`
/// render body decides from its props. The view is a pure function of this value: it shows the friendly
/// empty state iff `isEmpty`, renders one square per `squares` entry, shows the uptime caption iff
/// `uptimePercentText != nil` (tinted by `tier`), and shows the footnote iff `footnote != nil`.
public struct UptimeHeatmapProjection: Sendable, Equatable {
    /// The number of days in the window (web `days.length`), used for the default heading.
    public let dayCount: Int
    /// The caller's heading override (web `title`); `nil` falls back to the composed default heading.
    public let titleOverride: String?
    /// Whether the window has no days (web `days.length === 0` → the empty grid + `null` uptime).
    public let isEmpty: Bool
    /// The overall uptime percentage across the window (web `uptimePct`); `nil` when empty.
    public let uptimePercent: Double?
    /// The pre-formatted uptime percentage (web `fmtPercent(uptimePct, 2)`); `nil` when empty.
    public let uptimePercentText: String?
    /// The caption colour tier (web caption ternary); `nil` when empty (no caption renders).
    public let tier: UptimeTier?
    /// The rendered squares, oldest-first (web `days.map`).
    public let squares: [UptimeSquare]
    /// The optional footnote beneath the squares (web `footnote`).
    public let footnote: String?

    public init(
        dayCount: Int,
        titleOverride: String?,
        isEmpty: Bool,
        uptimePercent: Double?,
        uptimePercentText: String?,
        tier: UptimeTier?,
        squares: [UptimeSquare],
        footnote: String?
    ) {
        self.dayCount = dayCount
        self.titleOverride = titleOverride
        self.isEmpty = isEmpty
        self.uptimePercent = uptimePercent
        self.uptimePercentText = uptimePercentText
        self.tier = tier
        self.squares = squares
        self.footnote = footnote
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection to the view-ready layout decisions — the verbatim port of the web `UptimeHeatmap`
/// render body. Kept as a pure function over the caller-owned props so every branch (empty vs.
/// populated, the uptime arithmetic, the tier thresholds, the per-day square mapping, the footnote) is
/// unit tested without an @Observable model or a view.
public enum UptimeHeatmapProjector {
    /// Resolves the layout decisions exactly like the web component:
    ///   • `uptimePercent` = `(count(healthy || maintenance) / days.length) * 100`, or `nil` when the
    ///     window is empty (web `days.length === 0 ? null : …`).
    ///   • `uptimePercentText` = `fmtPercent(uptimePercent, 2)` (web caption number), `nil` when empty.
    ///   • `tier` classifies the percentage into the web caption's green / amber / red bands; `nil`
    ///     when empty.
    ///   • `squares` map each day (oldest-first) to an index-keyed ``UptimeSquare`` (web `days.map`).
    ///   • `titleOverride` / `footnote` pass through (the heading default + the footnote line).
    public static func resolve(inputs: UptimeHeatmapInputs) -> UptimeHeatmapProjection {
        let days = inputs.days
        let dayCount = days.count
        let isEmpty = days.isEmpty

        let percent: Double? = isEmpty ? nil : uptimePercent(for: days)
        let percentText = percent.map { UptimeHeatmapFormat.percent($0, decimals: 2) }
        let tier = percent.map(UptimeTier.init(percent:))

        let squares = days.enumerated().map { index, day in
            UptimeSquare(id: index, date: day.date, status: day.status, summary: day.summary)
        }

        return UptimeHeatmapProjection(
            dayCount: dayCount,
            titleOverride: inputs.title,
            isEmpty: isEmpty,
            uptimePercent: percent,
            uptimePercentText: percentText,
            tier: tier,
            squares: squares,
            footnote: inputs.footnote
        )
    }

    /// The overall uptime % across a non-empty window — web
    /// `days.filter(d => d.status === 'healthy' || === 'maintenance').length / days.length * 100`.
    /// Callers guarantee a non-empty window (the empty case projects `nil`).
    public static func uptimePercent(for days: [UptimeDay]) -> Double {
        guard !days.isEmpty else { return 0 }
        let up = days.reduce(into: 0) { total, day in
            if day.status.countsTowardUptime { total += 1 }
        }
        return Double(up) / Double(days.count) * 100
    }
}
