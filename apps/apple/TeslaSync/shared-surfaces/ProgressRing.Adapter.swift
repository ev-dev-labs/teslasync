//
//  ProgressRing.Adapter.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  The testable, dependency-light core for the circular progress gauge — the SwiftUI parity of
//  `components/data-display/ProgressRing.tsx`. Everything here is pure (Foundation only): the input
//  snapshot (the web props), the surface metadata (the diagnostics slug + the web prop defaults and
//  the proportional font-scale constants), and the VoiceOver label builder. No store and no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is purely presentational: it takes already-resolved props and
//  paints an SVG ring. It reads no hooks, performs no fetch, and has no loading / error / empty /
//  stale / offline branch to mirror; synthesising such chrome would invent state the web source does
//  not have (the same disposition as the 0075 AnimatedNumber and 0053 AIThinkingIndicator surfaces).
//  The genuine render branches this core models are exactly the ones the web has: the always-present
//  track ring (so the surface is never a blank box), the arc fill from zero through partial to full,
//  the optional centered primary / secondary label, and the optional caption below the ring.
//
//  Parity note — i18n. The web component renders no translatable copy of its own: every visible string
//  (`label`, `centerLabel`, `centerSubLabel`) is caller-supplied data, exactly as in the web props.
//  There are therefore no message keys to mirror; the P1/S10 contribution for this surface is an empty
//  reserved table (see ProgressRing.strings) and the Swift sources hold no English literals.
//

import Foundation

// MARK: - Input (web `ProgressRingProps`)

/// One coalesced snapshot of the surface's inputs — the web props that drive the pure geometry. The
/// styling-only props are handled at the view layer: the web `color` (default `#3b82f6`) maps to the
/// P1/S9 `Color.TS.accent` token, caller-overridable, and the web `className` has no native peer.
///
/// `value` is the current amount; `max` the full-scale amount (web default 100); `size` the ring's
/// edge length in points (web default 48); `strokeWidth` the ring thickness (web default 4); `label`
/// the optional caption rendered below the ring; `centerLabel` / `centerSubLabel` the optional primary
/// and secondary text rendered inside the ring. Equatable + Hashable so the view can react to changes.
public struct ProgressRingInput: Sendable, Equatable, Hashable {
    public var value: Double
    public var max: Double
    public var size: Double
    public var strokeWidth: Double
    public var label: String?
    public var centerLabel: String?
    public var centerSubLabel: String?

    public init(
        value: Double,
        max: Double = ProgressRingMeta.defaultMax,
        size: Double = ProgressRingMeta.defaultSize,
        strokeWidth: Double = ProgressRingMeta.defaultStrokeWidth,
        label: String? = nil,
        centerLabel: String? = nil,
        centerSubLabel: String? = nil
    ) {
        self.value = value
        self.max = max
        self.size = size
        self.strokeWidth = strokeWidth
        self.label = label
        self.centerLabel = centerLabel
        self.centerSubLabel = centerSubLabel
    }
}

// MARK: - Surface metadata (diagnostics slug + web defaults)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`, the
/// web prop defaults (`max = 100`, `size = 48`, `strokeWidth = 4`), and the proportional font-scale
/// constants the web derives the centered text sizes from.
public enum ProgressRingMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ProgressRing"

    /// Web default `max = 100`.
    public static let defaultMax: Double = 100

    /// Web default `size = 48` (points).
    public static let defaultSize: Double = 48

    /// Web default `strokeWidth = 4` (points).
    public static let defaultStrokeWidth: Double = 4

    /// Web `mainSize = Math.max(10, Math.round(size * 0.32))` — the floor and the scale.
    public static let minMainFontSize: Double = 10
    public static let mainFontScale: Double = 0.32

    /// Web `subSize = Math.max(8, Math.round(size * 0.18))` — the floor and the scale.
    public static let minSubFontSize: Double = 8
    public static let subFontScale: Double = 0.18
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from the input + resolved geometry, so the spoken content is
/// asserted without rendering the view. The web hides the centered text from assistive tech
/// (`aria-hidden`) and exposes only the optional caption; the native refinement voices the whole gauge
/// as one element — the caption as the identity, the centered text (or the fill percentage when there
/// is none) as the value — so VoiceOver announces the meaningful reading rather than a silent ring.
public enum ProgressRingAccessibility {
    /// A trimmed, non-empty string, or `nil`. Mirrors the web truthiness gate on `label` and keeps the
    /// spoken label free of empty / whitespace-only fragments.
    static func nonEmpty(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    /// The fill expressed as a whole-percent string (e.g. `"86%"`) — the gauge's value reading and the
    /// fallback spoken value when the caller supplies no centered text.
    public static func percentText(_ resolved: ProgressRingResolved) -> String {
        "\(Int(resolved.percent.rounded()))%"
    }

    /// The centered text reading: the primary and secondary centered labels joined, or `nil` when the
    /// caller supplied neither.
    static func centerText(_ input: ProgressRingInput) -> String? {
        let parts = [nonEmpty(input.centerLabel), nonEmpty(input.centerSubLabel)].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    /// The composed VoiceOver label: `"{caption}, {value}"` when a caption is present, otherwise just
    /// the value, where the value is the centered text if any else the fill percentage.
    public static func combinedLabel(_ input: ProgressRingInput, resolved: ProgressRingResolved) -> String {
        let value = centerText(input) ?? percentText(resolved)
        guard let caption = nonEmpty(input.label) else { return value }
        return "\(caption), \(value)"
    }
}
