//
//  DateTime.Projection.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state, split from the model for
//  the lint length budget. Everything here is deterministic (the relative clock is injected) and
//  resolves its copy through the injected `DateTimeResolve` seam, so the rendered text + every render
//  branch is asserted without a view or a bundle. The web component renders the value inline (a null /
//  invalid value collapses to "—"); the native parity keeps that inline "—" as the friendly empty
//  state (P4 leaf contract) so the surface never collapses to a blank box, and layers the
//  loading / error chrome + the freshness axis the web component's pure render has no concept of.
//

import Foundation

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for `content` / `empty` every field
/// is already formatted + localized, so the view is a pure function of this value.
public struct DateTimeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public let phase: Phase
    /// The formatted value (web `display`), or the "—" fallback in the `empty` phase.
    public let display: String
    /// The DST-aware zone abbreviation shown after the value (web `showTz` span), else `nil`.
    public let abbreviation: String?
    /// The canonical ISO title (web hover `title`) surfaced as the pointer help + VoiceOver hint.
    public let isoTitle: String?
    public let accessibilityLabel: String
    public let accessibilityHint: String?
    /// Whether `display` is the "—" fallback, so the view can render it muted.
    public let isFallback: Bool

    public init(
        phase: Phase,
        display: String,
        abbreviation: String?,
        isoTitle: String?,
        accessibilityLabel: String,
        accessibilityHint: String?,
        isFallback: Bool
    ) {
        self.phase = phase
        self.display = display
        self.abbreviation = abbreviation
        self.isoTitle = isoTitle
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
        self.isFallback = isFallback
    }

    /// A non-content chrome state (loading / error) — no value content.
    static func chrome(phase: Phase) -> DateTimeResolved {
        DateTimeResolved(
            phase: phase,
            display: "",
            abbreviation: nil,
            isoTitle: nil,
            accessibilityLabel: "",
            accessibilityHint: nil,
            isFallback: false
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `renderSpan` (the variant dispatch + the `value ? iso : —` gate) plus the P4 leaf contract. Unit
/// tested across loading / empty / error / content, every variant, the tz resolution, and the
/// optional `showTz` abbreviation.
public enum DateTimeProjection {
    public static func resolve(
        _ input: DateTimeInput,
        now: Date = Date(),
        strings: DateTimeResolve = DateTimeStrings.string
    ) -> DateTimeResolved {
        // P4 contract: a context-feed failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return .chrome(phase: .error(message))
        }
        // Initial fetch of the formatting context (web parent loading the settings/vehicle).
        if input.isLoading {
            return .chrome(phase: .loading)
        }

        let mode = input.mode ?? input.defaultMode
        let locale = DateTimeFormatting.resolveLocale(input.locale)
        let timeZone = DateTimeFormatting.resolveTimeZone(
            mode: mode,
            vehicleTimeZone: input.vehicleTimeZone,
            userOverride: input.userTimeZoneOverride,
            device: input.deviceTimeZone
        )

        // Web gate: a null / unparseable value renders the "—" fallback (native friendly empty).
        guard DateTimeFormatting.parse(input.value) != nil else {
            return DateTimeResolved(
                phase: .empty,
                display: DateTimeFormatting.fallback,
                abbreviation: nil,
                isoTitle: nil,
                accessibilityLabel: strings("format.dateTime.emptyA11y", "No date"),
                accessibilityHint: nil,
                isFallback: true
            )
        }

        let display = DateTimeFormatting.display(
            value: input.value,
            variant: input.variant,
            context: DateTimeFormatContext(locale: locale, timeZone: timeZone, now: now),
            strings: strings
        )
        let abbreviation = input.showTimeZone
            ? DateTimeFormatting.abbreviation(input.value, timeZone: timeZone)
            : ""
        let resolvedAbbreviation = abbreviation.isEmpty ? nil : abbreviation
        let isoTitle = DateTimeFormatting.isoTitle(input.value, timeZone: timeZone)

        return DateTimeResolved(
            phase: .content,
            display: display,
            abbreviation: resolvedAbbreviation,
            isoTitle: isoTitle,
            accessibilityLabel: DateTimeAccessibility.valueLabel(display: display, abbreviation: resolvedAbbreviation),
            accessibilityHint: isoTitle,
            isFallback: false
        )
    }

    /// The web `PureDateTime` path — device locale + zone, no `showTz`, and an ISO title without the
    /// "(tz)" suffix (the web pure render passes no `opts.tz`). Used by the stateless
    /// `PureDateTimeView` for the high-frequency table-cell path; shares the same formatting core so
    /// it is asserted without a view.
    public static func pure(
        value: DateTimeValue,
        variant: DateTimeVariant,
        locale: String,
        now: Date = Date(),
        strings: DateTimeResolve = DateTimeStrings.string
    ) -> DateTimeResolved {
        let resolvedLocale = DateTimeFormatting.resolveLocale(locale)
        guard DateTimeFormatting.parse(value) != nil else {
            return DateTimeResolved(
                phase: .empty,
                display: DateTimeFormatting.fallback,
                abbreviation: nil,
                isoTitle: nil,
                accessibilityLabel: strings("format.dateTime.emptyA11y", "No date"),
                accessibilityHint: nil,
                isFallback: true
            )
        }
        let display = DateTimeFormatting.display(
            value: value,
            variant: variant,
            context: DateTimeFormatContext(locale: resolvedLocale, timeZone: nil, now: now),
            strings: strings
        )
        let isoTitle = DateTimeFormatting.isoTitle(value, timeZone: nil)
        return DateTimeResolved(
            phase: .content,
            display: display,
            abbreviation: nil,
            isoTitle: isoTitle,
            accessibilityLabel: DateTimeAccessibility.valueLabel(display: display, abbreviation: nil),
            accessibilityHint: isoTitle,
            isFallback: false
        )
    }
}
