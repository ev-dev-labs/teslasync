//
//  BackendStatusSection.Projection.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  The pure projection + formatting + accessibility core for the "Backend Status"
//  surface — split out of `.Adapter` (which holds the DTOs + status classification
//  + projected row/tile/kv types) so each file stays focused and within the lint
//  length budget. Everything here is Foundation-only and dependency-free, so the
//  load-status → phase resolution, the row / pool-tile / runtime-kv projections,
//  the web number / date / uptime formatters, and the VoiceOver summaries are all
//  unit-tested without a bundle or a rendered view. See `.Adapter` for the input
//  DTOs and `BackendComponentStatus` tone classification this builds on.
//

import Foundation

// MARK: - Load status + connection + render phase

/// The bound source's load status for the composed health/pool reads (web
/// `extLoading || poolLoading` / resolved / failure), projected by `resolvePhase`.
public enum BackendLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): the health/pool/version reads refetch on an
/// interval, so a snapshot can go `stale` (auto-refresh nudge) or `offline`
/// (cached values stay visible behind an offline chip).
public enum BackendConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web always renders the three-section
/// frame; the prompt widens that with loading / error envelopes and a friendly
/// `empty` state when there is genuinely nothing (no components, pool, or runtime).
public enum BackendPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the composed DTOs to view-ready rows + a
/// render phase. A faithful port of the web component's reads of `extHealth`,
/// `pool`, and `version`.
public enum BackendStatusProjection {
    /// View-ready component rows, preserving the source order exactly like the web
    /// `Object.entries(extHealth.components).map(...)`.
    public static func componentRows(from components: [ComponentHealthDTO]) -> [BackendComponentRow] {
        components.map { component in
            BackendComponentRow(
                name: component.name,
                status: component.status,
                tone: BackendComponentStatus.tone(component.status),
                latencyMs: component.latencyMs,
                failures: component.consecutiveFailures,
                lastCheckISO: (component.lastCheck?.isEmpty ?? true) ? nil : component.lastCheck
            )
        }
    }

    /// The count of healthy components (web `okCount`) — `status === 'ok' || 'healthy'`.
    public static func okCount(_ rows: [BackendComponentRow]) -> Int {
        rows.count(where: { BackendComponentStatus.isOK($0.status) })
    }

    /// The five connection-pool tiles with locale-formatted integer values
    /// (web `fmtInt(pool.maxOpen)` … `fmtInt(pool.waitCount)`).
    public static func poolStats(from pool: ConnectionPoolDTO, locale: Locale = .current) -> [BackendPoolStat] {
        let values: [BackendPoolMetric: Int] = [
            .maxOpen: pool.maxOpen,
            .open: pool.open,
            .inUse: pool.inUse,
            .idle: pool.idle,
            .waitCount: pool.waitCount
        ]
        return BackendPoolMetric.allCases.map { metric in
            BackendPoolStat(metric: metric, value: BackendStatusFormat.int(values[metric] ?? 0, locale: locale))
        }
    }

    /// The four system-runtime key/values, resolving version-then-system fallbacks
    /// exactly like the web (`version?.x ?? extHealth?.system?.x ?? default`).
    public static func runtimeRows(
        version: VersionDTO?,
        system: SystemInfoDTO?,
        locale: Locale = .current
    ) -> [BackendRuntimeRow] {
        let goVersion = version?.goVersion ?? system?.goVersion ?? BackendStatusDisplay.emDash
        let uptime = version?.uptimeSeconds ?? system?.uptimeSeconds ?? 0
        let goroutines = version?.goroutines ?? system?.goroutines ?? 0
        let osArch = version.map { "\($0.os) / \($0.arch)" } ?? BackendStatusDisplay.emDash
        return [
            BackendRuntimeRow(labelKey: "Go Version", value: goVersion),
            BackendRuntimeRow(labelKey: "Uptime", value: BackendStatusFormat.uptime(uptime)),
            BackendRuntimeRow(labelKey: "Goroutines", value: BackendStatusFormat.int(goroutines, locale: locale)),
            BackendRuntimeRow(labelKey: "OS / Arch", value: osArch)
        ]
    }

