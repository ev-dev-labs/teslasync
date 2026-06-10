//
//  NotificationRow.Copy.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The pure (Foundation-only) formatters, surface identity, and VoiceOver summaries
//  for the inbox notification-row surface — split out of the adapter so each file
//  stays focused + testable. Copy resolves through an injected localizer
//  (`(key, fallback) -> String`) so it is testable without a bundle, exactly like
//  the view's P1/S10 facade.
//

import Foundation

// MARK: - Formatting

/// Locale-aware formatting helpers (the row timestamp). Pure + testable.
public enum NotificationRowFormat {
    /// The row timestamp (web `<DateTime>`), as a short localized date + time. A
    /// fixed locale + time zone makes it deterministic for snapshot/unit tests. The
    /// web renders in the vehicle's zone when a vehicle is known, else the user's;
    /// the bound source resolves which zone to pass.
    public static func timestamp(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum NotificationRowSurface {
    public static let slug = "NotificationRow"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer so the summaries are testable without a bundle.
public enum NotificationRowAccessibility {
    /// One row's VoiceOver value: severity, read-state, time, vehicle, rule, title.
    public static func rowLabel(
        _ row: NotificationRowProjection,
        localize: (String, String) -> String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        var parts: [String] = []
        parts.append(localize(row.severity.localizationKey, row.severity.fallback))
        parts.append(
            row.isRead
                ? localize("notifications.inbox.row.a11y.read", "Read")
                : localize("notifications.inbox.row.a11y.unread", "Unread")
        )
        parts.append(NotificationRowFormat.timestamp(row.createdAt, locale: locale, timeZone: timeZone))
        if let vehicle = row.vehicleName, !vehicle.isEmpty {
            parts.append(vehicle)
        }
        if let rule = row.ruleName, !rule.isEmpty {
            parts.append(rule)
        }
        parts.append(row.title)
        return parts.joined(separator: ", ")
    }

    /// The selection-checkbox VoiceOver value (web `aria-checked` on the input).
    public static func selectionValue(
        selected: Bool,
        localize: (String, String) -> String
    ) -> String {
        selected
            ? localize("notifications.inbox.row.a11y.selected", "Selected")
            : localize("notifications.inbox.row.a11y.notSelected", "Not selected")
    }
}
