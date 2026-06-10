//
//  ServiceHealthSection.Adapter.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  The testable, dependency-free projection core for the system-status "Service
//  Health" surface — the faithful port of
//  features/system/components/status/ServiceHealthSection.tsx and the web helpers it
//  is fed by: `fmtInt` / `fmtNumber` (lib/numberFormat.ts) and `formatDateTime`
//  (lib/dateFormat.ts). Everything here is pure (no store, no bundle, no rendered
//  view) so the telemetry DTOs, the per-vehicle row projection, the streaming-state
//  classification, the locale number / date formatting, and the streaming tally are
//  all unit tested in isolation.
//
//  Parity notes:
//    • The web reads `getTelemetryStatus()` (GET /telemetry → `TelemetryStatus`) and
//      renders `Object.values(streaming_vehicles)`. The native source seam (P1/S8)
//      hands this adapter the same shape via `TelemetryStatusDTO`, carrying the
//      streaming vehicles as an ordered array so the projection is deterministic.
//    • `is_streaming ? 'success'/'Streaming' : 'neutral'/'Idle'` (the row Badge)
//      becomes `ServiceStreamingState`, mapped to an adaptive tone + i18n label at
//      the display boundary.
//    • `fmtInt(signal_count)`, `fmtNumber(signals_per_second, 1)`,
//      `${fmtNumber(latency_ms, 0)} ms`, `formatDateTime(last_received)` become
//      `ServiceHealthFormat`, returning the same "—" em-dash fallback for missing
//      timestamps (web contract).
//

import Foundation

// MARK: - Shared display constants

/// Display helpers shared by the projections.
public enum ServiceHealthDisplay {
    /// The universal em-dash fallback the web formatters return for missing values
    /// (web `'—'`), reused for an absent / unparseable last-received timestamp.
    public static let emDash = "—"
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ServiceHealthSurface {
    public static let slug = "ServiceHealthSection"
}

// MARK: - Streaming state (web row Badge `is_streaming`)

/// Whether a vehicle is actively streaming — the native, view-free mirror of the web
/// row `Badge variant={row.is_streaming ? 'success' : 'neutral'}`. Carries the tone +
/// the i18n key/fallback so the view renders the pill without re-deriving any of it.
public enum ServiceStreamingState: String, Sendable, Equatable, CaseIterable {
    case streaming
    case idle

    /// Classifies a row's streaming flag (web `row.is_streaming`).
    public init(isStreaming: Bool) {
        self = isStreaming ? .streaming : .idle
    }

    /// The pill tone (web `'success'` vs `'neutral'`).
    public var tone: ServiceHealthTone {
        switch self {
        case .streaming: .success
        case .idle: .neutral
        }
    }

    /// The localization key for the status label (web `t('Streaming')` / `t('Idle')`).
    public var labelKey: String {
        switch self {
        case .streaming: "Streaming"
        case .idle: "Idle"
        }
    }

    /// The English fallback for the status label (the web key IS the English string).
    public var labelFallback: String {
        labelKey
    }
}

/// The semantic tone a streaming / enabled state maps to — the native, view-free
/// mirror of the web Badge `variant`. The view maps this to the shared `TSTone`
/// colour tokens so no raw hex lives here.
public enum ServiceHealthTone: String, Sendable, Equatable, CaseIterable {
    case neutral
    case success
    case info
}

// MARK: - Transport DTOs (the P1/S8 source seam input)

/// One streaming vehicle as handed to the surface by its bound source — the native
/// parity of one `streaming_vehicles` entry (web `Object.values(...)` element).
/// Only the fields the table renders are modeled; the source projects the rest away.
public struct StreamingVehicleDTO: Sendable, Equatable {
    /// The vehicle VIN (web `row.vin`).
    public var vin: String
    /// Whether the vehicle is actively streaming (web `row.is_streaming`).
    public var isStreaming: Bool
    /// The total signal count (web `row.signal_count`).
    public var signalCount: Double
    /// The instantaneous signals-per-second (web `row.signals_per_second`).
    public var signalsPerSecond: Double
    /// The stream latency in milliseconds (web `row.latency_ms`).
    public var latencyMs: Double
    /// The last-received ISO timestamp (web `row.last_received`).
    public var lastReceived: String?

