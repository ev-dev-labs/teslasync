//
//  IncidentsCard.Adapter.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  The testable projection core for the active-incidents block — the faithful port of
//  features/system/components/status/IncidentsCard.tsx. The web component derives a few
//  pure things from each `Incident`: the severity tone + icon (its `SEVERITY_TONE` map),
//  the status badge variant (its `STATUS_BADGE` map), the relative "Started …" label (its
//  `relativeFrom(now, iso)` helper), the "Affects: a, b" line (guarded by
//  `affected_components.length > 0`), and the "· N updates" suffix (guarded by
//  `updates.length > 1`).
//
//  Everything here is pure + dependency-free (Foundation only — no SwiftUI, no view state)
//  so each rule is unit-tested without a bundle, a seam, or a rendered view: the render-phase
//  resolution, the relative-time formatter, the affects + metadata lines, the severity icon
//  + escalation rank, the status badge tone, the localized severity/status option text, and
//  the accessibility builders. All user-facing copy is carried as `LocalizedText`
//  descriptors resolved at the display boundary through the P1/S10 facade, so the view holds
//  no hardcoded literal. The escalation `rank` and badge `tone` are pure value enums mapped
//  to a design-system color in `IncidentsCard.Views.swift`, keeping this core view-free.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `IncidentsCard` surface. The slug is emitted
/// with the P1/S11 `view.opened` contract and referenced by the view + tests so the two
/// never drift.
public enum IncidentsCardSurface {
    public static let slug = "IncidentsCard"

    /// Reports the surface becoming visible. Factored out of the view's lifecycle so it is
    /// unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any IncidentsCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Severity escalation rank (web amber → orange → red)

/// The visual escalation step for a severity, mapped to a design-system color in the view.
/// Mirrors the web `SEVERITY_TONE` color ramp (minor = amber-300, major = orange-300,
/// critical = red-400) within the native semantic-token system, kept as a pure value here so
/// the ramp is unit-testable and the core stays SwiftUI-free.
public enum IncidentSeverityRank: Sendable, Equatable {
    case caution
    case elevated
    case critical
}

// MARK: - Badge tone (web `STATUS_BADGE`)

/// The tone of a status badge — the pure native form of the web `STATUS_BADGE` variant map.
/// Mapped to the shared `TSBadge` tone in the view; kept as a value enum so the mapping is
/// unit-tested without rendering.
public enum IncidentBadgeTone: Sendable, Equatable {
    case danger
    case warning
    case info
    case success
}

// MARK: - Localized copy descriptors (web literals + native read-state chrome)

/// Every user-facing string the surface renders, as `LocalizedText` (key + web English
/// fallback). The web source holds its copy as literals (its only hook is `useIncidents`);
/// routing them through descriptors keeps the native view free of hardcoded copy while
/// reproducing the web wording verbatim. The read-state chrome (loading / empty / error /
/// freshness) the prompt requires is added as native-only — but still localized — keys.
public enum IncidentsCardText {
    // Card chrome (web header)
    public static let title = LocalizedText("status.incidents.title", "Active incidents")
    public static let logCta = LocalizedText("status.incidents.logCta", "Log incident")
    public static let surfaceA11y = LocalizedText("status.incidents.surfaceA11y", "Active incidents")

    // Row metadata (web "Affects:" / "Started …" / "· N updates")
    public static let affects = LocalizedText("status.incidents.affects", "Affects: {{components}}")
    public static let started = LocalizedText("status.incidents.started", "Started {{time}}")
    public static let updates = LocalizedText("status.incidents.updates", "{{count}} updates")

    // Relative time (web `relativeFrom`)
    public static let relativeJustNow = LocalizedText("status.incidents.relative.justNow", "just now")
    public static let relativeMinutes = LocalizedText("status.incidents.relative.minutes", "{{count}}m ago")
    public static let relativeHours = LocalizedText("status.incidents.relative.hours", "{{count}}h ago")
    public static let relativeDays = LocalizedText("status.incidents.relative.days", "{{count}}d ago")

