//
//  DraftRecoveryBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  The testable, dependency-light core for the draft-recovery banner — the SwiftUI parity of
//  `components/feedback/DraftRecoveryBanner.tsx`. Everything here is pure (Foundation only): the
//  recovered-draft value type (the web `useFormDraft` `hasDraft` / `draftSavedAt` / `itemNoun`), the
//  relative-time stamp (the port of `formatRelativeTime` the web banner calls for the "from N
//  minutes ago" copy), the message builder (the web `t('draft.restoredItem' | 'draft.restored', …)`
//  branch with its `{{noun}}` / `{{when}}` i18next interpolation), and the VoiceOver label builder.
//  No store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface is a controlled presentational component. The parent (an editor wired
//  to `useFormDraft`) supplies `hasDraft`, `draftSavedAt`, `itemNoun`, and the `onRestore` /
//  `onDiscard` handlers; the banner computes the "{noun} draft restored from {when}." copy and offers
//  "Use draft" + "Discard draft", hiding itself once either is chosen. This core reproduces those pure
//  derivations as values and functions; the SwiftUI chrome layers on top in the sibling view files.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias DraftRecoveryResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Recovered draft (web `useFormDraft` subset)

/// One recovered draft as the banner consumes it — the native mirror of the subset of the web
/// `useFormDraft` result the banner reads: when the draft was last persisted (`draftSavedAt`, `nil`
/// when unknown) and the optional noun customising the copy (`itemNoun`, e.g. "rule" / "automation" /
/// "settings"). The presence of a value is the native parity of the web `hasDraft` truthiness.
public struct DraftRecoveryDraft: Sendable, Equatable {
    /// Web `draftSavedAt` — when the draft was last persisted; `nil` drives the "a moment ago" copy.
    public let savedAt: Date?
    /// Web `itemNoun` — the noun folded into the "{noun} draft restored …" copy; `nil` / empty omits.
    public let itemNoun: String?

    public init(savedAt: Date?, itemNoun: String? = nil) {
        self.savedAt = savedAt
        self.itemNoun = itemNoun
    }
}

// MARK: - i18next interpolation (web `t(key, { noun, when, count })`)

/// Replaces `{{token}}` markers with their values — the native parity of the web i18next
/// interpolation the banner relies on (`{{noun}}`, `{{when}}`, `{{count}}`). Pure + public so the
/// substitution is asserted directly.
public enum DraftRecoveryInterpolation {
    public static func apply(_ template: String, _ values: [String: String]) -> String {
        var output = template
        for (token, value) in values {
            output = output.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return output
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

/// Formats the "draft saved {when}" stamp matching the web `formatRelativeTime` thresholds from
/// `web/src/lib/dateFormat.ts`:
///
///     const diffMin = floor((now - d) / 60_000)
///     if (diffMin < 1)  return 'Just now'
///     if (diffMin < 60) return `${diffMin}m ago`
///     const diffHrs = floor(diffMin / 60)
///     if (diffHrs < 24) return `${diffHrs}h ago`
///     return d.toLocaleDateString(locale, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
///
/// Native code holds no English literals, so the three relative phrases resolve through the P1/S10
/// facade (the `{{count}}` token mirrors the web interpolation) and the absolute branch is produced
/// with a locale-aware `Date.FormatStyle`. The clock is injected so the output is deterministic under
/// test.
public enum DraftRecoveryRelativeTime {
    public static func string(
        for instant: Date,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: DraftRecoveryResolve = DraftRecoveryStrings.string
    ) -> String {
        let diffMinutes = Int((now.timeIntervalSince(instant) / 60).rounded(.down))
        if diffMinutes < 1 {
            return strings("draft.relative.justNow", "Just now")
        }
        if diffMinutes < 60 {
            return DraftRecoveryInterpolation.apply(
                strings("draft.relative.minutesAgo", "{{count}}m ago"),
                ["count": number(diffMinutes, locale: locale)]
            )
        }
        let diffHours = diffMinutes / 60
        if diffHours < 24 {
            return DraftRecoveryInterpolation.apply(
                strings("draft.relative.hoursAgo", "{{count}}h ago"),
                ["count": number(diffHours, locale: locale)]
            )
        }
        return absolute(instant, locale: locale)
    }

    /// The locale-formatted integer for the `{{count}}` token (the parity of the web `${diffMin}`
    /// interpolation, localized for digit shaping, no grouping separators).
    private static func number(_ value: Int, locale: Locale) -> String {
        value.formatted(.number.locale(locale).grouping(.never))
    }

    /// The absolute fallback (older than a day) — a locale-aware "MMM d, h:mm a" style omitting the
    /// year, matching the web `toLocaleDateString` field set (month abbreviated, day, hour, minute).
    private static func absolute(_ instant: Date, locale: Locale) -> String {
        instant.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
                .hour()
                .minute()
                .locale(locale)
        )
    }
}

// MARK: - Message (web `t('draft.restoredItem' | 'draft.restored', …)`)

/// Builds the banner's reassurance copy — the native port of the web message branch:
///
///     const when = draftSavedAt ? formatRelativeTime(draftSavedAt) : t('draft.unknownTime', 'a moment ago')
///     const message = itemNoun
///       ? t('draft.restoredItem', '{{noun}} draft restored from {{when}}.', { noun: itemNoun, when })
///       : t('draft.restored', 'Draft restored from {{when}}.', { when })
///
/// A non-empty `itemNoun` selects the noun-qualified key (web truthiness: an empty string falls back
/// to the plain key). Pure + public so both branches are unit tested.
public enum DraftRecoveryMessage {
    /// Resolves the "{when}" fragment: the relative-time stamp for a known save instant, else the web
    /// `draft.unknownTime` ("a moment ago") fallback.
    public static func when(
        savedAt: Date?,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: DraftRecoveryResolve = DraftRecoveryStrings.string
    ) -> String {
        guard let savedAt else {
            return strings("draft.unknownTime", "a moment ago")
        }
        return DraftRecoveryRelativeTime.string(for: savedAt, now: now, locale: locale, strings: strings)
    }

    /// Composes the full message from a resolved "{when}" fragment + the optional noun.
    public static func build(
        itemNoun: String?,
        when whenText: String,
        strings: DraftRecoveryResolve = DraftRecoveryStrings.string
    ) -> String {
        if let noun = itemNoun, !noun.isEmpty {
            let template = strings("draft.restoredItem", "{{noun}} draft restored from {{when}}.")
            return DraftRecoveryInterpolation.apply(template, ["noun": noun, "when": whenText])
        }
        let template = strings("draft.restored", "Draft restored from {{when}}.")
        return DraftRecoveryInterpolation.apply(template, ["when": whenText])
    }

    /// Convenience: resolve "{when}" then compose — the single-call parity of the web render.
    public static func render(
        draft: DraftRecoveryDraft,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        strings: DraftRecoveryResolve = DraftRecoveryStrings.string
    ) -> String {
        let whenText = when(savedAt: draft.savedAt, now: now, locale: locale, strings: strings)
        return build(itemNoun: draft.itemNoun, when: whenText, strings: strings)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's VoiceOver label from the already-localised message, so the spoken content is
/// asserted without rendering. Mirrors the web `AlertBanner` body being the announced content: the
/// reassurance sentence is read in one pass, with the "Use draft" / "Discard draft" controls staying
/// individually focusable.
public enum DraftRecoveryAccessibility {
    /// Normalises the message for the spoken label — collapses internal runs of whitespace (a wrapped
    /// "{noun} draft restored from …" never reads a double space) and trims the ends.
    public static func bannerLabel(message: String) -> String {
        message
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