    public init(
        vin: String,
        isStreaming: Bool,
        signalCount: Double = 0,
        signalsPerSecond: Double = 0,
        latencyMs: Double = 0,
        lastReceived: String? = nil
    ) {
        self.vin = vin
        self.isStreaming = isStreaming
        self.signalCount = signalCount
        self.signalsPerSecond = signalsPerSecond
        self.latencyMs = latencyMs
        self.lastReceived = lastReceived
    }
}

/// The fleet-wide aggregate block (web `TelemetryStatus.aggregate_stats`). Only the
/// two fields the metric grid renders are modeled.
public struct AggregateStatsDTO: Sendable, Equatable {
    /// The total signals received across the fleet (web `total_signals_received`).
    public var totalSignalsReceived: Double
    /// The average signals-per-second, carried verbatim because the web field is a
    /// pre-formatted `string` rendered as-is (web `avg_signals_per_second`).
    public var avgSignalsPerSecond: String

    public init(totalSignalsReceived: Double = 0, avgSignalsPerSecond: String = "0") {
        self.totalSignalsReceived = totalSignalsReceived
        self.avgSignalsPerSecond = avgSignalsPerSecond
    }
}

/// The telemetry-status envelope (web `getTelemetryStatus()` → `TelemetryStatus`).
/// `vehicles` is the ordered projection of the web `streaming_vehicles` record.
public struct TelemetryStatusDTO: Sendable, Equatable {
    /// Whether Fleet Telemetry is enabled (web `data.enabled`).
    public var enabled: Bool
    /// The streaming mode label (web `data.mode`).
    public var mode: String
    /// The fleet aggregate stats (web `data.aggregate_stats`), when present.
    public var aggregate: AggregateStatsDTO?
    /// The streaming vehicles in source order (web `Object.values(streaming_vehicles)`).
    public var vehicles: [StreamingVehicleDTO]

    public init(
        enabled: Bool = false,
        mode: String = "",
        aggregate: AggregateStatsDTO? = nil,
        vehicles: [StreamingVehicleDTO] = []
    ) {
        self.enabled = enabled
        self.mode = mode
        self.aggregate = aggregate
        self.vehicles = vehicles
    }
}

// MARK: - Projected vehicle row (one web DataTable row)

/// The view-ready projection of one streaming-vehicle row: the VIN + its streaming
/// state, signal count, rate, latency, and last-received timestamp. Identifiable by
/// the VIN exactly like the web `keyExtractor={(v) => v.vin}`.
public struct ServiceVehicleRow: Sendable, Equatable, Identifiable {
    public var vin: String
    public var streamingState: ServiceStreamingState
    public var signalCount: Double
    public var signalsPerSecond: Double
    public var latencyMs: Double
    /// The last-received ISO string (nil / empty → em-dash at the display boundary).
    public var lastReceivedISO: String?

    public var id: String {
        vin
    }

    public init(
        vin: String,
        streamingState: ServiceStreamingState,
        signalCount: Double,
        signalsPerSecond: Double,
        latencyMs: Double,
        lastReceivedISO: String?
    ) {
        self.vin = vin
        self.streamingState = streamingState
        self.signalCount = signalCount
        self.signalsPerSecond = signalsPerSecond
        self.latencyMs = latencyMs
        self.lastReceivedISO = lastReceivedISO
    }
}

// MARK: - Vehicle projection (web `Object.values` + `is_streaming` tally)

/// Pure projection from the telemetry DTO to the view-ready vehicle rows + the
/// streaming tally — a faithful port of the web `vehicles` / `activeCount` derivation.
public enum ServiceHealthVehicles {
    /// View-ready rows, preserving source order exactly like the web
    /// `Object.values(streaming_vehicles).map(...)`.
    public static func rows(from vehicles: [StreamingVehicleDTO]) -> [ServiceVehicleRow] {
        vehicles.map { vehicle in
            ServiceVehicleRow(
                vin: vehicle.vin,
                streamingState: ServiceStreamingState(isStreaming: vehicle.isStreaming),
                signalCount: vehicle.signalCount,
                signalsPerSecond: vehicle.signalsPerSecond,
                latencyMs: vehicle.latencyMs,
                lastReceivedISO: (vehicle.lastReceived?.isEmpty ?? true) ? nil : vehicle.lastReceived
            )
        }
    }

