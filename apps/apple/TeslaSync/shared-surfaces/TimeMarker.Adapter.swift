//
//  TimeMarker.Adapter.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  The testable, dependency-light core for the alert time-marker — the SwiftUI parity of
//  components/charts/TimeMarker.tsx plus the data source it is driven by, hooks/useAlertContext.ts.
//  The web source is a presentational annotation, not a fetcher: `<TimeMarker x severity label>`
//  renders a single vertical `<ReferenceLine>` at the alert moment (or nothing when `x` is absent),
//  colored by the alert's severity. The moment itself comes from `useAlertContext()`, a pure reader
//  of the drill-through query params (`vehicle_id`, `t`, `signal`) a page lands on when the user
//  clicks an alert. This file is the Foundation-only heart of the native peer: the value types
//  (`MarkerSeverity`, `TimeMarkerValue`, `TimeMarkerAlertContext`, `TimeMarkerWindow`,
//  `TimeMarkerParams`) and the pure `AlertContextReducer` that ports the `useAlertContext` `useMemo`
//  verbatim. No SwiftUI, no Charts, no `@Observable` — so every branch is unit testable in isolation.
//
//  Faithful-parity note: both the web component and its `useAlertContext` data source are
//  SYNCHRONOUS. `useAlertContext` is `useSearchParams()` + `useMemo` — it reads the current URL and
//  derives a window; there is no network request, no Promise, no React-Query cache. `TimeMarker`
//  itself is a pure `props → ReferenceLine` render whose only conditional is `if (x == null ||
//  x === '') return null`. Neither has a loading, error, stale, or offline branch — there is nothing
//  to load, fail, go stale, or lose connectivity to. Inventing such chrome would fabricate states the
//  source does not have (and would contradict the spec), so this surface reproduces only the source's
//  REAL branches — exactly as the sibling anonymous chart primitive ChartTimeRangeContext (0069) did:
//    • context absent  — no drill-through params present (`hasContext == false`) → no marker (the
//                        faithful "empty" analog: the chart renders unchanged, no reference line).
//    • timestamp absent / unparseable — `x == null || x === ''` → no marker, even when other params
//                        are present (the web `if (x == null || x === '') return null`).
//    • marker present  — a parseable alert instant → a single severity-colored reference line.
//    • severity variants — info / warn (the default) / critical / success, including the legacy
//                        `warning` / `error` / `fatal` / `ok` wire aliases `normalizeSeverity` folds.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened`
/// (P1/S11). The web component is named `TimeMarker`; this surface keeps the same slug here
/// (SwiftUI-free) so the state-holder can emit telemetry without depending on the view layer.
public enum TimeMarkerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "TimeMarker"
}

// MARK: - MarkerSeverity (web `Severity` + `normalizeSeverity`)

/// The alert severity that drives the marker color — the native peer of the web
/// `Severity = 'info' | 'warn' | 'critical' | 'success'` (lib/tokens.ts). The canonical wire-level
/// severities are `info | warn | critical`; `success` is a UI-only success affordance. Use
/// ``normalize(_:)`` to fold any incoming string (including the legacy `warning` / `error` / `fatal`
/// / `ok` aliases) onto the canonical set before reading a color — exactly as the web
/// `normalizeSeverity()` does.
public enum MarkerSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case warn
    case critical
    case success

    /// The default the web `TimeMarker` applies when no severity is supplied (`severity ?? 'warn'`):
    /// an unclassified alert reads as a warning, never silently as info.
    public static let markerDefault: MarkerSeverity = .warn

    /// Folds an arbitrary wire string onto the canonical severity — the verbatim port of
    /// `normalizeSeverity`. A `nil` / empty value reads as `.info` (the web `if (!s) return 'info'`);
    /// `warning → warn`, `error | fatal → critical`, `ok | success → success`; an unknown string
    /// also reads as `.info`.
    public static func normalize(_ raw: String?) -> MarkerSeverity {
        guard let raw, !raw.isEmpty else { return .info }
        switch raw.lowercased() {
        case "warning", "warn": return .warn
        case "error", "fatal", "critical": return .critical
        case "ok", "success": return .success
        case "info": return .info
        default: return .info
        }
    }
}

// MARK: - TimeMarkerValue (web `x: string | number`)

/// The x value the marker is drawn at — the native peer of the web `x: string | number | null |
/// undefined`. The non-null part of the union maps to the cases; the `null` / `undefined` / `''` of
/// the union maps to Swift `nil`, so an absent marker is `TimeMarkerValue?` of `nil` everywhere (the
/// web `if (x == null || x === '') return null`).
///
/// Recharts plots a `ReferenceLine` against whatever the chart's x-axis `dataKey` uses — often a
/// pre-formatted category string, sometimes a raw number — so the web caller maps the alert
/// timestamp to that value by hand. Swift Charts plots time series against a real `Date` axis, so
/// ``date(_:)`` is the idiomatic native spelling for the alert instant; ``number(_:)`` and
/// ``text(_:)`` remain for callers whose chart uses a numeric or category x-scale.
public enum TimeMarkerValue: Sendable, Equatable, Hashable {
    /// A category / formatted-label x value (web `string`).
    case text(String)
    /// A numeric x value — a raw axis value (web `number`).
    case number(Double)
    /// A `Date` x value — the alert instant on a Swift Charts time axis (native-idiomatic).
    case date(Date)

