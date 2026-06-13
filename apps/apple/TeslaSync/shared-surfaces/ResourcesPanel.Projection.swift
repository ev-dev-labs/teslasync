//
//  ResourcesPanel.Projection.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  The pure projection from the structural props to the view-ready model the SwiftUI body renders — the
//  native port of the web `ResourcesPanel` + `ResourceRowItem` render bodies. The web collapses each
//  row's props into a fixed set of layout decisions: the severity (which colours the bar + value), the
//  passed-through label / value / meta strings, whether the sub-label renders, whether the usage bar
//  renders and its clamped width + rounded accessibility percent, and whether the decorative icon
//  renders; and the panel into whether it is empty and whether a footnote follows. This projection bakes
//  every one of those decisions into Equatable value types the view consumes as pure functions; every
//  branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``ResourcesPanelProjector/resolve(inputs:)`` takes the cached structural props (the rows a caller
//  already holds) and derives the rendered layout decisions — no networking, no clock, no SwiftUI. The
//  localized title / empty message / accessibility strings are composed in the @Observable model
//  (ResourcesPanel.Model.swift), which owns the i18n facade, so this projection stays prose-free + pure.
//

import Foundation

// MARK: - ResourceRowProjection (web `ResourceRowItem` render output)

/// The resolved, view-ready layout decisions for one row — the native bundle of everything the web
/// `ResourceRowItem` render body decides from its props. The view is a pure function of this value: it
/// tints the bar + value by `severity`, renders the icon iff `showsIcon`, renders the sub-label iff
/// `showsMeta`, and renders the usage bar iff `showsBar` (at `barWidthPercent`, announcing
/// `accessibilityPercent`).
public struct ResourceRowProjection: Sendable, Equatable, Identifiable {
    /// Stable identity for `ForEach` (web `key={row.label}`).
    public let id: String
    /// The left-aligned label, passed through for rendering + the accessibility label (web `label`).
    public let label: String
    /// The right-aligned formatted value, passed through for rendering (web `valueText`).
    public let valueText: String
    /// The sub-label, passed through when present (web `metaText`); `nil` when omitted / empty.
    public let metaText: String?
    /// Whether the sub-label renders (web `row.metaText && …` — empty strings are falsy, so dropped).
    public let showsMeta: Bool
    /// The severity driving the bar + value hue (web `'normal' | 'warn' | 'critical'`).
    public let severity: ResourceSeverity
    /// Whether the usage bar renders (web `percent != null`).
    public let showsBar: Bool
    /// The bar fill width as a 0–100 percent, clamped exactly like the web
    /// (`Math.max(0, Math.min(100, percent))`); `0` when there is no bar.
    public let barWidthPercent: Double
    /// The rounded percent VoiceOver announces — the native peer of the web `aria-valuenow`
    /// (`Math.round(percent)`); `nil` when there is no bar.
    public let accessibilityPercent: Int?
    /// Whether the decorative leading icon renders (web `icon != null`).
    public let showsIcon: Bool

    public init(
        id: String,
        label: String,
        valueText: String,
        metaText: String?,
        showsMeta: Bool,
        severity: ResourceSeverity,
        showsBar: Bool,
        barWidthPercent: Double,
        accessibilityPercent: Int?,
        showsIcon: Bool
    ) {
        self.id = id
        self.label = label
        self.valueText = valueText
        self.metaText = metaText
        self.showsMeta = showsMeta
        self.severity = severity
        self.showsBar = showsBar
        self.barWidthPercent = barWidthPercent
        self.accessibilityPercent = accessibilityPercent
        self.showsIcon = showsIcon
    }
}

// MARK: - ResourcesPanelProjection (web `ResourcesPanel` render output)

/// The resolved, view-ready layout decisions for the whole panel — the native bundle of everything the
/// web `ResourcesPanel` render body decides. The view tints/stacks the `rows`, shows the friendly empty
/// state iff `isEmpty` (the disclosed native peer of the web's empty `rows.map`), and renders the
/// footnote slot iff `hasFootnote`.
public struct ResourcesPanelProjection: Sendable, Equatable {
    /// The ordered, resolved row projections (web `rows.map(…)`).
    public let rows: [ResourceRowProjection]
    /// Whether the panel has no rows (web `rows.length === 0`) — drives the friendly empty state.
    public let isEmpty: Bool
    /// Whether the footnote slot renders (web `footnote && …`).
    public let hasFootnote: Bool

    public init(rows: [ResourceRowProjection], isEmpty: Bool, hasFootnote: Bool) {
        self.rows = rows
        self.isEmpty = isEmpty
        self.hasFootnote = hasFootnote
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection to the view-ready layout decisions — the verbatim port of the web `ResourcesPanel` +
/// `ResourceRowItem` render bodies. Kept as a pure function over the caller-owned structural props so
/// every branch (each severity, bar present / absent, meta present / absent / empty, icon present /
/// absent, empty panel, footnote) is unit tested without an @Observable model or a view.
public enum ResourcesPanelProjector {
    /// Resolves one row exactly like the web `ResourceRowItem`:
    ///   • `severity = ResourceSeverity.classify(percent)` (web warn ≥ 70 %, critical ≥ 90 %; no
    ///     `percent` → normal).
    ///   • `showsBar = percent != nil` (web renders the bar only when a `percent` is supplied).
    ///   • `barWidthPercent` clamps to 0–100 (web `Math.max(0, Math.min(100, percent))`); `0` with no bar.
    ///   • `accessibilityPercent = round(percent)` (web `aria-valuenow={Math.round(percent)}`); `nil`
    ///     with no bar.
    ///   • `showsMeta = metaText` is non-empty (web `{row.metaText && …}` — `""` is falsy, so dropped).
    ///   • `showsIcon = hasIcon` (web `icon != null`).
    public static func resolveRow(_ inputs: ResourceRowInputs) -> ResourceRowProjection {
        let severity = ResourceSeverity.classify(percent: inputs.percent)
        let showsBar = inputs.percent != nil
        let clamped = max(0, min(100, inputs.percent ?? 0))
        let accessibilityPercent = inputs.percent.map { Int($0.rounded()) }
        let trimmedMeta = inputs.metaText?.trimmingCharacters(in: .whitespacesAndNewlines)
        let showsMeta = !(trimmedMeta ?? "").isEmpty

        return ResourceRowProjection(
            id: inputs.id,
            label: inputs.label,
            valueText: inputs.valueText,
            metaText: inputs.metaText,
            showsMeta: showsMeta,
            severity: severity,
            showsBar: showsBar,
            barWidthPercent: clamped,
            accessibilityPercent: showsBar ? accessibilityPercent : nil,
            showsIcon: inputs.hasIcon
        )
    }

    /// Resolves the whole panel: maps every row through ``resolveRow(_:)`` (web `rows.map`), flags the
    /// empty-panel branch (web `rows.length === 0`), and carries the footnote-presence through.
    public static func resolve(inputs: ResourcesPanelInputs) -> ResourcesPanelProjection {
        ResourcesPanelProjection(
            rows: inputs.rows.map(resolveRow),
            isEmpty: inputs.rows.isEmpty,
            hasFootnote: inputs.hasFootnote
        )
    }
}
