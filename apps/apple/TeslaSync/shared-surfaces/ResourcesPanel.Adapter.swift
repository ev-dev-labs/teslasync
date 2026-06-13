//
//  ResourcesPanel.Adapter.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  The testable, dependency-light core for the server-resources at-a-glance panel — the SwiftUI parity
//  of components/status/ResourcesPanel.tsx. This file is the Foundation-only heart of the native peer:
//  the surface identity (the diagnostics slug), the severity axis (``ResourceSeverity`` — the web `%`
//  threshold classifier), and the two Equatable structural-prop value types (``ResourceRowInputs`` and
//  ``ResourcesPanelInputs``). No SwiftUI, no @Observable — so every rule is unit testable in isolation.
//
//  Faithful-parity note: the web `ResourcesPanel` is a PURE presentational primitive. It binds NO data
//  hook at all (not even `useTranslation`); it takes a `rows` array — each row a label, a value string,
//  an optional sub-label, an optional `percent`, and an optional icon node — plus an optional footnote,
//  and renders an icon + label + value row with an optional severity-coloured usage bar. It therefore
//  has NO loading / error / stale / offline branch — there is nothing to load, fail, go stale, or lose
//  connectivity to. Inventing such chrome would fabricate states the source does not have (and
//  contradict the web spec), so this surface reproduces ONLY the source's REAL branches — exactly as the
//  sibling presentational primitive HealthRow (0197) did. The real, prop-driven branches are:
//    • severity — normal / warn / critical, derived from `percent` (web warn ≥ 70 %, critical ≥ 90 %),
//      which recolours the usage bar and the value text.
//    • usage bar present / absent (web `percent != null`).
//    • icon present / absent, sub-label (meta) present / absent.
//    • the panel itself: rows present vs an empty `rows` array, footnote present / absent.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `ResourcesPanel`; this surface keeps the same slug here (SwiftUI-free) so
/// the state-holder can emit telemetry without depending on the view layer.
public enum ResourcesPanelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ResourcesPanel"
}

// MARK: - ResourceSeverity (web `% threshold` classifier)

/// The per-row severity — the native peer of the web `ResourceRowItem` severity ternary
/// (`percent == null ? 'normal' : percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'normal'`).
/// It drives BOTH the usage bar's fill colour and the value text's colour (mapped to the shared,
/// theme-aware semantic tone tokens in ResourcesPanel.Views.swift, so it recolours across
/// light / dark / high-contrast rather than the web's fixed `*-400` hues).
public enum ResourceSeverity: String, Sendable, Equatable, CaseIterable {
    /// Below the warn threshold — or no `percent` at all (web `'normal'` → green bar / primary text).
    case normal
    /// At or above the warn threshold but below critical (web `'warn'` → amber bar + text).
    case warn
    /// At or above the critical threshold (web `'critical'` → red bar + text).
    case critical

    /// The web warn threshold — `percent >= 70` recolours to amber.
    public static let warnThreshold = 70.0
    /// The web critical threshold — `percent >= 90` recolours to red.
    public static let criticalThreshold = 90.0

    /// Classifies a `percent` exactly like the web `ResourceRowItem`: a missing `percent` (web `null`,
    /// i.e. a row with no bar) is `normal`; otherwise `>= 90` is `critical`, `>= 70` is `warn`, and
    /// anything below is `normal`. Kept pure (no clamping — the raw value decides) so the classifier is
    /// the verbatim port of the source's ternary.
    public static func classify(percent: Double?) -> ResourceSeverity {
        guard let percent else { return .normal }
        if percent >= criticalThreshold { return .critical }
        if percent >= warnThreshold { return .warn }
        return .normal
    }
}

// MARK: - ResourceRowInputs (the Equatable structural props of one row)

/// The structural props one resource row renders from — the Equatable, Sendable subset of the web
/// `ResourceRow`. It deliberately excludes the icon view (a `ReactNode` slot, not Equatable / Sendable);
/// that lives on the view and is passed straight to the content view. What stays here is everything the
/// pure projection + the `.onChange` reuse-guard need: the label, the value string, the optional
/// sub-label, the optional `percent`, and the icon-presence flag. A reused row that swaps any of these
/// re-derives its layout because these values change.
public struct ResourceRowInputs: Sendable, Equatable, Identifiable {
    /// Stable identity for `ForEach` — the web `key={row.label}`; defaults to the label.
    public let id: String
    /// The left-aligned row label, e.g. "Memory" (web `label`).
    public let label: String
    /// The right-aligned formatted value, e.g. "1.8 GB" (web `valueText`).
    public let valueText: String
    /// The optional sub-label rendered after the value, e.g. "of 8 GB" (web `metaText`).
    public let metaText: String?
    /// The optional 0–100 usage percent driving the bar + severity (web `percent`); `nil` → no bar.
    public let percent: Double?
    /// Whether the decorative leading icon is present (web `icon != null`).
    public let hasIcon: Bool

    public init(
        id: String? = nil,
        label: String,
        valueText: String,
        metaText: String? = nil,
        percent: Double? = nil,
        hasIcon: Bool = false
    ) {
        self.id = id ?? label
        self.label = label
        self.valueText = valueText
        self.metaText = metaText
        self.percent = percent
        self.hasIcon = hasIcon
    }
}

// MARK: - ResourcesPanelInputs (the Equatable structural props of the panel)

/// The structural props the whole panel renders from — the Equatable, Sendable subset of the web
/// `ResourcesPanelProps`. It carries the row inputs (the icon views live on the view, paired back by
/// order) and the footnote-presence flag (the footnote is a `ReactNode` slot, so only its presence is
/// Equatable). These two values are the `.onChange` key that lets a reused panel re-derive its layout
/// when the host swaps the rows or toggles the footnote.
public struct ResourcesPanelInputs: Sendable, Equatable {
    /// The ordered resource rows (web `rows`); an empty array is the empty-panel branch.
    public let rows: [ResourceRowInputs]
    /// Whether a footnote slot was supplied (web `footnote != null`).
    public let hasFootnote: Bool

    public init(rows: [ResourceRowInputs], hasFootnote: Bool = false) {
        self.rows = rows
        self.hasFootnote = hasFootnote
    }
}