    /// Whether the surface has any system-runtime info to show — the web
    /// `(extHealth?.system || version)` guard on the "System Runtime" section.
    public static func hasRuntime(version: VersionDTO?, system: SystemInfoDTO?) -> Bool {
        version != nil || system != nil
    }

    /// Resolves the render phase from the load status and whether any of the three
    /// content sections has data. `content` shows the section frame (each section
    /// owns its own inner empty handling); `empty` is the friendly surface-level
    /// fallback only when there is nothing at all.
    public static func resolvePhase(
        _ status: BackendLoadStatus,
        hasComponents: Bool,
        hasPool: Bool,
        hasRuntime: Bool
    ) -> BackendPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            (hasComponents || hasPool || hasRuntime) ? .content : .empty
        }
    }
}

// MARK: - Formatting (web numberFormat / dateFormat helpers)

/// Locale-aware number, integer, uptime, and date/time formatting — the native
/// parity of the web `fmtNumber` / `fmtInt` / `formatUptime` / `formatDateTime`.
/// Pure + testable: every entry point takes an explicit locale (and the date
/// entry a time zone) and returns the "—" em-dash fallback for missing input.
public enum BackendStatusFormat {
    /// Locale-grouped decimal with a fixed fraction count (web `fmtNumber(v, d)`).
    public static func number(_ value: Double, fractionDigits: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Locale-grouped integer (web `fmtInt(v)` = `fmtNumber(v, 0)`).
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        number(Double(value), fractionDigits: 0, locale: locale)
    }

    /// Latency with the "ms" suffix (web ``${fmtNumber(latency_ms, 1)} ms``).
    public static func latency(_ milliseconds: Double, locale: Locale = .current) -> String {
        "\(number(milliseconds, fractionDigits: 1, locale: locale)) ms"
    }

    /// Humanized uptime (web `formatUptime`): `Dd Hh Mm` when there are whole days,
    /// `Hh Mm` when there are whole hours, else `Mm`.
    public static func uptime(_ seconds: Int) -> String {
        let safe = max(0, seconds)
        let days = safe / 86400
        let hours = (safe % 86400) / 3600
        let minutes = (safe % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h \(minutes)m" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
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

    /// Date + time for the "Last Check" cell (web `formatDateTime` — medium date +
    /// short time). Empty / unparseable / `nil` → em-dash fallback (web `'—'`).
    public static func dateTime(
        _ iso: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let iso, let date = parse(iso) else { return BackendStatusDisplay.emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum BackendStatusSurface {
    public static let slug = "BackendStatusSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum BackendStatusAccessibility {
    /// The section-level summary: the title + the healthy tally, or the friendly
    /// empty message when there is nothing to show.
    public static func sectionSummary(
        componentCount: Int,
        okCount: Int,
        hasPool: Bool,
        hasRuntime: Bool,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("Backend Status", "Backend Status")
        guard componentCount > 0 || hasPool || hasRuntime else {
            return "\(title): \(localize("No backend status available", "No backend status available"))"
        }
        guard componentCount > 0 else { return title }
        let healthy = localize("healthy", "healthy")
        return "\(title): \(okCount)/\(componentCount) \(healthy)"
    }

    /// One component row's combined VoiceOver value: status, name, latency, failures,
    /// and the last check. `latencyText` / `lastCheckText` are the already-formatted
    /// strings the view computed (so this stays pure + deterministically testable).
    public static func componentLabel(
        _ row: BackendComponentRow,
        latencyText: String,
        lastCheckText: String,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = [row.status, row.name]
        parts.append("\(localize("Latency", "Latency")) \(latencyText)")
        parts.append("\(localize("Failures", "Failures")) \(BackendStatusFormat.int(row.failures))")
        parts.append("\(localize("Last Check", "Last Check")) \(lastCheckText)")
        return parts.joined(separator: ", ")
    }
}