    // Read states (native — the prompt's loading / empty / error)
    public static let loading = LocalizedText("status.incidents.loading", "Loading incidents…")
    public static let emptyTitle = LocalizedText("status.incidents.empty.title", "No active incidents")
    public static let emptyMessage = LocalizedText(
        "status.incidents.empty.message",
        "All systems operational. Active incidents will appear here."
    )
    public static let errorTitle = LocalizedText("status.incidents.error.title", "Failed to load incidents.")
    public static let retry = LocalizedText("status.incidents.retry", "Retry")

    // Freshness chip + connectivity banner (ADR-013)
    public static let live = LocalizedText("status.incidents.live", "Live")
    public static let stale = LocalizedText("status.incidents.stale", "Stale")
    public static let offline = LocalizedText("status.incidents.offline", "Offline")
    public static let staleBanner = LocalizedText(
        "status.incidents.staleBanner",
        "Reconnecting — this list may be out of date"
    )
    public static let offlineBanner = LocalizedText(
        "status.incidents.offlineBanner",
        "Offline — showing the last loaded incidents"
    )

    // Accessibility (count + per-row summary)
    public static let countA11y = LocalizedText("status.incidents.a11y.count", "{{count}} active")
    public static let rowStatusA11y = LocalizedText("status.incidents.a11y.rowStatus", "status {{status}}")

    /// The severity label (web `tone.label`: lowercase "minor" / "major" / "critical").
    public static func severity(_ severity: IncidentSeverity) -> LocalizedText {
        switch severity {
        case .minor: LocalizedText("status.incidents.severity.minor", "minor")
        case .major: LocalizedText("status.incidents.severity.major", "major")
        case .critical: LocalizedText("status.incidents.severity.critical", "critical")
        }
    }

    /// The status label (web `inc.status`: lowercase lifecycle state shown in the badge).
    public static func status(_ status: IncidentStatus) -> LocalizedText {
        switch status {
        case .investigating: LocalizedText("status.incidents.status.investigating", "investigating")
        case .identified: LocalizedText("status.incidents.status.identified", "identified")
        case .monitoring: LocalizedText("status.incidents.status.monitoring", "monitoring")
        case .resolved: LocalizedText("status.incidents.status.resolved", "resolved")
        }
    }
}

// MARK: - Pure projections (phase, relative time, lines, tones, icons)

/// The pure, view-free transforms for the incidents card. Mirrors the web row plumbing +
/// the `relativeFrom` / `SEVERITY_TONE` / `STATUS_BADGE` maps so each rule is unit-tested
/// without a model or a rendered view.
public enum IncidentsCardAdapter {
    /// Resolves the top-level render phase from the bound source's load status + the row
    /// count. The web source renders the list when rows exist and otherwise collapses; the
    /// native phase widens that with the prompt-required loading / empty / error envelopes,
    /// while cached rows survive a refresh / failure (the list stays, freshness + reload
    /// failures surfaced by the chip / banner).
    public static func resolvePhase(status: IncidentsLoadStatus, incidentCount: Int) -> IncidentsCardPhase {
        let hasRows = incidentCount > 0
        switch status {
        case .loading:
            return hasRows ? .content : .loading
        case .loaded:
            return hasRows ? .content : .empty
        case let .failed(message):
            return hasRows ? .content : .error(message)
        }
    }

    /// The relative "Started …" time — a faithful port of the web `relativeFrom(now, iso)`:
    /// `< 60s` → "just now", `< 1h` → "{m}m ago", `< 1d` → "{h}h ago", else "{d}d ago", with
    /// the elapsed seconds clamped at zero (web `Math.max(0, …)`) so a future timestamp reads
    /// "just now".
    public static func relativeTime(
        now: Date,
        from start: Date,
        localize: (LocalizedText) -> String
    ) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        if seconds < 60 {
            return localize(IncidentsCardText.relativeJustNow)
        }
        if seconds < 3600 {
            return fill(localize(IncidentsCardText.relativeMinutes), count: seconds / 60)
        }
        if seconds < 86400 {
            return fill(localize(IncidentsCardText.relativeHours), count: seconds / 3600)
        }
        return fill(localize(IncidentsCardText.relativeDays), count: seconds / 86400)
    }

