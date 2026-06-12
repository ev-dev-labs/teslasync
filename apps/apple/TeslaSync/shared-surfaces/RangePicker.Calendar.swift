//
//  RangePicker.Calendar.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The range calendar — the native peer of the web `<DayPicker mode="range">`. The pure
//  ``RangePickerCalendarBuilder`` derives the month grids (leading/trailing padding, the locale week start,
//  the min/max selectable bounds) and classifies each day's selection role (start / end / single / in-range)
//  as `Sendable`/`Equatable` value types, so the geometry is unit-tested with no SwiftUI. The
//  ``RangePickerCalendarView`` renders those grids — two months side-by-side, collapsing to one column on a
//  narrow popover (web `numberOfMonths` 2 → 1 below md) — with token-driven chrome (P1/S9) and a VoiceOver
//  label on every day. Day taps route OUT to the state-holder (staging only; web `onSelect`).
//

import SwiftUI

// MARK: - Selection role (web range highlight)

/// A day's role in the staged range — drives its highlight (web range modifiers `range_start` /
/// `range_end` / `range_middle` / `selected`).
public enum RangePickerDaySelection: Sendable, Equatable {
    case none
    case start
    case end
    case single
    case inRange
}

// MARK: - Grid value types (web rendered month / week / day)

/// One calendar cell. A real day carries its ISO id + number; a padding cell (web `showOutsideDays={false}`)
/// has `nil` iso/number and is never selectable.
public struct RangePickerDay: Sendable, Equatable, Identifiable {
    public let id: String
    public let iso: String?
    public let dayNumber: Int?
    public let isDisabled: Bool

    public init(id: String, iso: String?, dayNumber: Int?, isDisabled: Bool) {
        self.id = id
        self.iso = iso
        self.dayNumber = dayNumber
        self.isDisabled = isDisabled
    }

    /// An empty leading/trailing padding cell.
    static func padding(id: String) -> RangePickerDay {
        RangePickerDay(id: id, iso: nil, dayNumber: nil, isDisabled: true)
    }
}

/// One week row (always 7 cells).
public struct RangePickerWeek: Sendable, Equatable, Identifiable {
    public let id: Int
    public let days: [RangePickerDay]

    public init(id: Int, days: [RangePickerDay]) {
        self.id = id
        self.days = days
    }
}

/// One rendered month — its id (`YYYY-MM`), the first-of-month date (for the title), and its week rows.
public struct RangePickerMonthGrid: Sendable, Equatable, Identifiable {
    public let id: String
    public let monthStart: Date
    public let weeks: [RangePickerWeek]

    public init(id: String, monthStart: Date, weeks: [RangePickerWeek]) {
        self.id = id
        self.monthStart = monthStart
        self.weeks = weeks
    }
}

// MARK: - RangePickerCalendarConfig (the multi-month layout inputs)

/// The shared calendar inputs — the week start, the selectable `[minISO, maxISO]` bounds, and the calendar.
/// Bundled so the grid builders stay within the function-parameter budget and the view passes one value.
public struct RangePickerCalendarConfig: Sendable {
    public let firstWeekday: Int
    public let minISO: String?
    public let maxISO: String?
    public let calendar: Calendar

    public init(firstWeekday: Int, minISO: String?, maxISO: String?, calendar: Calendar) {
        self.firstWeekday = firstWeekday
        self.minISO = minISO
        self.maxISO = maxISO
        self.calendar = calendar
    }
}

// MARK: - RangePickerCalendarBuilder (pure geometry)

/// The pure month-grid geometry — verbatim parity with `DayPicker`'s layout, unit-tested with no SwiftUI.
public enum RangePickerCalendarBuilder {
    /// The 1-based first weekday (web `weekStartsOn`): English locales start on Sunday (1), others Monday (2).
    public static func firstWeekday(forLanguage code: String) -> Int {
        code.lowercased().hasPrefix("en") ? 1 : 2
    }

    /// One month's grid: leading padding to the week start, the real days (disabled outside `[minISO, maxISO]`),
    /// and trailing padding to complete the final week.
    public static func monthGrid(
        monthStart: Date,
        firstWeekday: Int,
        minISO: String?,
        maxISO: String?,
        calendar: Calendar
    ) -> RangePickerMonthGrid {
        let year = calendar.component(.year, from: monthStart)
        let month = calendar.component(.month, from: monthStart)
        let dayCount = calendar.range(of: .day, in: .month, for: monthStart)?.count ?? 0
        let weekdayOfFirst = calendar.component(.weekday, from: monthStart)
        let leading = ((weekdayOfFirst - firstWeekday) + 7) % 7
        var days: [RangePickerDay] = (0 ..< leading).map { .padding(id: "\(year)-\(month)-lead-\($0)") }
        for day in 1 ... max(dayCount, 1) where dayCount > 0 {
            let iso = String(format: "%04d-%02d-%02d", year, month, day)
            let belowMin = minISO.map { iso < $0 } ?? false
            let aboveMax = maxISO.map { iso > $0 } ?? false
            days.append(RangePickerDay(id: iso, iso: iso, dayNumber: day, isDisabled: belowMin || aboveMax))
        }
        while days.count % 7 != 0 {
            days.append(.padding(id: "\(year)-\(month)-trail-\(days.count)"))
        }
        return RangePickerMonthGrid(
            id: String(format: "%04d-%02d", year, month),
            monthStart: monthStart,
            weeks: chunk(days)
        )
    }

