//
//  InfrastructureSection.Adapter.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  The testable projection core for the system-status "Infrastructure" surface —
//  the faithful port of features/system/components/status/InfrastructureSection.tsx.
//  Everything here is pure and dependency-free (Foundation only) so it can be unit-
//  tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component composes TWO interval-refetched reads — `getTelemetryStatus()`
//      (/telemetry, 2s) and `getExtendedHealth()` (/system/health, 30s). The native
//      source seam (P1/S8) hands this adapter the same shapes via `InfraTelemetryDTO`
//      and `InfraDatabasePoolDTO`, and the projections below derive the SSE-connection
//      key/values, the polling-engine key/values, the database-pool metric tiles, and
//      the render phase from them.
//    • `sseConnected = telemetry?.enabled ?? false` and
//      `connectionMode = telemetry?.mode ?? 'unknown'` become
//      `InfrastructureProjection.sseConnected` / `connectionMode`, driving the header
//      Connected/Disconnected badge and the polling Active/Standby badge.
//    • The web `?? '—'` em-dash fallback for an absent endpoint / protocol / speed
//      comparison is preserved via `InfrastructureDisplay.emDash`.
//    • The web always renders the two cards (telemetry fields fall back to the em-dash
//      when the read is still undefined); the prompt's surface-level `empty` state (no
//      telemetry AND no pool) and the loading / error envelope are resolved by
//      `resolvePhase` so no state is ever a blank box.
//

import Foundation

// MARK: - Shared display constants

/// Display helpers shared by the projections.
public enum InfrastructureDisplay {
    /// The universal em-dash fallback the web renders for missing values (web `'—'`),
    /// reused for an absent endpoint, protocol, or speed-comparison string.
    public static let emDash = "—"

    /// The web fallback for an absent telemetry mode (`telemetry?.mode ?? 'unknown'`).
    public static let unknownMode = "unknown"

    /// The raw mode value that means the polling fallback is active (web `'polling'`).
    public static let pollingMode = "polling"
}

// MARK: - Transport DTOs (the P1/S8 source seam input)

/// The Fleet-Telemetry speed comparison block (web `telemetry.speed_comparison`).
/// Every field is an already-formatted human string on the wire (web renders them
/// verbatim), so they stay `String?` here and fall back to the em-dash when absent.
public struct InfraSpeedComparisonDTO: Sendable, Equatable {
    /// The polling-vs-streaming speedup factor (web `speed_comparison.speedup`).
    public var speedup: String?
    /// The Fleet-Telemetry stream latency (web `speed_comparison.fleet_telemetry_latency`).
    public var fleetTelemetryLatency: String?
    /// The Fleet-API polling interval (web `speed_comparison.fleet_api_polling`).
    public var fleetApiPolling: String?

    public init(
        speedup: String? = nil,
        fleetTelemetryLatency: String? = nil,
        fleetApiPolling: String? = nil
    ) {
        self.speedup = speedup
        self.fleetTelemetryLatency = fleetTelemetryLatency
        self.fleetApiPolling = fleetApiPolling
    }
}

/// The Fleet-Telemetry status envelope (web `getTelemetryStatus()` → `TelemetryStatus`).
/// Only the fields the surface renders are modeled; the source projects the rest away.
public struct InfraTelemetryDTO: Sendable, Equatable {
    /// Whether the SSE / Fleet-Telemetry stream is connected (web `telemetry.enabled`).
    public var enabled: Bool
    /// The active connection mode (web `telemetry.mode`), e.g. "streaming" / "polling".
    public var mode: String
    /// The stream endpoint URL (web `telemetry.endpoint`); empty / nil → em-dash.
    public var endpoint: String?
    /// The wire protocol (web `telemetry.protocol`); empty / nil → em-dash. Named
    /// `protocolName` because `protocol` is a reserved word in Swift.
    public var protocolName: String?
    /// The polling-vs-streaming speed comparison (web `telemetry.speed_comparison`).
    public var speedComparison: InfraSpeedComparisonDTO?

    public init(
        enabled: Bool = false,
        mode: String = "",
        endpoint: String? = nil,
        protocolName: String? = nil,
        speedComparison: InfraSpeedComparisonDTO? = nil
    ) {
        self.enabled = enabled
        self.mode = mode
        self.endpoint = endpoint
        self.protocolName = protocolName
        self.speedComparison = speedComparison
    }
}

/// The database connection-pool snapshot (web `extHealth.database_pool` from
/// `getExtendedHealth()`). Field names mirror the snake_case JSON exactly.
public struct InfraDatabasePoolDTO: Sendable, Equatable {
    /// Total pool connections (web `database_pool.total_conns`).
    public var totalConns: Int
    /// Currently-acquired connections (web `database_pool.acquired_conns`).
    public var acquiredConns: Int
    /// Currently-idle connections (web `database_pool.idle_conns`).
    public var idleConns: Int

