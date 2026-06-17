//
//  DataExportFormatters.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Display formatters
//
//  Pure, testable display-boundary formatters ported 1:1 from the web helpers the
//  page uses: `formatBytes` / `fmtInt` (web/src/lib/numberFormat.ts),
//  `formatRelative` / `formatDurationMsLong` (web/src/lib/dateFormat.ts), and the
//  wizard's `daysAgo` date math. These render control-plane values (bytes, counts,
//  durations) — no SI conversion applies (ADR-005's display boundary is for
//  unit-bearing values only).
//

import Foundation

/// Display formatters for the Data Export surface.
enum DataExportDisplay {
    /// The em-dash shown for nil / unrenderable values (web universal `'—'`).
    static let emptyValue = "—"

    // MARK: Bytes (web `formatBytes(bytes, { zeroAsEmpty, gbDecimals })`)

    /// Web `formatBytes`: `—` for nil / non-finite (and for `0` when `zeroAsEmpty`);
    /// `<n> B` below 1 KiB; then 1-decimal KB / MB; GB uses `gbDecimals` (web passes 2).
    static func bytes(_ value: Int64?, zeroAsEmpty: Bool = false, gbDecimals: Int = 1) -> String {
        guard let value else { return emptyValue }
        return bytes(Double(value), zeroAsEmpty: zeroAsEmpty, gbDecimals: gbDecimals)
    }

    static func bytes(_ value: Double, zeroAsEmpty: Bool = false, gbDecimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        if zeroAsEmpty, value == 0 { return emptyValue }
        let kib = 1024.0
        let mib = kib * 1024
        let gib = mib * 1024
        if value < kib { return "\(Int64(value)) B" }
        if value < mib { return String(format: "%.1f KB", value / kib) }
        if value < gib { return String(format: "%.1f MB", value / mib) }
        return String(format: "%.\(max(0, gbDecimals))f GB", value / gib)
    }

    // MARK: Integers (web `fmtInt` — grouped thousands)

    /// Web `fmtInt(n)`: locale-grouped integer; `—` for nil (web `fmtInt` helper here
    /// returns `'—'` for null in the page's local wrapper).
    static func int(_ value: Int?) -> String {
        guard let value else { return emptyValue }
        return value.formatted(.number.grouping(.automatic))
    }

    // MARK: Relative time (web `formatRelative(iso)`)

    /// Web `formatRelative`: `—` for nil / unparseable; a localized "just now" under
    /// 60s; an absolute medium date at / beyond 7 days; otherwise a system-localized
    /// relative phrase (HIG-native `RelativeDateTimeFormatter`, the Apple-idiomatic
    /// equivalent of the web's hand-rolled `Xm/Xh/Xd ago`).
    static func relative(_ iso: String?, now: Date = Date()) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 {
            return String(localized: "dataExport.relative.justNow", defaultValue: "just now")
        }
        if seconds >= 7 * 24 * 3600 {
            return date.formatted(date: .abbreviated, time: .omitted)
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }

    // MARK: Duration (web `formatDurationMsLong(ms)`)

    /// Web `formatDurationMsLong`: `—` for nil / non-positive; `<n>ms` < 1s;
    /// `<n.n>s` < 60s; otherwise `<m>m <s>s`.
    static func durationMsLong(_ value: Int?) -> String {
        guard let value, value > 0 else { return emptyValue }
        if value < 1000 { return "\(value)ms" }
        let sec = Double(value) / 1000
        if sec < 60 { return String(format: "%.1fs", sec) }
        let minutes = Int(sec / 60)
        let remainder = (Int(sec.rounded()) % 60)
        return "\(minutes)m \(remainder)s"
    }

    // MARK: Absolute timestamp (web `<TimeStamp value={...} />`)

    /// Medium date + short time in the user's locale; `—` for nil / unparseable.
    static func dateTime(_ iso: String?) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    // MARK: Wizard date math (web `daysAgo` / `new Date().toISOString().split('T')[0]`)

    /// Web `daysAgo(days)`: the `yyyy-MM-dd` date `days` before `reference` (UTC).
    static func daysAgo(_ days: Int, reference: Date = Date()) -> String {
        let date = Calendar.current.date(byAdding: .day, value: -days, to: reference) ?? reference
        return isoDateOnly(date)
    }

    /// Web `new Date().toISOString().split('T')[0]` — the `yyyy-MM-dd` UTC day.
    static func today(_ reference: Date = Date()) -> String {
        isoDateOnly(reference)
    }

    /// Web `new Date(date).toISOString()` — a full ISO-8601 UTC instant for a day.
    static func isoInstant(fromDay day: String) -> String? {
        guard let date = makeDayFormatter().date(from: day) else { return nil }
        return ISO8601DateFormatter().string(from: date)
    }

    // MARK: Download URL (web `/api/v1/export/jobs/${id}/download`)

    /// Web `window.open('/api/v1/export/jobs/${job.id}/download')` relative href.
    static func downloadHref(_ jobID: String) -> String {
        "/api/v1/export/jobs/\(jobID)/download"
    }

    // MARK: Parsing helpers

    /// Parses a backend ISO-8601 UTC timestamp, tolerating fractional seconds.
    static func parseISO(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    private static func isoDateOnly(_ date: Date) -> String {
        makeDayFormatter().string(from: date)
    }

    /// A fresh `yyyy-MM-dd` UTC formatter. Created per call (rather than cached in a
    /// static) so the type stays free of non-`Sendable` global mutable state under
    /// Swift 6 strict concurrency; these are cold display paths.
    private static func makeDayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}
