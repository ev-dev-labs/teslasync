//
//  CronParser.Adapter.swift
//  TeslaSync — P4 feature view · 0014 · CronParser (Apple)
//
//  The pure, SwiftUI-free projection core for the Cron Parser devtool — a faithful
//  port of the compute block in
//  features/admin/components/devtools/tools/CronParser.tsx (describeCron +
//  getNextCronRuns + the preset list, from ../helpers.ts). Everything here is
//  Foundation-only and dependency-free, so it is unit-tested AND executed in the host
//  validation harness (a real "expression → description + next runs" run, not just a
//  typecheck).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable, non-identifying diagnostics slug emitted with `view.opened`. Declared in
/// the view-free layer so the model + evaluator host-compile and run without the UI.
public enum CronParserSurface {
    public static let slug = "CronParser"
}

// MARK: - Input example (web Input example text)

/// The example expression shown while the field is empty (the web Input's example
/// attribute `*/5 * * * *`). It is example data, not user-facing copy, so it is a
/// verbatim constant rather than a localized string.
public enum CronInputExample {
    public static let value = "*/5 * * * *"
}

// MARK: - Preset (web `presets` array)

/// A one-tap cron example (web `presets`): a localized label + the expression it fills
/// in. `labelKey` / `labelFallback` mirror the web `t('Every Minute')` calls, where the
/// key doubles as the English fallback.
public struct CronPreset: Sendable, Equatable, Identifiable {
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public var id: String {
        value
    }

    public init(labelKey: String, labelFallback: String, value: String) {
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }

    /// The five presets, in the web source's order.
    public static let all: [CronPreset] = [
        CronPreset(labelKey: "Every Minute", labelFallback: "Every Minute", value: "* * * * *"),
        CronPreset(labelKey: "Every Hour", labelFallback: "Every Hour", value: "0 * * * *"),
        CronPreset(labelKey: "Every Day", labelFallback: "Every Day", value: "0 0 * * *"),
        CronPreset(labelKey: "Every Week", labelFallback: "Every Week", value: "0 0 * * 0"),
        CronPreset(labelKey: "Every Month", labelFallback: "Every Month", value: "0 0 1 * *")
    ]
}

// MARK: - Result (web `description` + `nextRuns` memos)

/// The computed projection of the current expression. `.empty` is the web state where
/// the expression is not exactly five whitespace-separated fields (blank input
/// included) — both the description and next-runs panels are hidden. `.parsed` carries
/// the human description (always non-empty for five fields) and the upcoming run
/// instants (which may be empty for an unsatisfiable expression).
public enum CronResult: Sendable, Equatable {
    case empty
    case parsed(description: String, runs: [Date])

    /// The human description when parsed, else `nil`.
    public var descriptionText: String? {
        if case let .parsed(description, _) = self { return description }
        return nil
    }

    /// The upcoming run instants when parsed, else an empty array.
    public var runs: [Date] {
        if case let .parsed(_, runs) = self { return runs }
        return []
    }
}

// MARK: - Run row (view projection)

/// A single "Next Runs" entry projected for display: the 1-based index (web badge
/// `{i + 1}`) and the localized/formatted instant (web `formatDateTime(d)`).
public struct CronRunRow: Sendable, Equatable, Identifiable {
    public let index: Int
    public let label: String

    public var id: Int {
        index
    }

    public init(index: Int, label: String) {
        self.index = index
        self.label = label
    }
}

// MARK: - Run formatter (web `formatDateTime`)

/// Formats an upcoming-run instant for display — the native parity of the web
/// `formatDateTime` (medium date + short time, in the viewer's locale + zone). Locale +
/// time zone are injectable so the output is deterministic in tests.
public struct CronRunFormatter: Sendable {
    public let locale: Locale
    public let timeZone: TimeZone

    public init(locale: Locale = .current, timeZone: TimeZone = .current) {
        self.locale = locale
        self.timeZone = timeZone
    }

    /// The shared default — the viewer's current locale + time zone.
    public static let display = CronRunFormatter()