    /// Builds a value from a category string, returning `nil` for the empty string so the absent
    /// branch is represented as `nil` (the web `x === ''` → `null`).
    public init?(text: String) {
        guard !text.isEmpty else { return nil }
        self = .text(text)
    }

    /// Builds a `.date` value by parsing an ISO-8601 timestamp, returning `nil` when the string is
    /// empty or unparseable (the web `new Date(t)` → `NaN` guard).
    public init?(isoString: String) {
        guard let date = TimeMarkerDateParser.parse(isoString) else { return nil }
        self = .date(date)
    }

    /// The `Date` payload when this value is `.date`, else `nil`.
    public var dateValue: Date? {
        if case let .date(value) = self { return value }
        return nil
    }

    /// The numeric payload when this value is `.number`, else `nil`.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The string payload when this value is `.text`, else `nil`.
    public var textValue: String? {
        if case let .text(value) = self { return value }
        return nil
    }
}

// MARK: - TimeMarkerWindow (web `{ from, to }`)

/// The `[t-30min, t+30min]` chart window centered on the alert instant — the native peer of the web
/// `AlertContext.timeWindow`. The web carries ISO strings; the native value carries `Date`s (the
/// canonical instant) and exposes ISO accessors so a caller that needs the wire shape still gets it.
public struct TimeMarkerWindow: Sendable, Equatable {
    public let from: Date
    public let to: Date

    public init(from: Date, to: Date) {
        self.from = from
        self.to = to
    }

    /// The closed `Date` range, handy for `chartXScale(domain:)` on a Swift Charts time axis.
    public var range: ClosedRange<Date> {
        from <= to ? from ... to : to ... from
    }

    /// The lower bound as an ISO-8601 string (web `from`).
    public var fromISO: String {
        TimeMarkerDateParser.iso(from)
    }

    /// The upper bound as an ISO-8601 string (web `to`).
    public var toISO: String {
        TimeMarkerDateParser.iso(to)
    }
}

// MARK: - TimeMarkerParams (web `useSearchParams()` reads)

/// The raw drill-through query params a page lands on — the native peer of the three
/// `useSearchParams().get(...)` reads `useAlertContext` performs (`vehicle_id`, `t`, `signal`). A
/// `nil` field is an absent param (web `params.get` → `null`); a present-but-empty param is
/// `Optional("")` (web `params.get` → `''`), which the reducer treats exactly as the web does.
public struct TimeMarkerParams: Sendable, Equatable {
    /// Raw `?vehicle_id=` value, or `nil` when the param is absent.
    public let vehicleID: String?
    /// Raw `?t=` ISO timestamp value, or `nil` when the param is absent.
    public let timestamp: String?
    /// Raw `?signal=` value, or `nil` when the param is absent.
    public let signal: String?

    public init(vehicleID: String? = nil, timestamp: String? = nil, signal: String? = nil) {
        self.vehicleID = vehicleID
        self.timestamp = timestamp
        self.signal = signal
    }

    /// The "no drill-through" params — every field absent (web URL with no alert query string).
    public static let none = TimeMarkerParams()
}

// MARK: - TimeMarkerAlertContext (web `AlertContext`)

/// The resolved drill-through context — the native peer of the web `AlertContext` returned by
/// `useAlertContext()`. All fields are optional: when no drill-through param is present the context
/// is ``empty`` and a page renders its default view (web "the hook returns nulls").
public struct TimeMarkerAlertContext: Sendable, Equatable {
    /// Vehicle ID from `?vehicle_id=N`, or `nil` when absent / non-finite (web `safeVehicleId`).
    public let vehicleID: Int?
    /// Raw ISO timestamp from `?t=...`, or `nil` (web `timestamp`). Present even when unparseable.
    public let timestamp: String?
    /// Signal name from `?signal=...`, or `nil` (web `signal`).
    public let signal: String?
    /// `[t-30min, t+30min]` window — `nil` when no parseable timestamp (web `timeWindow`).
    public let timeWindow: TimeMarkerWindow?
    /// `true` when at least one drill-through param is present (web `hasContext`).
    public let hasContext: Bool

    public init(
        vehicleID: Int?,
        timestamp: String?,
        signal: String?,
        timeWindow: TimeMarkerWindow?,
        hasContext: Bool
    ) {
        self.vehicleID = vehicleID
        self.timestamp = timestamp
        self.signal = signal
        self.timeWindow = timeWindow
        self.hasContext = hasContext
    }

