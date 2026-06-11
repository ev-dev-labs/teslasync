//
//  Speed.Projection.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  The pure projection from the input snapshot to the on-screen view-state — the native port of the
//  web component's render branches:
//
//      let sourceMph = mph finite ? mph * 0.44704 : (kmh finite ? (kmh * 1000) / 3600 : null)
//      if (sourceMph == null) return <span>—</span>;                       // fallback branch (no title)
//      const display = fmtNumber(convertSpeedFromSI(sourceMph, speedUnit), precision);
//      return <span title={`${raw.toFixed(1)} ${sourceUnit}`}>{display} {speedUnit}</span>;  // value branch
//
//  The view is a pure function of `SpeedResolved`; both branches are unit tested. Keeping the branch
//  selection + formatting here (rather than in the view) lets the rendered text and the canonical
//  (tooltip) string be asserted deterministically, which is how the per-branch "snapshot" coverage is
//  expressed without a pixel snapshot harness. Note the value branch composes TWO units: the figure is
//  rendered in the user's display unit while the tooltip names the caller's source unit, so an
//  `mph`-sourced value shown under a km/h preference reads e.g. "104.61 km/h" with a "65.0 mph" tooltip.
//

import Foundation

// MARK: - Resolved view-state (web `<span>` content + `title`)

/// The resolved, view-ready content. `text` is the visible string (web span text — the formatted figure
/// plus its display-unit label, or the fallback glyph); `canonical` is the locale-neutral tooltip string
/// (web `title` — the raw source value plus its source-unit label), present only on the value branch
/// (the web fallback span carries no `title`); `isFallback` records which branch produced it so the view
/// and tests can distinguish the two.
public struct SpeedResolved: Sendable, Equatable {
    public let text: String
    public let canonical: String?
    public let isFallback: Bool

    public init(text: String, canonical: String?, isFallback: Bool) {
        self.text = text
        self.canonical = canonical
        self.isFallback = isFallback
    }
}

// MARK: - Projection (branch selection + formatting)

/// Pure projection: the source-precedence guard, the SI-to-display conversion, the locale-aware display
/// string with its unit label, and the locale-neutral canonical (tooltip) string. No SwiftUI, no escaped
/// formatter state.
public enum SpeedProjection {
    /// Resolve the input to its view-state — the fallback branch when no finite `mph` / `kmh` is present,
    /// otherwise the value branch with its display figure and source-unit tooltip.
    public static func resolve(_ input: SpeedInput) -> SpeedResolved {
        guard let source = input.resolvedSource else {
            return SpeedResolved(text: input.fallback, canonical: nil, isFallback: true)
        }
        let displayValue = SpeedConversion.fromSI(source.mps, to: input.speedUnit)
        let number = SpeedFormatting.number(
            displayValue,
            precision: input.effectivePrecision,
            locale: input.locale
        )
        let rawFigure = SpeedFormatting.fixed(source.rawValue, precision: SpeedMeta.titleFractionDigits)
        return SpeedResolved(
            text: "\(number) \(input.speedUnit.label)",
            canonical: "\(rawFigure) \(source.sourceUnit.label)",
            isFallback: false
        )
    }
}
