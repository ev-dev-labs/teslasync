import Foundation

/// A nightly quiet-hours window during which non-critical notifications are muted
/// (no sound/banner in the foreground; the server honours the same window for
/// background pushes). Stored as minutes-from-local-midnight so it serialises
/// cleanly and the logic is timezone-pure and unit-testable.
public struct QuietHours: Codable, Equatable, Sendable {
    public var isEnabled: Bool
    /// Window start, minutes from local midnight (e.g. 22:00 = 1320).
    public var startMinute: Int
    /// Window end, minutes from local midnight (e.g. 07:00 = 420).
    public var endMinute: Int

    public init(isEnabled: Bool = false, startMinute: Int = 22 * 60, endMinute: Int = 7 * 60) {
        self.isEnabled = isEnabled
        self.startMinute = Self.clamp(startMinute)
        self.endMinute = Self.clamp(endMinute)
    }

    /// Whether `date` falls inside the window. Handles windows that wrap past
    /// midnight (`start > end`, e.g. 22:00 → 07:00). A zero-length window
    /// (`start == end`) is treated as "off".
    public func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
        guard isEnabled, startMinute != endMinute else { return false }
        let components = calendar.dateComponents([.hour, .minute], from: date)
        let minute = (components.hour ?? 0) * 60 + (components.minute ?? 0)
        if startMinute < endMinute {
            return minute >= startMinute && minute < endMinute
        }
        return minute >= startMinute || minute < endMinute
    }

    /// The start time as (hour, minute) for the settings pickers.
    public var start: (hour: Int, minute: Int) {
        (startMinute / 60, startMinute % 60)
    }

    /// The end time as (hour, minute) for the settings pickers.
    public var end: (hour: Int, minute: Int) {
        (endMinute / 60, endMinute % 60)
    }

    public mutating func setStart(hour: Int, minute: Int) {
        startMinute = Self.clamp(hour * 60 + minute)
    }

    public mutating func setEnd(hour: Int, minute: Int) {
        endMinute = Self.clamp(hour * 60 + minute)
    }

    private static func clamp(_ minute: Int) -> Int {
        min(max(minute, 0), 24 * 60 - 1)
    }
}
