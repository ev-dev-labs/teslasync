//
//  NotificationGroupRow.Copy.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  The pure (Foundation-only) parameterized labels, formatters, surface identity,
//  and VoiceOver summaries for the notification-thread surface — split out of the
//  adapter so each file stays focused + testable. Copy resolves through an injected
//  localizer (`(key, fallback) -> String`) so it is testable without a bundle,
//  exactly like the view's P1/S10 facade. `%lld` is substituted with the count to
//  match the web `{{count}}` interpolation.
//

import Foundation

// MARK: - Copy (the parameterized labels, web `t(key, default, {count})`)

/// Builds the surface's parameterized labels (web `t(key, default, {count})`).
public enum NotificationGroupCopy {
    /// Web expand toggle label: `expanded ? t('…collapse','Hide similar')
    /// : t('…expand','Show {{count}} similar', {count: extraCount})`.
    public static func expandLabel(
        expanded: Bool,
        extraCount: Int,
        localize: (String, String) -> String
    ) -> String {
        if expanded {
            return localize("notifications.group.collapse", "Hide similar")
        }
        let format = localize("notifications.group.expand", "Show %lld similar")
        return String.localizedStringWithFormat(format, extraCount)
    }

    /// Web `+{{count}} similar` chip label.
    public static func similarChip(
        extraCount: Int,
        localize: (String, String) -> String
    ) -> String {
        let format = localize("notifications.group.similar", "+%lld similar")
        return String.localizedStringWithFormat(format, extraCount)
    }

    /// Web `{{count}} vehicles affected` hint.
    public static func vehiclesAffected(
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        let format = localize("notifications.group.vehicleAffected", "%lld vehicles affected")
        return String.localizedStringWithFormat(format, count)
    }

    /// Web success toast `Marked {{count}} thread members as read`.
    public static func markReadSuccess(
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        let format = localize(
            "notifications.group.markReadSuccess",
            "Marked %lld thread members as read"
        )
        return String.localizedStringWithFormat(format, count)
    }

    /// Web error toast `Could not mark group as read`.
    public static func markReadError(localize: (String, String) -> String) -> String {
        localize("notifications.group.markReadError", "Could not mark group as read")
    }
}

// MARK: - Formatting

/// Locale-aware formatting helpers (counts + the row timestamp). Pure + testable.
public enum NotificationGroupFormat {
    /// Grouped integer (the unread-count chip).
    public static func count(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// The row timestamp (web `<DateTime>`), as a short localized date + time. A
    /// fixed locale + time zone makes it deterministic for snapshot/unit tests.
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
public enum NotificationGroupRowSurface {
    public static let slug = "NotificationGroupRow"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer so the summaries are testable without a bundle.
public enum NotificationGroupAccessibility {
    /// One row's VoiceOver value: severity, read-state, time, vehicle, rule, title.
    public static func rowLabel(
        _ row: NotificationLogProjection,
        localize: (String, String) -> String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        var parts: [String] = []
        parts.append(localize(row.severity.localizationKey, row.severity.fallback))
        parts.append(
            row.isRead
                ? localize("notifications.group.a11y.read", "Read")
                : localize("notifications.group.a11y.unread", "Unread")
        )
        parts.append(NotificationGroupFormat.timestamp(row.createdAt, locale: locale, timeZone: timeZone))
        if let vehicle = row.vehicleName, !vehicle.isEmpty {
            parts.append(vehicle)
        }
        if let rule = row.ruleName, !rule.isEmpty {
            parts.append(rule)
        }
        parts.append(row.title)
        return parts.joined(separator: ", ")
    }

    /// The thread-level summary: the latest row + the similar/unread/affected counts.
    public static func groupSummary(
        _ group: NotificationGroupProjection,
        localize: (String, String) -> String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        var parts: [String] = [
            rowLabel(group.latest, localize: localize, locale: locale, timeZone: timeZone)
        ]
        guard !group.isSingleton else {
            return parts.joined(separator: ", ")
        }
        if group.extraCount > 0 {
            parts.append(NotificationGroupCopy.similarChip(extraCount: group.extraCount, localize: localize))
        }
        if group.unreadCount > 0 {
            let format = localize("notifications.group.a11y.unreadCount", "%lld unread")
            parts.append(String.localizedStringWithFormat(format, group.unreadCount))
        }
        if group.vehicleAffectedCount > 0 {
            parts.append(
                NotificationGroupCopy.vehiclesAffected(count: group.vehicleAffectedCount, localize: localize)
            )
        }
        return parts.joined(separator: ", ")
    }
}
