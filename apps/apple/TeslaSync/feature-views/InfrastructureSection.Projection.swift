//
//  InfrastructureSection.Projection.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  The pure projection + formatting + accessibility core for the "Infrastructure"
//  surface — split out of `.Adapter` (which holds the DTOs + projected row/tile
//  types) so each file stays focused and within the lint length budget. Everything
//  here is Foundation-only and dependency-free, so the load-status → phase
//  resolution, the SSE / polling / pool projections, the web `fmtInt` formatter, and
//  the VoiceOver summaries are all unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Load status + connection + render phase

/// The bound source's load status for the composed telemetry/health reads (web
/// `useQuery` loading / resolved / failure), projected by `resolvePhase`.
public enum InfraLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): the telemetry (2s) and health (30s) reads refetch
/// on an interval, so a snapshot can go `stale` (auto-refresh nudge) or `offline`
/// (cached values stay visible behind an offline chip). Distinct from the SSE-stream
/// connected/disconnected DATA, which is `InfraTelemetryDTO.enabled`.
public enum InfraConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web always renders the two cards; the prompt
/// widens that with loading / error envelopes and a friendly `empty` state when there
/// is genuinely nothing (no telemetry read AND no database pool).
public enum InfraPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the composed DTOs to view-ready info + a render
/// phase. A faithful port of the web component's reads of `telemetry` and `extHealth`.
public enum InfrastructureProjection {
    /// Whether the SSE / Fleet-Telemetry stream is connected (web `telemetry?.enabled
    /// ?? false`).
    public static func sseConnected(_ telemetry: InfraTelemetryDTO?) -> Bool {
        telemetry?.enabled ?? false
    }

    /// The active connection mode (web `telemetry?.mode ?? 'unknown'`). An empty mode
    /// is treated as unknown so the row never renders a blank value.
    public static func connectionMode(_ telemetry: InfraTelemetryDTO?) -> String {
        guard let mode = telemetry?.mode, !mode.isEmpty else { return InfrastructureDisplay.unknownMode }
        return mode
    }

    /// Whether the polling fallback is active (web `connectionMode === 'polling'`).
    public static func pollingActive(_ telemetry: InfraTelemetryDTO?) -> Bool {
        connectionMode(telemetry) == InfrastructureDisplay.pollingMode
    }

    /// The "SSE Connection" card projection (web first `<Card>`): connection flag +
    /// endpoint / protocol / fallback rows, each with the em-dash fallback.
    public static func sseInfo(from telemetry: InfraTelemetryDTO?) -> InfraSSEInfo {
        InfraSSEInfo(
            connected: sseConnected(telemetry),
            endpoint: dash(telemetry?.endpoint),
            protocolName: dash(telemetry?.protocolName),
            fallbackActive: pollingActive(telemetry)
        )
    }

    /// The "Polling Engine" card projection (web second `<Card>`): the active flag, the
    /// raw mode (shown verbatim), and the three speed-comparison rows.
    public static func pollingInfo(from telemetry: InfraTelemetryDTO?) -> InfraPollingInfo {
        let comparison = telemetry?.speedComparison
        return InfraPollingInfo(
            active: pollingActive(telemetry),
            mode: connectionMode(telemetry),
            speedup: dash(comparison?.speedup),
            fleetTelemetryLatency: dash(comparison?.fleetTelemetryLatency),
            fleetApiPolling: dash(comparison?.fleetApiPolling)
        )
    }

    /// The three database-pool tiles with locale-formatted integer values (web
    /// `fmtInt(database_pool.total_conns)` … `idle_conns`), or `nil` when there is no
    /// pool snapshot (web `{extHealth?.database_pool && …}` — the row is omitted).
    public static func poolStats(from pool: InfraDatabasePoolDTO?, locale: Locale = .current) -> [InfraPoolStat]? {
        guard let pool else { return nil }
        let values: [InfraPoolMetric: Int] = [
            .totalConns: pool.totalConns,
            .acquired: pool.acquiredConns,
            .idle: pool.idleConns
        ]
        return InfraPoolMetric.allCases.map { metric in
            InfraPoolStat(metric: metric, value: InfrastructureFormat.int(values[metric] ?? 0, locale: locale))
        }
    }

