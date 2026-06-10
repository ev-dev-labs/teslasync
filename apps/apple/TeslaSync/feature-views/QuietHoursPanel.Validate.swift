//
//  QuietHoursPanel.Validate.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The pure validation, clock, schedule, and accessibility helpers for the quiet-hours
//  surface — the SwiftUI parity of the web `validateDraft`, `parseHHMM`,
//  `summarizeWindow`, and the exported `nextWindowChangeLabel`. Everything here is
//  Foundation-only and dependency-free so it is unit-tested without a bundle or a clock.
//  All user-facing copy resolves through an injected P1/S10 localizer, so no English
//  literal lives in this code (the web hard-coded the schedule strings; the native port
//  routes them through the catalog).
//

import Foundation

// MARK: - Validation result (web `ValidationResult`)

/// Which draft field failed validation (web `ValidationResult.field`).
public enum QuietHoursValidationField: String, Sendable, Equatable {
    case startLocal
    case endLocal
    case timezone
    case weekdays
    case bypassSeverities
}

/// Why a field failed (web `ValidationResult.message` discriminator).
public enum QuietHoursValidationReason: Sendable, Equatable {
    case invalid
    case equal
    case required
}

/// The outcome of validating a draft (web `ValidationResult`). A nil `field` means the
/// draft is valid.
public struct QuietHoursValidation: Sendable, Equatable {
    public let field: QuietHoursValidationField?
    public let reason: QuietHoursValidationReason?

    public init(field: QuietHoursValidationField? = nil, reason: QuietHoursValidationReason? = nil) {
        self.field = field
        self.reason = reason
    }

    /// Whether the draft passed (web `ValidationResult.ok`).
    public var ok: Bool {
        field == nil
    }

    /// The valid singleton.
    public static let valid = QuietHoursValidation()
}

// MARK: - Validator (web `validateDraft` + `HHMM`)

/// The pure draft validator + the HH:MM parser — the native port of the web `HHMM`
/// regex (`^([01]\d|2[0-3]):[0-5]\d$`), `validateDraft`, and the error-message map.
public enum QuietHoursValidator {
    /// Whether a string is a valid 24-hour HH:MM (two-digit hour 00–23, minute 00–59).
    public static func isValidTime(_ value: String) -> Bool {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1])
        else {
            return false
        }
        return (0 ... 23).contains(hour) && (0 ... 59).contains(minute)
    }

    /// Minutes-since-midnight for a valid HH:MM, else nil (web `parseHHMM`).
    public static func parseMinutes(_ value: String) -> Int? {
        guard isValidTime(value) else { return nil }
        let parts = value.split(separator: ":")
        guard let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        return hour * 60 + minute
    }

    /// Validates a draft, mirroring the web `validateDraft` order: start HH:MM → end
    /// HH:MM → start≠end → timezone present → weekday mask in (0, 127]. An empty bypass
    /// list is allowed (web comment: empty means everything defers).
    public static func validate(_ draft: QuietHoursDraft) -> QuietHoursValidation {
        if !isValidTime(draft.startLocal) {
            return QuietHoursValidation(field: .startLocal, reason: .invalid)
        }
        if !isValidTime(draft.endLocal) {
            return QuietHoursValidation(field: .endLocal, reason: .invalid)
        }
        if draft.startLocal == draft.endLocal {
            return QuietHoursValidation(field: .endLocal, reason: .equal)
        }
        if draft.timezone.isEmpty {
            return QuietHoursValidation(field: .timezone, reason: .required)
        }
        if draft.weekdays <= 0 || draft.weekdays > QuietHoursWeekdays.all {
            return QuietHoursValidation(field: .weekdays, reason: .required)
        }
        return .valid
    }

    /// Maps a failed validation to its localized message — the native port of the web
    /// `messages[v.field]` lookup (including the start↔end `equal` branch). Defaults to
    /// the start-invalid copy when the field is absent (web `?? messages.start_local`).
    public static func message(
        for validation: QuietHoursValidation,
        localize: (String, String) -> String
    ) -> String {
        switch validation.field {
        case .endLocal where validation.reason == .equal:
            localize("quietHours.error.endEqual", "End must differ from start.")
        case .endLocal:
            localize("quietHours.error.endInvalid", "End must be HH:MM (24-hour).")
        case .timezone:
            localize("quietHours.error.timezoneRequired", "Timezone is required.")
        case .weekdays:
            localize("quietHours.error.weekdaysRequired", "Pick at least one weekday.")
        case .bypassSeverities:
            localize("quietHours.error.bypassRequired", "Pick at least one severity.")
        case .startLocal, .none:
            localize("quietHours.error.startInvalid", "Start must be HH:MM (24-hour).")
        }
    }
}

// MARK: - Clock (HH:MM ↔ Date for the native time pickers)

