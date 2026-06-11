//
//  Distance.Projection.swift
//  TeslaSync — P4 shared surface · 0085 · Distance (Apple)
//
//  The pure projection from the input snapshot to the resolved, view-ready state — the native port of
//  the web `Distance` render: the two branches the source has, namely the formatted value (`{display}
//  {unit}` with the raw caller value as the `title` tooltip) and the empty sentinel (`—`) when neither
//  input is a finite number. Localization is applied here (P1/S10, via an injected resolver) so the
//  view is a pure function of the result and every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved value (web rendered `<span title>{display} {unit}</span>`)

/// The view-ready value branch — the formatted display string, the raw caller value preserved for the
/// tooltip (web `title`, e.g. "12.50 mi"), and the spoken VoiceOver label. The view renders these
/// fields directly.
public struct DistanceResolvedValue: Sendable, Equatable {
    /// The displayed figure with its unit (web `{display} {distanceUnit}`, e.g. "20.12 km").
    public let text: String
    /// The raw caller value tooltip, in the caller's own unit (web `title`, e.g. "12.50 mi").
    public let rawValueTitle: String
    /// The spoken VoiceOver label (the displayed figure verbatim).
    public let accessibilityLabel: String

    public init(text: String, rawValueTitle: String, accessibilityLabel: String) {
        self.text = text
        self.rawValueTitle = rawValueTitle
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved empty (web `<span>—</span>`)

/// The view-ready empty branch — the em-dash the web renders verbatim plus a localized VoiceOver label
/// so assistive tech never announces a bare "—" (a native refinement over the web `<span>`).
public struct DistanceResolvedEmpty: Sendable, Equatable {
    /// The visible em-dash sentinel (web `—`).
    public let text: String
    /// The localized spoken label ("No distance data").
    public let accessibilityLabel: String

    public init(text: String, accessibilityLabel: String) {
        self.text = text
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches)

/// The resolved, view-ready state. `phase` selects the rendered body: the formatted value branch when
/// a finite input was supplied, else the empty sentinel branch (web `sourceMiles == null`).
public struct DistanceResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// A finite `miles` / `km` input → the formatted figure with its unit + tooltip.
        case value(DistanceResolvedValue)
        /// Neither input finite → the em-dash sentinel (web `—`).
        case empty(DistanceResolvedEmpty)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }

    /// `true` in the empty branch — a convenience for tests + previews.
    public var isEmpty: Bool {
        switch phase {
        case .empty: true
        case .value: false
        }
    }

    /// The visible text in either branch ("20.12 km" or "—") — a convenience for tests + previews.
    public var displayText: String {
        switch phase {
        case let .value(value): value.text
        case let .empty(empty): empty.text
        }
    }
}

// MARK: - Projection (web component body)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `Distance` render. Unit tested across the empty branch (neither input finite) and the value branch
/// (the miles-first precedence, the SI conversion to the user's unit, the precision/locale formatting,
/// and the raw-value tooltip).
public enum DistanceProjection {
    public static func resolve(
        _ input: DistanceInput,
        strings: DistanceResolve = DistanceStrings.string
    ) -> DistanceResolved {
        guard let source = DistanceFormatting.source(miles: input.miles, km: input.km) else {
            return DistanceResolved(phase: .empty(DistanceResolvedEmpty(
                text: DistanceMeta.emptyDisplay,
                accessibilityLabel: DistanceAccessibility.emptyLabel(strings: strings)
            )))
        }
        let text = DistanceFormatting.display(
            meters: source.meters,
            units: input.units,
            precision: input.precision
        )
        return DistanceResolved(phase: .value(DistanceResolvedValue(
            text: text,
            rawValueTitle: source.title,
            accessibilityLabel: DistanceAccessibility.valueLabel(text)
        )))
    }
}
