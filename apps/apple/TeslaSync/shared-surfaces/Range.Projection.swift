//
//  Range.Projection.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  The pure projection from the input snapshot to the resolved, view-ready state — the native port of
//  the web `Range` render plus the `useRangeLabel` companion. The web has two value branches: the
//  formatted distance (`{formatDistance(meters, {precision})}`) and the em-dash sentinel (`—`) when
//  the selected range is `null`; `formatDistance` itself also returns the empty fallback for a
//  non-finite value, so both collapse to the native empty branch (identical visible "—"). The
//  rated-vs-ideal label is resolved here too and carried on every branch (the parity of
//  `useRangeLabel` returning a stable label even while `state` is null). Localization is applied here
//  (P1/S10, via an injected resolver) so the view is a pure function of the result and every branch is
//  unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved value (web rendered `<span>{formatDistance(...)}</span>`)

/// The view-ready value branch — the formatted display string and the spoken VoiceOver label. The view
/// renders these fields directly.
public struct RangeResolvedValue: Sendable, Equatable {
    /// The displayed figure with its unit (web `formatDistance(meters, {precision})`, e.g. "320 km").
    public let text: String
    /// The spoken VoiceOver label (the displayed figure verbatim).
    public let accessibilityLabel: String

    public init(text: String, accessibilityLabel: String) {
        self.text = text
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved empty (web `<span>—</span>`)

/// The view-ready empty branch — the em-dash the web renders verbatim (or the user's `emptyDisplay`
/// override for the non-finite formatter path) plus a localized VoiceOver label so assistive tech
/// never announces a bare "—" (a native refinement over the web `<span>`).
public struct RangeResolvedEmpty: Sendable, Equatable {
    /// The visible sentinel (web `—`, or `pref.emptyDisplay` for the non-finite formatter path).
    public let text: String
    /// The localized spoken label ("No range data").
    public let accessibilityLabel: String

    public init(text: String, accessibilityLabel: String) {
        self.text = text
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches + the companion label)

/// The resolved, view-ready state. `phase` selects the rendered value body; `label` is the localized
/// rated/ideal label (web `useRangeLabel`), available regardless of phase so the label renders even
/// while `state` is null.
public struct RangeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// A present, finite selected range → the formatted figure with its unit.
        case value(RangeResolvedValue)
        /// A missing / non-finite selected range → the em-dash sentinel (web `—`).
        case empty(RangeResolvedEmpty)
    }

    public let phase: Phase
    /// The localized rated/ideal label (web `useRangeLabel` → `t('common.ratedRange'|'idealRange')`).
    public let label: String

    public init(phase: Phase, label: String) {
        self.phase = phase
        self.label = label
    }

    /// `true` in the empty branch — a convenience for tests + previews.
    public var isEmpty: Bool {
        switch phase {
        case .empty: true
        case .value: false
        }
    }

    /// The visible text in either branch ("320 km" or "—") — a convenience for tests + previews.
    public var displayText: String {
        switch phase {
        case let .value(value): value.text
        case let .empty(empty): empty.text
        }
    }
}

// MARK: - Projection (web component body + `useRangeLabel`)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `Range` render and the `useRangeLabel` companion. Unit tested across the empty branch (null /
/// non-finite selection) and the value branch (rated vs ideal selection, the SI conversion to the
/// user's unit, the precision/locale formatting), plus the always-present localized label.
public enum RangeProjection {
    public static func resolve(
        _ input: RangeInput,
        strings: RangeResolve = RangeStrings.string
    ) -> RangeResolved {
        let selection = RangeSelection.selectPreferredRange(state: input.state, rangeType: input.rangeType)
        let label = label(for: selection, strings: strings)

        guard let meters = selection.meters else {
            // Web `if (meters == null) return <span>—</span>` — the hardcoded em-dash, independent of
            // the user's `emptyDisplay` (only the formatter path below consults that override).
            return RangeResolved(
                phase: .empty(RangeResolvedEmpty(
                    text: RangeMeta.emptyDisplay,
                    accessibilityLabel: RangeAccessibility.emptyLabel(strings: strings)
                )),
                label: label
            )
        }

        guard RangeFormatting.isFiniteValue(meters) else {
            // Web `formatDistance(NaN, …)` → `resolveEmpty(pref)` (the `emptyDisplay ?? '—'` fallback).
            return RangeResolved(
                phase: .empty(RangeResolvedEmpty(
                    text: RangeFormatting.resolveEmpty(input.units),
                    accessibilityLabel: RangeAccessibility.emptyLabel(strings: strings)
                )),
                label: label
            )
        }

        let text = RangeFormatting.formatDistance(
            meters: meters,
            units: input.units,
            precision: input.precision
        )
        return RangeResolved(
            phase: .value(RangeResolvedValue(
                text: text,
                accessibilityLabel: RangeAccessibility.valueLabel(text)
            )),
            label: label
        )
    }

    /// The localized rated/ideal label for a resolved selection — the body of `useRangeLabel`
    /// (`t('common.<labelKey>', defaultLabel)`).
    public static func label(for selection: PreferredRange, strings: RangeResolve = RangeStrings.string) -> String {
        strings("common.\(selection.labelKey)", selection.defaultLabel)
    }

    /// The localized rated/ideal label for a range-type preference — the parity of calling
    /// `useRangeLabel` directly. The label depends only on the preference, not on the field values, so
    /// it resolves even when no `state` is available.
    public static func label(for rangeType: RangeType, strings: RangeResolve = RangeStrings.string) -> String {
        label(for: RangeSelection.selectPreferredRange(state: nil, rangeType: rangeType), strings: strings)
    }
}
