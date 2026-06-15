import Foundation

// MARK: - Regex / cron / timestamp compute (web devtools tools + `helpers.ts`)

public extension DevToolsUtilities {
    // MARK: Regex tester (web `RegexTesterTool`)

    struct RegexMatch: Equatable, Sendable {
        public let text: String
        public let index: Int
    }

    /// Returns matches (web `RegexTester`); nil signals an invalid pattern, [] no match.
    static func regexMatches(pattern: String, flags: String, in text: String) -> [RegexMatch]? {
        guard !pattern.isEmpty, !text.isEmpty else { return [] }
        var options: NSRegularExpression.Options = []
        if flags.contains("i") { options.insert(.caseInsensitive) }
        if flags.contains("m") { options.insert(.anchorsMatchLines) }
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        let nsText = text as NSString
        let fullRange = NSRange(location: 0, length: nsText.length)
        let isGlobal = flags.contains("g")
        var results: [RegexMatch] = []
        for match in regex.matches(in: text, options: [], range: fullRange) {
            results.append(RegexMatch(text: nsText.substring(with: match.range), index: match.range.location))
            if !isGlobal { break }
        }
        return results
    }

    // MARK: Cron (web `CronParserTool` + `helpers.describeCron` / `getNextCronRuns`)

    /// Human description of a 5-field cron expression (nil if not 5 fields). Ports
    /// web `helpers.describeCron` — the generated text is English in the web source too.
    static func describeCron(_ expression: String) -> String? {
        let parts = expression.split(whereSeparator: { $0 == " " }).map(String.init)
        guard parts.count == 5 else { return nil }
        let (minute, hour, dayOfMonth, month, dayOfWeek) = (parts[0], parts[1], parts[2], parts[3], parts[4])
        var pieces: [String] = [describeTime(minute: minute, hour: hour)]
        if dayOfMonth != "*" { pieces.append("on day \(dayOfMonth)") }
        if month != "*" { pieces.append("in month \(month)") }
        if dayOfWeek != "*" { pieces.append("on \(weekdayName(dayOfWeek))") }
        return pieces.joined(separator: " ")
    }

    private static func describeTime(minute: String, hour: String) -> String {
        if minute == "*", hour == "*" { return "Every minute" }
        if minute != "*", hour == "*" { return "At minute \(minute) of every hour" }
        if minute != "*", hour != "*" { return "At \(pad(hour)):\(pad(minute))" }
        return "Every minute of hour \(hour)"
    }

    private static func weekdayName(_ field: String) -> String {
        let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        guard let index = Int(field), days.indices.contains(index) else { return field }
        return days[index]
    }

    /// Next N fire times for a cron expression (web `helpers.getNextCronRuns`).
    static func nextCronRuns(_ expression: String, count: Int, from now: Date) -> [Date] {
        let parts = expression.split(whereSeparator: { $0 == " " }).map(String.init)
        guard parts.count == 5 else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone.current
        var cursor = calendar.date(bySetting: .second, value: 0, of: now) ?? now
        cursor = calendar.date(byAdding: .minute, value: 1, to: cursor) ?? cursor
        var results: [Date] = []
        var safety = 0
        while results.count < count, safety < 525_960 {
            safety += 1
            if cronMatches(parts: parts, date: cursor, calendar: calendar) {
                results.append(cursor)
            }
            cursor = calendar.date(byAdding: .minute, value: 1, to: cursor) ?? cursor.addingTimeInterval(60)
        }
        return results
    }

    private static func cronMatches(parts: [String], date: Date, calendar: Calendar) -> Bool {
        let comps = calendar.dateComponents([.minute, .hour, .day, .month, .weekday], from: date)
        return cronFieldMatches(parts[0], comps.minute ?? 0)
            && cronFieldMatches(parts[1], comps.hour ?? 0)
            && cronFieldMatches(parts[2], comps.day ?? 0)
            && cronFieldMatches(parts[3], comps.month ?? 0)
            && cronFieldMatches(parts[4], (comps.weekday ?? 1) - 1)
    }

    private static func cronFieldMatches(_ field: String, _ value: Int) -> Bool {
        if field == "*" { return true }
        if field.contains("/") {
            let step = Int(field.split(separator: "/").last.map(String.init) ?? "1") ?? 1
            return step != 0 && value % step == 0
        }
        if field.contains(",") {
            return field.split(separator: ",").compactMap { Int($0) }.contains(value)
        }
        if field.contains("-") {
            let bounds = field.split(separator: "-").compactMap { Int($0) }
            guard bounds.count == 2 else { return false }
            return value >= bounds[0] && value <= bounds[1]
        }
        return Int(field) == value
    }

    // MARK: Timestamp (web `TimestampTool` + `helpers.getRelativeTime`)

    struct TimestampDecode: Equatable, Sendable {
        public let iso: String
        public let unix: Int
        public let relative: String
    }

    static func currentUnix(_ now: Date) -> Int {
        Int(now.timeIntervalSince1970)
    }

    /// Decodes a Unix timestamp string (>10 digits → milliseconds, web `TimestampTool`).
    static func decodeUnix(_ input: String, now: Date) -> TimestampDecode? {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        guard let raw = Int(trimmed) else { return nil }
        let milliseconds = trimmed.count > 10 ? raw : raw * 1000
        return describe(Date(timeIntervalSince1970: Double(milliseconds) / 1000), now: now)
    }

    /// Decodes an ISO-8601 date string (web `new Date(iso)`).
    static func decodeISO(_ input: String, now: Date) -> TimestampDecode? {
        guard let date = parseISO(input) else { return nil }
        return describe(date, now: now)
    }

    static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func describe(_ date: Date, now: Date) -> TimestampDecode {
        TimestampDecode(
            iso: iso8601(date),
            unix: Int(date.timeIntervalSince1970),
            relative: relativeTime(date, now: now)
        )
    }

    private static func parseISO(_ input: String) -> Date? {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }

    /// Ports web `helpers.getRelativeTime` (s/m/h/d ago — English in the web source too).
    static func relativeTime(_ date: Date, now: Date) -> String {
        let seconds = Int(abs(now.timeIntervalSince1970 - date.timeIntervalSince1970))
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }
}