    /// The "no alert context" value — every field empty (web hook return when the URL carries no
    /// drill-through params). A page resolves to this and renders its default, marker-free view.
    public static let empty = TimeMarkerAlertContext(
        vehicleID: nil,
        timestamp: nil,
        signal: nil,
        timeWindow: nil,
        hasContext: false
    )

    /// The parsed alert instant, or `nil` when no parseable timestamp is present — the bridge from
    /// the raw `timestamp` to the chart's x value. `nil` here is the faithful "no marker" branch.
    public var markerDate: Date? {
        timeWindow != nil ? timestamp.flatMap(TimeMarkerDateParser.parse) : nil
    }

    /// The alert instant as a ``TimeMarkerValue`` ready to hand a Swift Charts time-axis marker, or
    /// `nil` when no parseable timestamp is present (web `x == null` → no `ReferenceLine`).
    public var markerValue: TimeMarkerValue? {
        markerDate.map(TimeMarkerValue.date)
    }
}

// MARK: - AlertContextReducer (verbatim port of useAlertContext useMemo)

/// The pure projection from the raw query params to the resolved ``TimeMarkerAlertContext`` — the
/// verbatim port of the `useAlertContext` `useMemo`. Kept as a pure function over a caller-owned
/// ``TimeMarkerParams`` so every rule — finite vehicle id, the `±30min` window, the unparseable-`t`
/// branch, and the `hasContext` OR — is unit tested without `useSearchParams`, an `@Observable`
/// model, or a clock.
public enum AlertContextReducer {
    /// The half-width of the centered chart window: 30 minutes (web `ALERT_WINDOW_MS = 30 * 60_000`).
    public static let windowHalfWidth: TimeInterval = 30 * 60

    /// Resolves the params to a context — the body of the web `useMemo`:
    ///   • `vehicleID` — `nil` for an absent / empty param; otherwise the param parsed as a finite
    ///     number (web `Number(raw)` + `Number.isFinite`), truncated to the integer vehicle id.
    ///   • `timeWindow` — `[t-30min, t+30min]` only when `t` is present AND parses to a valid date
    ///     (web `if (t) { const parsed = new Date(t); if (!isNaN) … }`); otherwise `nil`.
    ///   • `timestamp` / `signal` — carried through raw (web `timestamp: t`, `signal`).
    ///   • `hasContext` — `vehicleID != nil || t != nil || signal != nil`, where `t` / `signal` are
    ///     the RAW presence (a present-but-empty or unparseable value still counts, web
    ///     `t != null || signal != null`).
    public static func resolve(
        _ params: TimeMarkerParams,
        windowHalfWidth: TimeInterval = AlertContextReducer.windowHalfWidth
    ) -> TimeMarkerAlertContext {
        let vehicleID = parseVehicleID(params.vehicleID)

        var timeWindow: TimeMarkerWindow?
        if let raw = params.timestamp, !raw.isEmpty, let parsed = TimeMarkerDateParser.parse(raw) {
            timeWindow = TimeMarkerWindow(
                from: parsed.addingTimeInterval(-windowHalfWidth),
                to: parsed.addingTimeInterval(windowHalfWidth)
            )
        }

        let hasContext = vehicleID != nil || params.timestamp != nil || params.signal != nil

        return TimeMarkerAlertContext(
            vehicleID: vehicleID,
            timestamp: params.timestamp,
            signal: params.signal,
            timeWindow: timeWindow,
            hasContext: hasContext
        )
    }

    /// Parses the raw `vehicle_id` param the way the web does: an absent / empty param is `nil`; a
    /// finite numeric param becomes the (truncated) integer vehicle id; a non-numeric param is `nil`
    /// (web `Number('abc')` → `NaN` → `!isFinite` → `null`).
    static func parseVehicleID(_ raw: String?) -> Int? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        if let int = Int(trimmed) { return int }
        guard let double = Double(trimmed), double.isFinite else { return nil }
        return Int(double)
    }
}

// MARK: - Date parsing (web `new Date(t)` / `.toISOString()`)

/// ISO-8601 parsing + formatting for the alert timestamp — the native stand-in for the web
/// `new Date(t)` parse and `.toISOString()` emit. Accepts internet date-time with or without
/// fractional seconds (the two shapes Tesla Fleet timestamps arrive in) and emits the
/// fractional-seconds UTC form the web window uses.
public enum TimeMarkerDateParser {
    /// Parses an ISO-8601 timestamp, returning `nil` when the string is empty or malformed (web
    /// `Number.isNaN(parsed.getTime())`).
    public static func parse(_ raw: String) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: trimmed) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }

    /// Emits an ISO-8601 UTC string with fractional seconds — the native peer of the JS
    /// `Date.toISOString()` the web window bounds carry.
    public static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