    /// The "Affects: a, b" line, or `nil` when there are no affected components (web
    /// `affected_components.length > 0` guard). Components are product identifiers joined by
    /// a comma-space, exactly as the web `affected_components.join(', ')`.
    public static func affectsLine(
        _ components: [String],
        localize: (LocalizedText) -> String
    ) -> String? {
        let names = components
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !names.isEmpty else { return nil }
        return localize(IncidentsCardText.affects)
            .replacingOccurrences(of: "{{components}}", with: names.joined(separator: ", "))
    }

    /// The "Started {relative}" metadata line, with the "· N updates" suffix appended only
    /// when there is more than one update (web `inc.updates.length > 1`).
    public static func metadataLine(
        now: Date,
        startedAt: Date,
        updateCount: Int,
        localize: (LocalizedText) -> String
    ) -> String {
        let relative = relativeTime(now: now, from: startedAt, localize: localize)
        let started = localize(IncidentsCardText.started)
            .replacingOccurrences(of: "{{time}}", with: relative)
        guard updateCount > 1 else { return started }
        let updates = fill(localize(IncidentsCardText.updates), count: updateCount)
        return "\(started) · \(updates)"
    }

    /// The SF Symbol for a severity — the native mirror of the web `SEVERITY_TONE` icon map
    /// (minor = circle, major = triangle, octagon = critical), filled for status-glyph
    /// presence per the app's iconography.
    public static func severitySymbolName(_ severity: IncidentSeverity) -> String {
        switch severity {
        case .minor: "exclamationmark.circle.fill"
        case .major: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }

    /// The escalation rank for a severity (web amber → orange → red), mapped to a color in
    /// the view.
    public static func severityRank(_ severity: IncidentSeverity) -> IncidentSeverityRank {
        switch severity {
        case .minor: .caution
        case .major: .elevated
        case .critical: .critical
        }
    }

    /// The status badge tone — the native form of the web `STATUS_BADGE` map
    /// (investigating = danger, identified = warning, monitoring = info, resolved = success).
    public static func statusTone(_ status: IncidentStatus) -> IncidentBadgeTone {
        switch status {
        case .investigating: .danger
        case .identified: .warning
        case .monitoring: .info
        case .resolved: .success
        }
    }

    /// Substitutes the `{{count}}` token in a relative/updates template with the number.
    private static func fill(_ template: String, count: Int) -> String {
        template.replacingOccurrences(of: "{{count}}", with: String(count))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver labels + stable identifiers for the surface. Pure + public so the
/// spoken content / automation IDs can be unit-tested without rendering the view.
public enum IncidentsCardAccessibility {
    /// Stable automation identifiers (web `data-testid` analogues).
    public static let logCtaID = "incidents-log-cta"

    /// The per-row automation identifier (one per incident id).
    public static func rowID(_ id: Int64) -> String {
        "incidents-row-\(id)"
    }

    /// The card's spoken label: the title plus the active count (web header + count badge).
    public static func cardLabel(count: Int, localize: (LocalizedText) -> String) -> String {
        let active = localize(IncidentsCardText.countA11y)
            .replacingOccurrences(of: "{{count}}", with: String(count))
        return "\(localize(IncidentsCardText.title)), \(active)"
    }

    /// One row's spoken label — the severity, title, status, the "Started …" metadata, and
    /// the affected components, composed from the already-localized pieces so a row reads as
    /// a single coherent sentence to VoiceOver.
    public static func rowLabel(
        _ incident: ActiveIncident,
        now: Date,
        localize: (LocalizedText) -> String
    ) -> String {
        var parts: [String] = [
            localize(IncidentsCardText.severity(incident.severity)),
            incident.title,
            localize(IncidentsCardText.rowStatusA11y)
                .replacingOccurrences(of: "{{status}}", with: localize(IncidentsCardText.status(incident.status))),
            IncidentsCardAdapter.metadataLine(
                now: now,
                startedAt: incident.startedAt,
                updateCount: incident.updateCount,
                localize: localize
            )
        ]
        if let affects = IncidentsCardAdapter.affectsLine(incident.affectedComponents, localize: localize) {
            parts.append(affects)
        }
        return parts.joined(separator: ", ")
    }
}