    /// "Apr 4, 2026 at 2:30 PM"-style rendering (medium date, short time).
    public func string(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Evaluator (port of describeCron + getNextCronRuns)

/// The pure cron projection. Splits the expression on whitespace exactly like the web
/// `expr.trim().split(/\s+/)`, then derives the description + next runs only when there
/// are exactly five fields — byte-for-byte the web `parts.length === 5 ? … : …`.
public enum CronEvaluator {
    /// Splits + trims like the web `expr.trim().split(/\s+/)`. A blank string yields an
    /// empty array (not `[""]`) so it reads as zero fields, matching the JS regex split
    /// semantics the web relies on.
    public static func fields(_ expression: String) -> [String] {
        let trimmed = expression.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return [] }
        return trimmed
            .split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" })
            .map(String.init)
    }

    /// The full projection for `expression`: `.empty` unless there are exactly five
    /// fields, else `.parsed` with the localized description + up to `count` runs.
    public static func evaluate(
        expression: String,
        count: Int,
        now: Date,
        calendar: Calendar,
        localize: (String, String) -> String
    ) -> CronResult {
        let parts = fields(expression)
        guard parts.count == 5 else { return .empty }
        let description = describe(parts, localize: localize)
        let runs = nextRuns(parts, count: count, from: now, calendar: calendar)
        return .parsed(description: description, runs: runs)
    }

    /// Port of `describeCron(parts)`. Assembles the description from localized fragments;
    /// with an English-fallback localizer the output is identical to the web helper's
    /// hardcoded English.
    public static func describe(_ parts: [String], localize: (String, String) -> String) -> String {
        guard parts.count == 5 else {
            return localize("cron.desc.invalid", "Invalid cron expression")
        }
        var pieces = [timePhrase(minute: parts[0], hour: parts[1], localize: localize)]
        if parts[2] != "*" {
            pieces.append(fill(localize("cron.desc.onDay", "on day %@"), [parts[2]]))
        }
        if parts[3] != "*" {
            pieces.append(fill(localize("cron.desc.inMonth", "in month %@"), [parts[3]]))
        }
        if parts[4] != "*" {
            let weekday = weekdayName(parts[4], localize: localize)
            pieces.append(fill(localize("cron.desc.onWeekday", "on %@"), [weekday]))
        }
        return pieces.joined(separator: " ")
    }

    /// The minute/hour phrase — the web four-way branch on `(min, hr)`.
    static func timePhrase(minute: String, hour: String, localize: (String, String) -> String) -> String {
        if minute == "*", hour == "*" {
            return localize("cron.desc.everyMinute", "Every minute")
        }
        if minute != "*", hour == "*" {
            return fill(localize("cron.desc.atMinuteOfHour", "At minute %@ of every hour"), [minute])
        }
        if minute != "*", hour != "*" {
            return fill(localize("cron.desc.atTime", "At %@:%@"), [pad2(hour), pad2(minute)])
        }
        return fill(localize("cron.desc.everyMinuteOfHour", "Every minute of hour %@"), [hour])
    }

    /// Maps a numeric day-of-week field to a localized abbreviation (web
    /// `days[idx] ?? dow`). Out-of-range / non-numeric values fall back to the raw field,
    /// exactly like the JS array lookup.
    static func weekdayName(_ field: String, localize: (String, String) -> String) -> String {
        let names: [(String, String)] = [
            ("cron.day.sun", "Sun"), ("cron.day.mon", "Mon"), ("cron.day.tue", "Tue"),
            ("cron.day.wed", "Wed"), ("cron.day.thu", "Thu"), ("cron.day.fri", "Fri"),
            ("cron.day.sat", "Sat")
        ]
        guard let idx = Int(field), idx >= 0, idx < names.count else { return field }
        let entry = names[idx]
        return localize(entry.0, entry.1)
    }

    /// Left-pads to width two with "0" (web `String.padStart(2, '0')`). Strings already
    /// two-or-more characters are returned unchanged.
    static func pad2(_ value: String) -> String {
        value.count >= 2 ? value : String(repeating: "0", count: 2 - value.count) + value
    }

    /// Substitutes each "%@" in `template` with the next argument, in order — a tiny,
    /// deterministic stand-in for positional interpolation that needs no NSObject
    /// bridging and stays testable off-actor.
    static func fill(_ template: String, _ args: [String]) -> String {
        var result = template
        for arg in args {
            guard let range = result.range(of: "%@") else { break }
            result.replaceSubrange(range, with: arg)
        }
        return result
    }

    /// Port of `getNextCronRuns(parts, count)`. Steps minute-by-minute from the next
    /// whole minute, collecting up to `count` instants that satisfy all five fields. The
    /// 525 960-iteration safety cap (~one year) matches the web helper so an
    /// unsatisfiable expression terminates instead of spinning forever.
    public static func nextRuns(_ parts: [String], count: Int, from now: Date, calendar: Calendar) -> [Date] {
        guard parts.count == 5, count > 0 else { return [] }
        let units: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute]
        guard let truncated = calendar.date(from: calendar.dateComponents(units, from: now)),
              var check = calendar.date(byAdding: .minute, value: 1, to: truncated)
        else { return [] }

        var results: [Date] = []
        var safety = 0
        while results.count < count, safety < 525_960 {
            safety += 1
            if matches(parts, at: check, calendar: calendar) {
                results.append(check)
            }
            guard let next = calendar.date(byAdding: .minute, value: 1, to: check) else { break }
            check = next
        }
        return results
    }