    /// The count of actively streaming vehicles — web
    /// `vehicles.filter((v) => v.is_streaming).length`.
    public static func activeCount(_ vehicles: [StreamingVehicleDTO]) -> Int {
        vehicles.count(where: { $0.isStreaming })
    }
}

// MARK: - Number / date formatting (ports of numberFormat.ts + dateFormat.ts)

/// Pure number, integer, rate, latency, and date formatting ported from the web
/// helpers so the rounding, the grouping separators, and the em-dash sentinels match
/// the source exactly. `safeNumber` coerces non-finite input to 0 (web contract).
public enum ServiceHealthFormat {
    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)` (locale grouping, no decimals).
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// The signals-per-second cell — web `fmtNumber(row.signals_per_second, 1)`.
    public static func signalRate(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 1, locale: locale)
    }

    /// The latency cell with the "ms" suffix — web ``${fmtNumber(latency_ms, 0)} ms``.
    public static func latency(_ milliseconds: Double, locale: Locale = .current) -> String {
        "\(number(milliseconds, decimals: 0, locale: locale)) ms"
    }

    /// Parses an ISO-8601 timestamp (with or without fractional seconds). Returns
    /// `nil` for empty / unparseable input so callers fall back to the em-dash.
    public static func parse(_ iso: String) -> Date? {
        guard !iso.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// Native port of `formatDateTime(iso)` (dateFormat.ts): the em-dash fallback for a
    /// missing / unparseable date, otherwise a locale-ordered "MMM d, yyyy, h:mm a"
    /// rendering (web `month:'short', day:'numeric', year:'numeric', hour/minute:'2-digit'`).
    public static func dateTime(
        _ iso: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let iso, let date = parse(iso) else { return ServiceHealthDisplay.emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The already-localized parts of one vehicle row's spoken label, bundled so the
/// VoiceOver builder stays within the parameter budget and the spoken content is
/// asserted without a rendered view.
public struct ServiceVehicleSpoken: Sendable, Equatable {
    public var status: String
    public var vin: String
    public var signals: String
    public var rate: String
    public var latency: String
    public var lastReceived: String

    public init(
        status: String,
        vin: String,
        signals: String,
        rate: String,
        latency: String,
        lastReceived: String
    ) {
        self.status = status
        self.vin = vin
        self.signals = signals
        self.rate = rate
        self.latency = latency
        self.lastReceived = lastReceived
    }
}

/// Pure builders for the VoiceOver strings the views attach, composed from
/// already-localized parts so the spoken content is asserted without a rendered view.
public enum ServiceHealthAccessibility {
    /// The per-row spoken label, joining the localized cells in reading order:
    /// "{status}, {vin}, {signals}, {rate}, {latency}, {lastReceived}".
    public static func vehicleLabel(_ cells: ServiceVehicleSpoken) -> String {
        [cells.status, cells.vin, cells.signals, cells.rate, cells.latency, cells.lastReceived]
            .joined(separator: ", ")
    }

    /// The section header summary, e.g. "Service Health: 3 streaming" (or the
    /// enabled / disabled fallback when there are no vehicles).
    public static func sectionSummary(
        title: String,
        enabled: String,
        streamingCount: Int,
        hasVehicles: Bool,
        streamingLabel: String
    ) -> String {
        guard hasVehicles else { return "\(title): \(enabled)" }
        return "\(title): \(streamingCount) \(streamingLabel)"
    }
}
