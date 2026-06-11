//
//  EmptyStateThreshold.Adapter.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  The testable, dependency-light core for the EmptyStateThreshold shared surface — the SwiftUI
//  parity of `components/feedback/EmptyStateThreshold.tsx`. Everything here is pure (Foundation
//  only): the localization seam (web `useTranslation` `t(key, fallback)`), the i18n keys the web
//  source resolves, the verbatim/localized text line, the count message (the custom override vs the
//  auto-generated "Need at least N {noun}…" copy with the web `{{threshold}}` / `{{noun}}` /
//  `{{current}}` interpolation), the controlled gate (the web props: `currentCount`, `threshold`,
//  `itemNoun`, `sectionLabel`, `description`, `message`, `action`), the connectivity axis, the
//  resolved `.threshold` content, the SF Symbols, and the VoiceOver label builder. No store, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `EmptyStateThreshold` is a fully-controlled presentational empty state — the
//  caller supplies the counts + labels and an optional CTA, and the only data dependency is
//  `useTranslation`. The green check signals the section is healthy and merely waiting for scale, so
//  the surface is never silently hidden. The tint + composition are applied at the view boundary
//  (P1/S9 tokens); this file only owns the value types so they are asserted without rendering.
//

import Foundation

// MARK: - Localization seam (web `t(key, fallback)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias EmptyStateThresholdResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - i18n keys (the web source `t(...)` keys)

/// The translation keys the web source resolves, kept as constants so the projection holds no string
/// literals and the tests assert the exact keys the web component uses.
public enum EmptyStateThresholdKeys {
    /// Web `t('emptyState.threshold.defaultItem', 'items')` — the fallback item noun.
    public static let defaultItem = "emptyState.threshold.defaultItem"
    /// Web `t('emptyState.threshold.message', 'Need at least {{threshold}} {{noun}}…')` — the count copy.
    public static let message = "emptyState.threshold.message"
}

// MARK: - SF Symbols (web lucide icons)

/// The SF Symbols that name the web lucide icons: the leading `CheckCircle2` (the section is healthy,
/// just waiting for scale) and the small trailing `Info` next to the title. Kept as constants so they
/// are asserted without rendering.
public enum EmptyStateThresholdSymbols {
    /// Web `CheckCircle2` — the leading "healthy / waiting for more data" check.
    public static let status = "checkmark.circle.fill"
    /// Web `Info` — the small informational glyph beside the section title.
    public static let info = "info.circle"
}

// MARK: - Text (verbatim caller content vs facade-resolved copy)

/// One line of surface text. `verbatim` carries an already-resolved runtime string (the web
/// `sectionLabel` / a `description` or `message` node the caller already localised); `localized`
/// carries a (key, English fallback) pair the view resolves through the P1/S10 facade. Keeping the
/// projection in terms of this enum keeps it pure and lets tests assert the keys directly.
public enum EmptyStateThresholdText: Sendable, Equatable {
    case verbatim(String)
    case localized(key: String, fallback: String)

    /// Resolves the line to a display string: a `verbatim` value is returned as-is (web parity for a
    /// caller-supplied string node); a `localized` line is resolved through the supplied facade (web
    /// `t(key, fallback)`). Pure, so it is asserted with an identity resolver.
    public func resolve(_ resolver: EmptyStateThresholdResolve) -> String {
        switch self {
        case let .verbatim(value): value
        case let .localized(key, fallback): resolver(key, fallback)
        }
    }
}

// MARK: - Message (custom override vs auto-generated count copy)

/// The surface message — the native mirror of the web `message ?? defaultMessage`. `custom` is the
/// caller's `message` override; `auto` reproduces the default copy, resolving the noun (the
/// `itemNoun` prop, falling back to `emptyState.threshold.defaultItem`) and interpolating the web
/// i18next tokens (`{{threshold}}`, `{{noun}}`, `{{current}}`). Pure + asserted directly.
public enum EmptyStateThresholdMessage: Sendable, Equatable {
    case custom(EmptyStateThresholdText)
    case auto(threshold: Int, noun: EmptyStateThresholdText?, current: Int)

    /// The default copy fallback, kept here so the resolved string matches the web source verbatim.
    public static let defaultTemplate =
        "Need at least {{threshold}} {{noun}} to show meaningful patterns. You have {{current}} so far."

    /// Resolves the message to a display string. `custom` resolves its text node; `auto` resolves the
    /// noun (caller `itemNoun` or the localized default) and interpolates it with the counts into the
    /// localized template — the exact native parity of the web i18next call.
    public func resolve(_ resolver: EmptyStateThresholdResolve) -> String {
        switch self {
        case let .custom(text):
            return text.resolve(resolver)
        case let .auto(threshold, noun, current):
            let resolvedNoun = noun?.resolve(resolver) ?? resolver(EmptyStateThresholdKeys.defaultItem, "items")
            let template = resolver(EmptyStateThresholdKeys.message, EmptyStateThresholdMessage.defaultTemplate)
            return template
                .replacingOccurrences(of: "{{threshold}}", with: String(threshold))
                .replacingOccurrences(of: "{{noun}}", with: resolvedNoun)
                .replacingOccurrences(of: "{{current}}", with: String(current))
        }
    }
}