/// Converts between the wire HH:MM strings and the `Date` the SwiftUI `DatePicker`
/// (`.hourAndMinute`) binds to. A stable reference day is used so only the time matters
/// and the round-trip is deterministic regardless of the rendering calendar.
public enum QuietHoursClock {
    /// A valid HH:MM as a `Date` on a fixed reference day, for the picker binding.
    public static func date(fromHHMM value: String, calendar: Calendar = .current) -> Date {
        let total = QuietHoursValidator.parseMinutes(value) ?? 0
        var components = DateComponents()
        components.year = 2001
        components.month = 1
        components.day = 1
        components.hour = total / 60
        components.minute = total % 60
        return calendar.date(from: components) ?? Date(timeIntervalSinceReferenceDate: 0)
    }

    /// The picker's `Date` back to a zero-padded 24-hour HH:MM string.
    public static func hhmm(fromDate date: Date, calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return hhmm(fromMinutes: (components.hour ?? 0) * 60 + (components.minute ?? 0))
    }

    /// Minutes-since-midnight as a clamped, zero-padded HH:MM string.
    public static func hhmm(fromMinutes total: Int) -> String {
        let clamped = max(0, min(total, 24 * 60 - 1))
        return String(format: "%02d:%02d", clamped / 60, clamped % 60)
    }
}

// MARK: - Schedule (web exported `nextWindowChangeLabel`)

/// The pure "next state change" label for a window — the native port of the web
/// exported `nextWindowChangeLabel(w, now)`. `now` + `calendar` are injected so tests
/// pin the clock; the four copy variants resolve through the localizer (the web hard-
/// coded them, but the native surface forbids English literals).
public enum QuietHoursSchedule {
    public static func nextChangeLabel(
        for item: QuietHoursWindowItem,
        now: Date,
        calendar: Calendar = .current,
        localize: (String, String) -> String
    ) -> String? {
        guard item.enabled else { return nil }
        let weekdayIndex = calendar.component(.weekday, from: now) - 1
        let todayBit = 1 << weekdayIndex
        guard QuietHoursWeekdays.isOn(item.weekdays, bit: todayBit) else { return nil }
        let parts = calendar.dateComponents([.hour, .minute], from: now)
        let minutesNow = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        guard let start = QuietHoursValidator.parseMinutes(item.startLocal),
              let end = QuietHoursValidator.parseMinutes(item.endLocal)
        else {
            return nil
        }
        if end <= start {
            if minutesNow < end { return ends(at: item.endLocal, tomorrow: false, localize: localize) }
            if minutesNow >= start { return ends(at: item.endLocal, tomorrow: true, localize: localize) }
            return starts(at: item.startLocal, tomorrow: false, localize: localize)
        }
        if minutesNow < start { return starts(at: item.startLocal, tomorrow: false, localize: localize) }
        if minutesNow < end { return ends(at: item.endLocal, tomorrow: false, localize: localize) }
        return starts(at: item.startLocal, tomorrow: true, localize: localize)
    }

    private static func ends(at time: String, tomorrow: Bool, localize: (String, String) -> String) -> String {
        let format = tomorrow
            ? localize("quietHours.next.endsTomorrow", "ends tomorrow at %@")
            : localize("quietHours.next.endsAt", "ends at %@")
        return String(format: format, time)
    }

    private static func starts(at time: String, tomorrow: Bool, localize: (String, String) -> String) -> String {
        let format = tomorrow
            ? localize("quietHours.next.startsTomorrow", "starts tomorrow at %@")
            : localize("quietHours.next.startsAt", "starts at %@")
        return String(format: format, time)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings from already-localized parts, so spoken
/// content is asserted without rendering the view.
public enum QuietHoursAccessibility {
    /// The panel header summary: title + window count.
    public static func panelSummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("quietHours.title", "Quiet hours / Do-Not-Disturb")
        return "\(title): \(count)"
    }

    /// One row's VoiceOver label: enabled/disabled · the window summary · the active
    /// weekday names · the bypass allow-list, each resolved through the same localizer.
    public static func rowLabel(_ item: QuietHoursWindowItem, localize: (String, String) -> String) -> String {
        var parts: [String] = [
            localize(
                item.enabled ? "quietHours.enabled" : "quietHours.disabled",
                item.enabled ? "Enabled" : "Disabled"
            ),
            item.summary
        ]
        let activeDays = QuietHoursWeekdays.ordered
            .filter { QuietHoursWeekdays.isOn(item.weekdays, bit: $0.bit) }
            .map { localize($0.key, $0.fallback) }
        if !activeDays.isEmpty {
            parts.append(activeDays.joined(separator: " "))
        }
        if !item.bypassSeverities.isEmpty {
            let label = localize("quietHours.bypassLabel", "Always allow:")
            let severities = item.bypassSeverities
                .map { QuietHoursSeverity.label(forToken: $0, localize: localize) }
                .joined(separator: " ")
            parts.append("\(label) \(severities)")
        }
        return parts.joined(separator: ", ")
    }
}