    /// `count` consecutive month grids starting at `anchor`'s month (web `numberOfMonths`).
    public static func months(count: Int, anchor: Date, config: RangePickerCalendarConfig) -> [RangePickerMonthGrid] {
        let calendar = config.calendar
        let base = calendar.date(from: calendar.dateComponents([.year, .month], from: anchor)) ?? anchor
        return (0 ..< max(1, count)).compactMap { offset in
            guard let start = calendar.date(byAdding: .month, value: offset, to: base) else { return nil }
            return monthGrid(
                monthStart: start,
                firstWeekday: config.firstWeekday,
                minISO: config.minISO,
                maxISO: config.maxISO,
                calendar: calendar
            )
        }
    }

    /// Classify a day's role in the staged range (web range modifiers).
    public static func selection(for iso: String, start: String?, end: String?) -> RangePickerDaySelection {
        guard let start else { return .none }
        guard let end else { return iso == start ? .single : .none }
        if start == end { return iso == start ? .single : .none }
        if iso == start { return .start }
        if iso == end { return .end }
        return (iso > start && iso < end) ? .inRange : .none
    }

    /// The month a freshly-opened picker should anchor on — the committed end's month, floored under `maxDate`.
    public static func anchorMonth(endISO: String, maxISO: String?, calendar: Calendar) -> Date {
        let endDate = RangePickerDates.date(from: endISO, calendar: calendar) ?? Date()
        guard let maxISO, let maxDate = RangePickerDates.date(from: maxISO, calendar: calendar),
              endDate > maxDate else { return endDate }
        return maxDate
    }

    private static func chunk(_ days: [RangePickerDay]) -> [RangePickerWeek] {
        stride(from: 0, to: days.count, by: 7).enumerated().map { index, start in
            RangePickerWeek(id: index, days: Array(days[start ..< min(start + 7, days.count)]))
        }
    }
}

// MARK: - RangePickerCalendarView (web `<DayPicker mode="range">`)

/// The range calendar — two months side-by-side that collapse to one column on a narrow popover. Selection is
/// staged: a tap routes to `onPick`; the state-holder owns the staged range and only Apply commits it.
struct RangePickerCalendarView: View {
    let stagedStart: String?
    let stagedEnd: String?
    let endISO: String
    let minISO: String?
    let maxISO: String?
    let firstWeekday: Int
    let calendar: Calendar
    let onPick: (String) -> Void

    @State private var monthOffset = 0

    private var anchor: Date {
        let base = RangePickerCalendarBuilder.anchorMonth(endISO: endISO, maxISO: maxISO, calendar: calendar)
        return calendar.date(byAdding: .month, value: monthOffset, to: base) ?? base
    }

    private var grids: [RangePickerMonthGrid] {
        RangePickerCalendarBuilder.months(
            count: 2,
            anchor: anchor,
            config: RangePickerCalendarConfig(
                firstWeekday: firstWeekday, minISO: minISO, maxISO: maxISO, calendar: calendar
            )
        )
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            navBar
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: TSSpacing.lg) { monthColumns }
                VStack(spacing: TSSpacing.lg) { monthColumns }
            }
        }
    }

    private var monthColumns: some View {
        ForEach(grids) { grid in
            RangePickerMonthView(
                grid: grid,
                firstWeekday: firstWeekday,
                stagedStart: stagedStart,
                stagedEnd: stagedEnd,
                calendar: calendar,
                onPick: onPick
            )
        }
    }

    private var navBar: some View {
        HStack {
            navButton(systemImage: "chevron.left", labelKey: "rangePicker.prevMonth", fallback: "Previous month") {
                monthOffset -= 1
            }
            Spacer()
            navButton(systemImage: "chevron.right", labelKey: "rangePicker.nextMonth", fallback: "Next month") {
                monthOffset += 1
            }
        }
    }

    private func navButton(
        systemImage: String,
        labelKey: String,
        fallback: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: RangePickerStrings.string(labelKey, fallback)))
    }
}

// MARK: - RangePickerMonthView (one month: title + weekday header + week rows)

/// One month grid — its localized title, the rotated weekday header, and the week rows of day cells.
struct RangePickerMonthView: View {
    let grid: RangePickerMonthGrid
    let firstWeekday: Int
    let stagedStart: String?
    let stagedEnd: String?
    let calendar: Calendar
    let onPick: (String) -> Void

    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortWeekdaySymbols
        return (0 ..< 7).map { symbols[(firstWeekday - 1 + $0) % 7] }
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity)
            HStack(spacing: 0) {
                ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                    Text(verbatim: symbol)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity)
                        .accessibilityHidden(true)
                }
            }
            ForEach(grid.weeks) { week in
                HStack(spacing: 0) {
                    ForEach(week.days) { day in
                        RangePickerDayCell(
                            day: day,
                            selection: RangePickerCalendarBuilder.selection(
                                for: day.iso ?? "", start: stagedStart, end: stagedEnd
                            ),
                            calendar: calendar,
                            onPick: onPick
                        )
                    }
                }
            }
        }
        .frame(minWidth: 232)
    }

    private var title: String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.setLocalizedDateFormatFromTemplate("MMMMyyyy")
        return formatter.string(from: grid.monthStart)
    }
}
