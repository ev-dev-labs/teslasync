//
//  StateTimeline.Copy.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  The pure (Foundation-only) formatters, surface identity, and VoiceOver summaries
//  for the FSM transition timeline — split out of the adapter so each file stays
//  focused + testable. Copy resolves through an injected localizer
//  (`(key, fallback) -> String`) so it is testable without a bundle, exactly like the
//  view's P1/S10 facade. The formatters mirror the web `useDateFormat` seam the source
//  consumes: `formatTime` (the rail header + tooltip clock) and `formatRelative` (the
//  empty-state "Last transition {{rel}}" hint).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum StateTimelineSurface {
    public static let slug = "StateTimeline"
}

// MARK: - Formatting (pure, bundle-free)

/// Locale-aware formatting helpers for the timeline. Pure + testable: a fixed locale
/// + time zone make every label deterministic for snapshot / unit tests.
public enum StateTimelineFormat {
    /// The rail header + tooltip clock label (web `formatTime` →
    /// `toLocaleTimeString({ hour: '2-digit', minute: '2-digit' })`).
    public static func clock(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    /// The absolute fallback for a far-back transition (web `formatRelative` → `formatDate`
    /// → `{ year: 'numeric', month: 'short', day: 'numeric' }`, e.g. "Apr 4, 2026").
    public static func mediumDate(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// The relative "last transition" hint (web `formatRelative`): "just now" under a
    /// minute, "%lldm ago" / "%lldh ago" / "%lldd ago" within a week, else the absolute
    /// medium date. `now` is injected for determinism (web captures `Date.now()`).
    public static func relative(
        _ date: Date,
        now: Date,
        localize: (String, String) -> String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let seconds = Int((now.timeIntervalSince1970 - date.timeIntervalSince1970).rounded(.down))
        if seconds < 60 {
            return localize("debugger.timeline.rel.justNow", "just now")
        }
        let minutes = seconds / 60
        if minutes < 60 {
            return String(format: localize("debugger.timeline.rel.minutes", "%lldm ago"), locale: locale, minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return String(format: localize("debugger.timeline.rel.hours", "%lldh ago"), locale: locale, hours)
        }
        let days = hours / 24
        if days < 7 {
            return String(format: localize("debugger.timeline.rel.days", "%lldd ago"), locale: locale, days)
        }
        return mediumDate(date, locale: locale, timeZone: timeZone)
    }

    /// The "widen window to …" preset label (web `presetLabel`): "%lld min" under an
    /// hour, "%lld h" (rounded hours) under a day, else "24 h".
    public static func presetLabel(
        minutes: Int,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        if minutes < 60 {
            return String(format: localize("debugger.window.minutes", "%lld min"), locale: locale, minutes)
        }
        if minutes < 1440 {
            let hours = Int((Double(minutes) / 60).rounded())
            return String(format: localize("debugger.window.hours", "%lld h"), locale: locale, hours)
        }
        return localize("debugger.window.day", "24 h")
    }

    /// The window-length header label (web `t('debugger.timeline.windowLabel',
    /// 'Window: {{minutes}} min')`).
    public static func windowLabel(
        minutes: Int,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        String(format: localize("debugger.timeline.windowLabel", "Window: %lld min"), locale: locale, minutes)
    }

    /// A locale-grouped whole number (the a11y transition count). Non-finite-proof.
    public static func count(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum StateTimelineAccessibility {
    /// One tick's VoiceOver label (web `aria-label` = `t('debugger.timeline.tickAria',
    /// '{{from}} to {{to}}')`), with the clock time appended for context.
    public static func tickLabel(
        from: String,
        to: String,
        timeLabel: String,
        localize: (String, String) -> String
    ) -> String {
        let base = String(format: localize("debugger.timeline.tickAria", "%1$@ to %2$@"), from, to)
        return "\(base) · \(timeLabel)"
    }

    /// One tick's tooltip (web `content={`${from} → ${to} · ${formatTime(ts)}`}`) —
    /// punctuation separators are not localized, matching the web template literal.
    public static func tooltip(from: String, to: String, timeLabel: String) -> String {
        "\(from) → \(to) · \(timeLabel)"
    }

    /// The rail-level spoken summary: title + transition count + window length + span
    /// (first → last clock). Dense per-tick detail is summarized, not tabulated.
    public static func railSummary(
        ticksCount: Int,
        windowMinutes: Int,
        startLabel: String,
        endLabel: String,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("debugger.timeline.title", "State transition timeline")
        let transitionsWord = localize("debugger.timeline.a11y.transitions", "transitions")
        let fromWord = localize("debugger.timeline.a11y.from", "from")
        let toWord = localize("debugger.timeline.a11y.to", "to")
        let countValue = StateTimelineFormat.count(ticksCount, locale: locale)
        let window = StateTimelineFormat.windowLabel(minutes: windowMinutes, localize: localize, locale: locale)
        return "\(title): \(countValue) \(transitionsWord), \(window), "
            + "\(fromWord) \(startLabel) \(toWord) \(endLabel)"
    }

    /// The empty-state spoken summary: title + the "No transitions in window" message,
    /// plus the "Last transition {{rel}}" hint when one is known (web empty branch).
    public static func emptySummary(
        message: String,
        lastSeen: String?,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("debugger.timeline.title", "State transition timeline")
        guard let lastSeen, !lastSeen.isEmpty else { return "\(title): \(message)" }
        return "\(title): \(message), \(lastSeen)"
    }
}