    public init(totalConns: Int = 0, acquiredConns: Int = 0, idleConns: Int = 0) {
        self.totalConns = totalConns
        self.acquiredConns = acquiredConns
        self.idleConns = idleConns
    }
}

// MARK: - Projected SSE-connection info (web first `<Card>`)

/// The view-ready projection of the "SSE Connection" card: whether the stream is
/// connected (drives the header Wifi icon + the Connection-State badge) plus the
/// endpoint, protocol, and fallback-mode values (web KVList rows).
public struct InfraSSEInfo: Sendable, Equatable {
    /// Whether the stream is connected (web `sseConnected`).
    public var connected: Bool
    /// The stream endpoint, em-dash when absent (web `telemetry?.endpoint ?? '—'`).
    public var endpoint: String
    /// The wire protocol, em-dash when absent (web `telemetry?.protocol ?? '—'`).
    public var protocolName: String
    /// Whether the polling fallback is active — drives the "Fallback Mode" row
    /// ("Yes — Polling" vs "No", web `connectionMode === 'polling'`).
    public var fallbackActive: Bool

    public init(connected: Bool, endpoint: String, protocolName: String, fallbackActive: Bool) {
        self.connected = connected
        self.endpoint = endpoint
        self.protocolName = protocolName
        self.fallbackActive = fallbackActive
    }
}

// MARK: - Projected polling-engine info (web second `<Card>`)

/// The view-ready projection of the "Polling Engine" card: whether polling is active
/// (drives the Active/Standby badge) plus the raw mode and the three speed-comparison
/// values (web KVList rows).
public struct InfraPollingInfo: Sendable, Equatable {
    /// Whether the polling engine is active (web `connectionMode === 'polling'`).
    public var active: Bool
    /// The raw connection mode, shown verbatim (web `value: connectionMode`).
    public var mode: String
    /// The speedup factor, em-dash when absent (web `speed_comparison?.speedup ?? '—'`).
    public var speedup: String
    /// The Fleet-Telemetry latency, em-dash when absent.
    public var fleetTelemetryLatency: String
    /// The Fleet-API polling interval, em-dash when absent.
    public var fleetApiPolling: String

    public init(
        active: Bool,
        mode: String,
        speedup: String,
        fleetTelemetryLatency: String,
        fleetApiPolling: String
    ) {
        self.active = active
        self.mode = mode
        self.speedup = speedup
        self.fleetTelemetryLatency = fleetTelemetryLatency
        self.fleetApiPolling = fleetApiPolling
    }
}

// MARK: - Database-pool metric tile (web `<InlineMetric>` grid)

/// The three database-pool metrics the web renders as a `Grid` of `<InlineMetric>`s.
/// The raw value carries the metric identity; the label + SF Symbol + tone live here
/// so the view stays declarative (web `<InlineMetric icon value label>` per metric).
public enum InfraPoolMetric: String, Sendable, Equatable, CaseIterable, Identifiable {
    case totalConns
    case acquired
    case idle

    public var id: String {
        rawValue
    }

    /// The i18n key + English fallback (web `t('Total Conns')` etc.).
    public var labelKey: String {
        switch self {
        case .totalConns: "Total Conns"
        case .acquired: "Acquired"
        case .idle: "Idle"
        }
    }

    /// The SF Symbol mirroring the web lucide icon (Database / Activity / Clock).
    public var symbol: String {
        switch self {
        case .totalConns: "cylinder.split.1x2"
        case .acquired: "waveform.path.ecg"
        case .idle: "clock"
        }
    }

    /// The accent tone mirroring the web icon color (cyan / green / amber).
    public var tone: InfraMetricTone {
        switch self {
        case .totalConns: .accent
        case .acquired: .success
        case .idle: .warning
        }
    }
}

/// The semantic tone of a database-pool metric icon — the native parity of the web
/// `text-cyan-400` / `text-green-400` / `text-amber-400` icon colors.
public enum InfraMetricTone: String, Sendable, Equatable {
    case accent
    case success
    case warning
}

/// One projected database-pool tile: the metric + its locale-formatted integer value
/// (web `fmtInt(database_pool.<field>)`).
public struct InfraPoolStat: Sendable, Equatable, Identifiable {
    public var metric: InfraPoolMetric
    public var value: String

    public var id: String {
        metric.rawValue
    }

    public init(metric: InfraPoolMetric, value: String) {
        self.metric = metric
        self.value = value
    }
}