    /// Whether `date` satisfies all five fields (web's per-field `matchField` `&&` chain).
    static func matches(_ parts: [String], at date: Date, calendar: Calendar) -> Bool {
        let comps = calendar.dateComponents([.minute, .hour, .day, .month, .weekday], from: date)
        let weekdayZeroBased = (comps.weekday ?? 1) - 1
        return matchField(parts[0], comps.minute ?? 0)
            && matchField(parts[1], comps.hour ?? 0)
            && matchField(parts[2], comps.day ?? 0)
            && matchField(parts[3], comps.month ?? 0)
            && matchField(parts[4], weekdayZeroBased)
    }

    /// Port of the web `matchField`. Wildcard, step (`*/n`), list (`a,b`), range (`a-b`),
    /// or exact match — evaluated in the same precedence as the source so the projection
    /// is byte-for-byte compatible (including the step-before-range quirk).
    static func matchField(_ field: String, _ value: Int) -> Bool {
        if field == "*" { return true }
        if field.contains("/") {
            let segments = field.split(separator: "/", omittingEmptySubsequences: false)
            guard segments.count > 1, let step = Int(segments[1]), step != 0 else { return false }
            return value % step == 0
        }
        if field.contains(",") {
            return field.split(separator: ",").compactMap { Int($0) }.contains(value)
        }
        if field.contains("-") {
            let bounds = field.split(separator: "-", omittingEmptySubsequences: false)
            guard bounds.count >= 2, let low = Int(bounds[0]), let high = Int(bounds[1]) else { return false }
            return value >= low && value <= high
        }
        return Int(field) == value
    }
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the combined VoiceOver summary for the surface. Strings resolve through an
/// injected localizer and instants through an injected formatter, so the summary is
/// fully testable without a bundle — the same seam the view's P1/S10 facade uses.
public enum CronParserAccessibility {
    public static func summary(
        result: CronResult,
        localize: (String, String) -> String,
        formatter: CronRunFormatter
    ) -> String {
        switch result {
        case .empty:
            return localize("a11y.cron.empty", "Enter a cron expression to see its schedule")
        case let .parsed(description, runs):
            let descPart = "\(localize("Description", "Description")): \(description)"
            guard !runs.isEmpty else {
                let noRuns = localize("cron.noRuns", "No upcoming runs in the next year")
                return "\(descPart). \(noRuns)"
            }
            let runsText = runs.map(formatter.string(from:)).joined(separator: ", ")
            return "\(descPart). \(localize("Next Runs", "Next Runs")): \(runsText)"
        }
    }
}
