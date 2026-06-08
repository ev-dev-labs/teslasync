//
//  AutopilotSection.Projection.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  The projected output types for the "Autopilot & Cruise" section (the three stat tiles and the
//  whole-section projection), the diagnostics surface slug, and the VoiceOver summary builder.
//  Foundation-only so it executes on a plain host and is pinned by tests. Parity target:
//  features/driving/components/driving-dynamics/AutopilotSection.tsx.
//

import Foundation

// MARK: - Projected pieces

/// Which of the three autopilot stats a tile represents (fixes the web render order and the SF Symbol
/// the view picks). The web renders Current Speed, then Cruise Set Speed, then Follow Distance.
public enum AutopilotStatKind: String, Sendable, Equatable, CaseIterable {
    case currentSpeed
    case cruiseSetSpeed
    case followDistance
}

/// One projected stat tile (web `<StatCard label value unit icon />`): the label, the pre-formatted
/// value (the localized number or the em-dash sentinel), the optional unit caption (the two speed
/// tiles carry the speed unit; Follow Distance carries none, as in the web), and the combined
/// VoiceOver label. The value + unit render verbatim — no further formatting at the view layer.
public struct AutopilotStat: Sendable, Equatable, Identifiable {
    public var kind: AutopilotStatKind
    public var label: String
    public var value: String
    /// The unit caption (web `StatCard unit` prop). `nil` for Follow Distance (the web omits it).
    public var unit: String?
    public var accessibilityLabel: String

    public var id: AutopilotStatKind {
        kind
    }

    public init(
        kind: AutopilotStatKind,
        label: String,
        value: String,
        unit: String?,
        accessibilityLabel: String
    ) {
        self.kind = kind
        self.label = label
        self.value = value
        self.unit = unit
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The whole projected section: the three stat tiles plus the `hasAny` flag the web computes
/// (`speedMps != null || cruiseSetMps != null || followDistance != null`). When `hasAny` is false the
/// surface shows its empty state; otherwise it shows the three tiles (each possibly an em-dash).
public struct AutopilotProjection: Sendable, Equatable {
    public var stats: [AutopilotStat]
    /// Web `hasAny` — whether at least one of the three values is present (drives content vs empty).
    public var hasAny: Bool

    public init(stats: [AutopilotStat], hasAny: Bool) {
        self.stats = stats
        self.hasAny = hasAny
    }

    public static let empty = AutopilotProjection(stats: [], hasAny: false)
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core
/// so it is reachable from the projection's unit tests.
public enum AutopilotSectionSurface {
    public static let slug = "AutopilotSection"
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver string. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summary is testable without a bundle, exactly like the view's
/// P1/S10 facade.
public enum AutopilotSectionAccessibility {
    /// The section-level summary: the "Autopilot & Cruise" title followed by each stat tile's spoken
    /// label, or the empty-state message when no telemetry is present.
    public static func sectionSummary(
        for projection: AutopilotProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("dynamics.autopilot", "Autopilot & Cruise")
        guard projection.hasAny else {
            let empty = localize("dynamics.autopilotNoData", "No cruise / autopilot telemetry received yet")
            return "\(title). \(empty)"
        }
        let parts = [title] + projection.stats.map(\.accessibilityLabel)
        return parts.joined(separator: ". ")
    }
}
