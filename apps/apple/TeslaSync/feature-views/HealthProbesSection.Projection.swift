//
//  HealthProbesSection.Projection.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  The pure projection + formatting + accessibility core for the "Health Probes"
//  surface — split out of `.Adapter` (which holds the DTOs + status classification
//  + projected badge/kv/card types) so each file stays focused and within the lint
//  length budget. Everything here is Foundation-only and dependency-free, so the
//  load-status → phase resolution, the liveness / readiness card projections, the
//  web number / uptime formatters, and the VoiceOver summaries are all unit-tested
//  without a bundle or a rendered view. See `.Adapter` for the input DTOs and the
//  `HealthProbeStatus` variant classification this builds on.
//

import Foundation

// MARK: - Load status + connection + render phase

/// The bound source's load status for the composed health read (web `isLoading` /
/// resolved / `error`), projected by `resolvePhase`.
public enum HealthProbesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): the health read refetches on a 30s interval, so a
/// snapshot can go `stale` (auto-refresh nudge) or `offline` (cached values stay
/// visible behind an offline chip).
public enum HealthProbesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render. The web renders the two probe cards once the read
/// resolves; the prompt widens that with loading / error envelopes and a friendly
/// `empty` state when the resolved snapshot has no health payload at all.
public enum HealthProbesPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the composed health DTO to the two view-ready
/// probe cards, the header badges, and a render phase. A faithful port of the web
/// component's reads of `data.status`, `data.database`, `data.system`, and
/// `data.database_pool`.
public enum HealthProbesProjection {
    /// The Liveness — /healthz card (web first `<Card>`): the liveness status badge +
    /// Status / Goroutines / Uptime rows (web `KVList`).
    public static func livenessCard(
        from health: HealthProbesHealthDTO,
        locale: Locale = .current
    ) -> HealthProbeCard {
        let status = health.status
        let goroutines = health.system?.goroutines ?? 0
        let uptime = health.system?.uptimeSeconds ?? 0
        return HealthProbeCard(
            titleKey: "Liveness — /healthz",
            status: status,
            tone: HealthProbeStatus.variant(status),
            rows: [
                HealthProbeKV(labelKey: "Status", value: status),
                HealthProbeKV(labelKey: "Goroutines", value: HealthProbesFormat.int(goroutines, locale: locale)),
                HealthProbeKV(labelKey: "Uptime", value: HealthProbesFormat.uptime(uptime))
            ]
        )
    }

    /// The Readiness — /readyz card (web second `<Card>`): the database status badge +
    /// Database / Latency / Pool Connections rows. `dbStatus` falls back to the raw
    /// `unknown` value (web `data?.database?.status ?? 'unknown'`).
    public static func readinessCard(
        from health: HealthProbesHealthDTO,
        locale: Locale = .current
    ) -> HealthProbeCard {
        let status = health.database?.status ?? HealthProbesDisplay.unknownStatus
        let latency = health.database?.latencyMs
        let poolConns = health.databasePool?.totalConns ?? 0
        return HealthProbeCard(
            titleKey: "Readiness — /readyz",
            status: status,
            tone: HealthProbeStatus.variant(status),
            rows: [
                HealthProbeKV(labelKey: "Database", value: status),
                HealthProbeKV(labelKey: "Latency", value: HealthProbesFormat.latency(latency, locale: locale)),
                HealthProbeKV(labelKey: "Pool Connections", value: HealthProbesFormat.int(poolConns, locale: locale))
            ]
        )
    }

    /// The two header Live / Ready badges (web `badges` prop), each toned from its
    /// probe status via `statusToBadgeVariant`.
    public static func headerBadges(from health: HealthProbesHealthDTO) -> [HealthProbeBadge] {
        let liveness = health.status
        let readiness = health.database?.status ?? HealthProbesDisplay.unknownStatus
        return [
            HealthProbeBadge(labelKey: "Live", tone: HealthProbeStatus.variant(liveness)),
            HealthProbeBadge(labelKey: "Ready", tone: HealthProbeStatus.variant(readiness))
        ]
    }

    /// Resolves the render phase from the load status and whether the resolved
    /// snapshot carries a health payload. `content` shows the two cards; `empty` is
    /// the friendly fallback when a resolved read has no health at all.
    public static func resolvePhase(_ status: HealthProbesLoadStatus, hasHealth: Bool) -> HealthProbesPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasHealth ? .content : .empty
        }
    }
}

// MARK: - Formatting (web numberFormat helpers)

/// Locale-aware number, integer, latency, and uptime formatting — the native parity
/// of the web `fmtNumber` / `fmtInt` / `formatUptime` and the `'—'` latency fallback.
/// Pure + testable: each entry point takes an explicit locale.
public enum HealthProbesFormat {
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

    /// Latency with the "ms" suffix (web ``${fmtNumber(dbLatency, 1)} ms``), or the
    /// em-dash when the probe omits a latency (web `dbLatency != null ? … : '—'`).
    public static func latency(_ milliseconds: Double?, locale: Locale = .current) -> String {
        guard let milliseconds else { return HealthProbesDisplay.emDash }
        return "\(number(milliseconds, fractionDigits: 1, locale: locale)) ms"
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
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum HealthProbesSurface {
    public static let slug = "HealthProbesSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum HealthProbesAccessibility {
    /// The section-level summary: the title + the Live / Ready statuses, or the
    /// friendly empty message when there is no health snapshot.
    public static func sectionSummary(
        hasHealth: Bool,
        livenessStatus: String,
        readinessStatus: String,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("Health Probes", "Health Probes")
        guard hasHealth else {
            return "\(title): \(localize("No health data available", "No health data available"))"
        }
        let live = localize("Live", "Live")
        let ready = localize("Ready", "Ready")
        return "\(title): \(live) \(livenessStatus), \(ready) \(readinessStatus)"
    }

    /// One probe card's combined VoiceOver value: the title, the status, then each
    /// key/value line.
    public static func cardLabel(
        _ card: HealthProbeCard,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = [localize(card.titleKey, card.titleKey), card.status]
        for row in card.rows {
            parts.append("\(localize(row.labelKey, row.labelKey)) \(row.value)")
        }
        return parts.joined(separator: ", ")
    }
}
