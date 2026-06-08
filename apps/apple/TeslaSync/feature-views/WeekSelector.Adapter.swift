//
//  WeekSelector.Adapter.swift
//  TeslaSync — P4 feature view · 0079 · WeekSelector (Apple)
//
//  The testable projection core for the Weekly Digest week selector: the
//  operator-selected `weekOffset` (web `useWeeklyDigest`'s `weekOffset` state) →
//  the Monday-based week range, the locale-aware `weekLabel`, the `isCurrentWeek`
//  flag, and the prev/next navigation arithmetic the bar drives. Pure +
//  Foundation-only (no SwiftUI, no bundle, no clock) so the week math, the date
//  label, and the VoiceOver copy unit-test deterministically with an injected
//  `now`, `Calendar`, and `Locale`.
//
//  Parity source: web/src/features/analytics/components/weekly-digest/{
//  WeekSelector.tsx, useWeeklyDigest.ts, helpers.ts}. The web computes the range
//  with `getWeekRange(offset)` (Monday-of-week + offset weeks), the label with
//  ```${formatDateShort(start)} – ${formatDateShort(end)}` `` (`{ month:'short',
//  day:'numeric' }`), `isCurrentWeek = weekOffset === 0`, and gates Next on
//  `!isCurrentWeek` (`goToNextWeek` only advances when not on the current week).
//

import Foundation

// MARK: - Week range + label projection (web `getWeekRange` / `weekLabel`)

/// Pure projection for the week selector: the Monday-based range for an offset,
/// the locale-aware short-date label, the current-week flag, and the prev/next
/// offset arithmetic. Mirrors the web `useWeeklyDigest` + `helpers.getWeekRange`
/// exactly so the native bar reads the same week the web feature does.
public enum WeekSelectorProjection {
    /// The inclusive Monday→Sunday range for a week `offset` relative to `now`
    /// (0 = the current week, −1 = last week, …). Reproduces the web
    /// `getWeekRange`: `start = startOfDay(now) − jsWeekday(now) + 1 + offset·7`
    /// days, `end = start + 6` days at the end of the day. `jsWeekday` is the
    /// JavaScript `Date.getDay()` convention (Sunday = 0 … Saturday = 6).
    public static func weekRange(
        offset: Int,
        now: Date,
        calendar: Calendar
    ) -> (start: Date, end: Date) {
        let jsWeekday = calendar.component(.weekday, from: now) - 1
        let daysToMonday = -jsWeekday + 1 + offset * 7
        let startOfToday = calendar.startOfDay(for: now)
        let start = calendar.date(byAdding: .day, value: daysToMonday, to: startOfToday) ?? startOfToday
        let endDay = calendar.date(byAdding: .day, value: 6, to: start) ?? start
        let end = calendar.date(
            bySettingHour: 23, minute: 59, second: 59, of: endDay
        ) ?? endDay
        return (start, end)
    }

    /// The web `weekLabel` — ```${formatDateShort(start)} – ${formatDateShort(end)}` ``
    /// — joining the two abbreviated-month/numeric-day endpoints with a spaced
    /// en dash. Locale-ordered (e.g. `Jun 3 – Jun 9` for `en_US`,
    /// `3 juin – 9 juin` for `fr_FR`).
    public static func weekLabel(
        offset: Int,
        now: Date,
        calendar: Calendar,
        locale: Locale
    ) -> String {
        let range = weekRange(offset: offset, now: now, calendar: calendar)
        let startText = shortDate(range.start, calendar: calendar, locale: locale)
        let endText = shortDate(range.end, calendar: calendar, locale: locale)
        return "\(startText) – \(endText)"
    }

    /// One endpoint of the label — the native port of web `formatDateShort`
    /// (`toLocaleDateString(locale, { month: 'short', day: 'numeric' })`). Uses a
    /// locale-templated `MMMd` pattern so the field order follows the locale.
    public static func shortDate(
        _ date: Date,
        calendar: Calendar,
        locale: Locale
    ) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    // MARK: - Navigation arithmetic (web `goToPrevWeek` / `goToNextWeek`)

    /// `isCurrentWeek = weekOffset === 0` (web `useWeeklyDigest`).
    public static func isCurrentWeek(offset: Int) -> Bool {
        offset == 0
    }

    /// Whether Next is enabled — the web gates `goToNextWeek` on `!isCurrentWeek`
    /// (you can never advance past the current week). Equivalent to `offset < 0`.
    public static func canGoToNextWeek(offset: Int) -> Bool {
        offset < 0
    }

    /// Previous-week offset (web `goToPrevWeek`: `setWeekOffset(o => o - 1)`).
    /// Always permitted — the history is unbounded backwards.
    public static func previousOffset(from offset: Int) -> Int {
        offset - 1
    }

    /// Next-week offset (web `goToNextWeek`: `setWeekOffset(o => o + 1)` only when
    /// `!isCurrentWeek`). Clamped at 0 so it never advances into the future.
    public static func nextOffset(from offset: Int) -> Int {
        min(offset + 1, 0)
    }
}

// MARK: - Accessibility (testable seam)

/// Pure builders for the VoiceOver copy the bar attaches to its elements, so the
/// spoken content is unit-testable without rendering the view.
public enum WeekSelectorAccessibility {
    /// The center group label: the selected week plus a "current week" qualifier
    /// when on the current week — e.g. "Selected week, Jun 3 – Jun 9, current
    /// week" (web center span: calendar + label + the `Current` badge).
    public static func weekSummary(
        weekLabel: String,
        isCurrentWeek: Bool,
        localize: (String, String) -> String
    ) -> String {
        let prefix = localize("analytics.weeklyDigest.a11yWeek", "Selected week")
        guard isCurrentWeek else {
            return "\(prefix), \(weekLabel)"
        }
        let current = localize("analytics.weeklyDigest.current", "Current")
        return "\(prefix), \(weekLabel), \(current)"
    }
}
