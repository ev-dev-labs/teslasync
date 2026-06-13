//
//  TimeStamp.Projection.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state, split from the model for
//  the lint length budget. Everything here is deterministic (the relative clock is injected) and
//  resolves its copy through the injected `TimeStampResolve` seam, so the rendered text + every render
//  branch is asserted without a view or a bundle. The web component renders the visible body inline
//  with a hover tooltip carrying the alternate format (a null / invalid value collapses to "—" with
//  no tooltip); the native parity keeps that inline "—" as the friendly empty state (P4 leaf
//  contract) so the surface never collapses to a blank box, and layers the loading / error chrome +
//  the freshness axis the web component's pure render has no concept of.
//

import Foundation

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for `content` / `empty` every field
/// is already formatted + localized, so the view is a pure function of this value.
public struct TimeStampResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public let phase: Phase
    /// The visible body (web `primary`), or the "—" fallback in the `empty` phase.
    public let primary: String
    /// The tooltip alternate (web `secondary`) — always the OTHER format, `nil` in the empty phase
    /// (the web renders no tooltip for a nullish value).
    public let secondary: String?
    public let accessibilityLabel: String
    public let accessibilityHint: String?
    /// Whether `primary` is the "—" fallback, so the view can render it muted.
    public let isFallback: Bool

    public init(
        phase: Phase,
        primary: String,
        secondary: String?,
        accessibilityLabel: String,
        accessibilityHint: String?,
        isFallback: Bool
    ) {
        self.phase = phase
        self.primary = primary
        self.secondary = secondary
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
        self.isFallback = isFallback
    }

    /// A non-content chrome state (loading / error) — no value content.
    static func chrome(phase: Phase) -> TimeStampResolved {
        TimeStampResolved(
            phase: phase,
            primary: "",
            secondary: nil,
            accessibilityLabel: "",
            accessibilityHint: nil,
            isFallback: false
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `TimeStamp` body (the `format`/preference dispatch + the `value == null` gate + the primary/
/// secondary pair) plus the P4 leaf contract. Unit tested across loading / empty / error / content,
/// every format, the auto-preference resolution, and the tz resolution.
public enum TimeStampProjection {
    public static func resolve(
        _ input: TimeStampInput,
        now: Date = Date(),
        strings: TimeStampResolve = TimeStampStrings.string
    ) -> TimeStampResolved {
        // P4 contract: a context-feed failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return .chrome(phase: .error(message))
        }
        // Initial fetch of the formatting context (web parent loading the settings/vehicle).
        if input.isLoading {
            return .chrome(phase: .loading)
        }

        let mode = input.mode ?? input.defaultMode
        let locale = TimeStampFormatting.resolveLocale(input.locale)
        let timeZone = TimeStampFormatting.resolveTimeZone(
            mode: mode,
            vehicleTimeZone: input.vehicleTimeZone,
            userOverride: input.userTimeZoneOverride,
            device: input.deviceTimeZone
        )
        let context = TimeStampFormatContext(locale: locale, timeZone: timeZone, now: now)

        // Web gate: a null / unparseable value renders the "—" fallback (native friendly empty),
        // with NO tooltip alternate.
        guard let pair = TimeStampFormatting.pair(
            value: input.value,
            format: input.format,
            preference: input.preference,
            context: context,
            strings: strings
        ) else {
            return TimeStampResolved(
                phase: .empty,
                primary: TimeStampFormatting.fallback,
                secondary: nil,
                accessibilityLabel: strings("format.timeStamp.emptyA11y", "No time"),
                accessibilityHint: nil,
                isFallback: true
            )
        }

        return TimeStampResolved(
            phase: .content,
            primary: pair.primary,
            secondary: pair.secondary,
            accessibilityLabel: TimeStampAccessibility.valueLabel(primary: pair.primary),
            accessibilityHint: TimeStampAccessibility.alternateHint(secondary: pair.secondary, strings: strings),
            isFallback: false
        )
    }
}
