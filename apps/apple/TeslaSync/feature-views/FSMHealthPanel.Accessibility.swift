//
//  FSMHealthPanel.Accessibility.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  The pure (Foundation-only) presentation tail of the FSM-health surface, split out of
//  `FSMHealthPanel.Adapter.swift` to keep each file within the house length budget: the
//  P1/S11 diagnostics surface slug, the locale-aware whole-number formatting (the card
//  count, web `fmtInt`), the localized alert title / message builders (web `t(key,
//  default, { count })`, including the `{{count}}` interpolation), and the VoiceOver
//  panel summary. Everything here is dependency-free so it unit-tests without a bundle or
//  a view, through an injected localizer (`(key, fallback) -> String`) + a `locale`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum FSMHealthPanelSurface {
    public static let slug = "FSMHealthPanel"
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware whole-number formatting for the alert count badge — the native parity of
/// the web `fmtInt(alert.count)` (grouped integer). Used by the card and the a11y summary.
public enum FSMHealthFormat {
    public static func count(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

// MARK: - Localized titles + messages (web `t(key, default, { count })`)

/// Builds the surface's alert titles + count messages through an injected localizer
/// (`(key, fallback) -> String`), so the view holds no hardcoded literals and the copy is
/// bundle-free testable. The `{{count}}` token in each message fallback is interpolated
/// with the raw count, matching the web i18next interpolation (the grouped badge number is
/// formatted separately by `FSMHealthFormat`).
public enum FSMHealthMessages {
    /// The i18n key + web English fallback for an alert's count message.
    public static func messageDescriptor(for kind: FSMHealthAlertKind) -> (key: String, fallback: String) {
        switch kind {
        case .flap:
            (
                "fsm.health.flapping",
                "{{count}} transitions flagged as state flapping (>5 same-FSM transitions/min)"
            )
        case .stuck:
            ("fsm.health.stuck", "{{count}} session(s) stuck in pending/active for >4 hours")
        case .recovery:
            ("fsm.health.recoveries", "{{count}} session(s) recovered after pod restart")
        }
    }

    /// The i18n key + web English fallback for an alert's card title.
    public static func titleDescriptor(for kind: FSMHealthAlertKind) -> (key: String, fallback: String) {
        switch kind {
        case .flap:
            ("fsm.health.flapTitle", "State Flapping")
        case .stuck:
            ("fsm.health.stuckTitle", "Stuck Sessions")
        case .recovery:
            ("fsm.health.recoveryTitle", "Pod Recoveries")
        }
    }

    /// The localized count message for an alert — web `t(key, default, { count })`.
    public static func message(
        for alert: FSMHealthAlert,
        localize: (String, String) -> String
    ) -> String {
        let descriptor = messageDescriptor(for: alert.kind)
        return localize(descriptor.key, descriptor.fallback)
            .replacingOccurrences(of: "{{count}}", with: "\(alert.count)")
    }

    /// The localized card title for an alert kind.
    public static func title(
        for kind: FSMHealthAlertKind,
        localize: (String, String) -> String
    ) -> String {
        let descriptor = titleDescriptor(for: kind)
        return localize(descriptor.key, descriptor.fallback)
    }

    /// The localized all-clear copy (web `fsm.health.allClear`).
    public static func allClear(localize: (String, String) -> String) -> String {
        localize(
            "fsm.health.allClear",
            "All FSMs healthy — no flapping, stuck sessions, or recoveries detected"
        )
    }

    /// The localized panel title (web `fsm.health.title`).
    public static func panelTitle(localize: (String, String) -> String) -> String {
        localize("fsm.health.title", "FSM Health")
    }
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary through an injected localizer + a `locale`, so
/// it is bundle-free testable. The whole panel is summarized as one element: the all-clear
/// copy when healthy, or the panel title followed by each alert's title + message.
public enum FSMHealthAccessibility {
    public static func summary(
        for phase: FSMHealthPhase,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        switch phase {
        case .loading:
            return localize("fsm.health.loadingA11y", "Loading FSM health")
        case let .error(message):
            let title = localize("fsm.health.errorTitle", "Couldn't load FSM health")
            return message.isEmpty ? title : "\(title): \(message)"
        case .healthy:
            return FSMHealthMessages.allClear(localize: localize)
        case let .alerts(alerts):
            let title = FSMHealthMessages.panelTitle(localize: localize)
            let parts = alerts.map { alert -> String in
                let alertTitle = FSMHealthMessages.title(for: alert.kind, localize: localize)
                let message = FSMHealthMessages.message(for: alert, localize: localize)
                let badge = FSMHealthFormat.count(alert.count, locale: locale)
                return "\(alertTitle), \(badge): \(message)"
            }
            return ([title] + parts).joined(separator: ". ")
        }
    }
}
