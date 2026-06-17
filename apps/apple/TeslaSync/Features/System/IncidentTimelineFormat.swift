import SwiftUI

// Render-boundary helpers for the incident post-mortem surface — the SwiftUI parity of the web
// page's local `fmtDuration`, its `useDateFormat().formatDateTime` usages, and its `SEVERITY_TONE` /
// `STATUS_BADGE` maps. All pure `static` members (no stored formatter globals) so they are
// concurrency-safe under Swift 6 `complete` mode. The page renders no SI measurements (it shows
// timestamps + derived durations only), so no `Units` conversion is involved.
enum IncidentTimelineFormat {
    // MARK: - Duration (web local `fmtDuration`)

    /// Web `fmtDuration(startIso, endIso?)`: the elapsed time clamped at zero (web `Math.max(0, …)`),
    /// formatted as `{s}s` under a minute, `{m}m` under an hour, `{h}h {m}m` under a day, else
    /// `{d}d {h}h`. `end == nil` measures against `now` (web `Date.now()`), so an open incident's
    /// "Open · …" badge counts up.
    static func duration(from start: Date, to end: Date? = nil, now: Date = Date()) -> String {
        let endInstant = end ?? now
        let seconds = max(0, Int(endInstant.timeIntervalSince(start)))
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m" }
        if seconds < 86_400 { return "\(seconds / 3600)h \((seconds % 3600) / 60)m" }
        return "\(seconds / 86_400)d \((seconds % 86_400) / 3600)h"
    }

    // MARK: - Absolute timestamp (web `useDateFormat().formatDateTime`)

    /// Web `fmtAbs(iso)` — the locale absolute date + time the "Started …" line and each timeline
    /// entry render (web `formatDateTime`). Abbreviated date with a short time, matching the web
    /// `Intl.DateTimeFormat` default the hook produces.
    static func dateTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    // MARK: - Severity glyph + color (web `SEVERITY_TONE`)

    /// The SF Symbol for a severity — the native mirror of the web `SEVERITY_TONE` icon map
    /// (minor = AlertCircle, major = AlertTriangle, critical = AlertOctagon), filled for status-glyph
    /// presence consistent with the app's incident iconography (sibling `IncidentsCard`).
    static func severitySymbolName(_ severity: IncidentSeverity) -> String {
        switch severity {
        case .minor: "exclamationmark.circle.fill"
        case .major: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }

    /// The severity color — the native escalation of the web amber → orange → red ramp
    /// (`SEVERITY_TONE`: minor = amber-300, major = orange-300, critical = red-400), built from the
    /// semantic tokens so it adapts to light / dark / high-contrast. The "major" orange is the
    /// perceptual blend of the warning + danger tokens (the same treatment the sibling
    /// `IncidentsCard` uses for its "elevated" rank).
    static func severityColor(_ severity: IncidentSeverity) -> Color {
        switch severity {
        case .minor: Color.TS.statusWarning
        case .major: Color.TS.statusWarning.mix(with: Color.TS.statusDanger, by: 0.5)
        case .critical: Color.TS.statusDanger
        }
    }

    // MARK: - Status badge tone (web `STATUS_BADGE`)

    /// The shared `TSBadge` tone a status renders as — the native form of the web `STATUS_BADGE`
    /// variant map (investigating = danger, identified = warning, monitoring = info, resolved =
    /// success).
    static func statusTone(_ status: IncidentStatus) -> TSTone {
        switch status {
        case .investigating: .danger
        case .identified: .warning
        case .monitoring: .info
        case .resolved: .success
        }
    }
}