// MARK: - Connectivity (P4 connectivity axis)

/// The freshness of the feed the counts are read over — the native mirror of the live / stale /
/// offline axis. `live` shows neither the chip nor a stale auto-refresh; `stale` / `offline` surface
/// the freshness chip beneath the card (the counts may be out of date) without hiding the surface.
public enum EmptyStateThresholdConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Gate (the controlled web props)

/// The controlled threshold gate the host wants to show — the native parity of the web
/// `EmptyStateThreshold` props (`currentCount`, `threshold`, `itemNoun`, `sectionLabel`,
/// `description`, `message`, and whether a CTA `action` is offered). A pure value, so the resolved
/// content + message are asserted without rendering.
public struct EmptyStateThresholdGate: Sendable, Equatable {
    public let currentCount: Int
    public let threshold: Int
    public let sectionLabel: EmptyStateThresholdText
    public let itemNoun: EmptyStateThresholdText?
    public let description: EmptyStateThresholdText?
    public let customMessage: EmptyStateThresholdText?
    public let actionLabel: EmptyStateThresholdText?

    public init(
        currentCount: Int,
        threshold: Int,
        sectionLabel: EmptyStateThresholdText,
        itemNoun: EmptyStateThresholdText? = nil,
        description: EmptyStateThresholdText? = nil,
        customMessage: EmptyStateThresholdText? = nil,
        actionLabel: EmptyStateThresholdText? = nil
    ) {
        self.currentCount = currentCount
        self.threshold = threshold
        self.sectionLabel = sectionLabel
        self.itemNoun = itemNoun
        self.description = description
        self.customMessage = customMessage
        self.actionLabel = actionLabel
    }

    /// The surface message — the native parity of the web `message ?? defaultMessage`. A supplied
    /// `customMessage` wins; otherwise the auto count copy is derived from the threshold + counts.
    public var message: EmptyStateThresholdMessage {
        if let customMessage {
            return .custom(customMessage)
        }
        return .auto(threshold: threshold, noun: itemNoun, current: currentCount)
    }

    /// The resolved render value. The CTA is shown only when the caller supplied a label AND the host
    /// wired a handler (web parity for the optional `action` node needing something to do).
    public func content(canAct: Bool) -> EmptyStateThresholdContent {
        EmptyStateThresholdContent(
            sectionLabel: sectionLabel,
            description: description,
            message: message,
            actionLabel: actionLabel,
            showAction: actionLabel != nil && canAct
        )
    }
}

// MARK: - Resolved content (the `.threshold` payload)

/// The fully-derived threshold card — the data render of the surface, reproducing the web
/// composition: the section title, the optional description line, the required message line, and
/// whether the optional trailing CTA is shown. A pure value so the view is a function of it and
/// snapshot assertions read it directly.
public struct EmptyStateThresholdContent: Sendable, Equatable {
    public let sectionLabel: EmptyStateThresholdText
    public let description: EmptyStateThresholdText?
    public let message: EmptyStateThresholdMessage
    public let actionLabel: EmptyStateThresholdText?
    public let showAction: Bool

    public init(
        sectionLabel: EmptyStateThresholdText,
        description: EmptyStateThresholdText?,
        message: EmptyStateThresholdMessage,
        actionLabel: EmptyStateThresholdText?,
        showAction: Bool
    ) {
        self.sectionLabel = sectionLabel
        self.description = description
        self.message = message
        self.actionLabel = actionLabel
        self.showAction = showAction
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's combined VoiceOver label from already-resolved parts, so the spoken content
/// (the web `role="status"` live region) is asserted without rendering. Reads the section title, then
/// the description (when present), then the message as one sentence; parts already ending in terminal
/// punctuation are joined with a single space so the sentence never doubles a period.
public enum EmptyStateThresholdAccessibility {
    public static func label(sectionLabel: String, description: String?, message: String) -> String {
        var parts: [String] = []
        if !sectionLabel.isEmpty {
            parts.append(sectionLabel)
        }
        if let description, !description.isEmpty {
            parts.append(description)
        }
        if !message.isEmpty {
            parts.append(message)
        }
        return parts.reduce(into: "") { accumulated, part in
            guard !accumulated.isEmpty else {
                accumulated = part
                return
            }
            let endsWithTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            accumulated += (endsWithTerminal ? " " : ". ") + part
        }
    }
}