    /// Resolves the render phase from the load status and whether there is any content
    /// (a telemetry read or a database pool). `content` shows the two-card frame (each
    /// card owns its em-dash fallbacks); `empty` is the friendly surface-level fallback
    /// only when there is nothing at all.
    public static func resolvePhase(
        _ status: InfraLoadStatus,
        hasTelemetry: Bool,
        hasPool: Bool
    ) -> InfraPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            (hasTelemetry || hasPool) ? .content : .empty
        }
    }

    /// Maps a nil / empty string to the em-dash, else the trimmed-of-nothing raw value
    /// (web `value ?? '—'`, extended to treat an empty string as absent for a clean UI).
    static func dash(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return InfrastructureDisplay.emDash }
        return value
    }
}

// MARK: - Formatting (web numberFormat helper)

/// Locale-aware integer formatting — the native parity of the web `fmtInt`. Pure +
/// testable: the entry point takes an explicit locale and groups thousands.
public enum InfrastructureFormat {
    /// Locale-grouped integer (web `fmtInt(v)` = `fmtNumber(v, 0)`).
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum InfrastructureSurface {
    public static let slug = "InfrastructureSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle,
/// exactly like the view's P1/S10 facade.
public enum InfrastructureAccessibility {
    /// The section-header summary: the title + the SSE connected/disconnected state,
    /// or the friendly empty message when there is nothing to show.
    public static func sectionSummary(
        hasContent: Bool,
        sseConnected: Bool,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("Infrastructure", "Infrastructure")
        guard hasContent else {
            return "\(title): \(localize("No Infrastructure Message", "No infrastructure data available"))"
        }
        let state = sseConnected
            ? localize("Connected", "Connected")
            : localize("Disconnected", "Disconnected")
        return "\(title): \(state)"
    }

    /// One SSE-connection card's combined VoiceOver value: the connection state plus
    /// the endpoint, protocol, and fallback-mode lines.
    public static func sseLabel(
        _ info: InfraSSEInfo,
        localize: (String, String) -> String
    ) -> String {
        let state = info.connected
            ? localize("Connected", "Connected")
            : localize("Disconnected", "Disconnected")
        let fallback = info.fallbackActive
            ? localize("Yes — Polling", "Yes — Polling")
            : localize("No", "No")
        var parts = ["\(localize("SSE Connection", "SSE Connection")): \(state)"]
        parts.append("\(localize("Endpoint", "Endpoint")) \(info.endpoint)")
        parts.append("\(localize("Protocol", "Protocol")) \(info.protocolName)")
        parts.append("\(localize("Fallback Mode", "Fallback Mode")) \(fallback)")
        return parts.joined(separator: ", ")
    }

    /// One polling-engine card's combined VoiceOver value: the active/standby state
    /// plus the mode and the three speed-comparison lines.
    public static func pollingLabel(
        _ info: InfraPollingInfo,
        localize: (String, String) -> String
    ) -> String {
        let state = info.active
            ? localize("Active", "Active")
            : localize("Standby", "Standby")
        var parts = ["\(localize("Polling Engine", "Polling Engine")): \(state)"]
        parts.append("\(localize("Mode", "Mode")) \(info.mode)")
        parts.append("\(localize("Speed Comparison", "Speed Comparison")) \(info.speedup)")
        parts.append("\(localize("Fleet Telemetry Latency", "Fleet Telemetry Latency")) \(info.fleetTelemetryLatency)")
        parts.append("\(localize("Fleet API Polling", "Fleet API Polling")) \(info.fleetApiPolling)")
        return parts.joined(separator: ", ")
    }
}
