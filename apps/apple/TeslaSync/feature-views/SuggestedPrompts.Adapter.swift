//
//  SuggestedPrompts.Adapter.swift
//  TeslaSync — P4 feature view · 0223 · SuggestedPrompts (Apple)
//
//  The testable projection core for the chatbot empty-state suggestion strip — the
//  SwiftUI parity of features/system/components/chatbot/SuggestedPrompts.tsx and the
//  `getChatSuggestions()` helper it renders from. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the suggestion catalog,
//  the cached → projection mapping, and the VoiceOver content are all unit tested in
//  isolation.
//
//  Parity note: the web source defines the chips as an in-process `const` today, with
//  a documented intent to swap in a backend-fed endpoint later "without touching the
//  component shape". The native surface mirrors that exactly — the catalog below is
//  the default feed, but the projection maps any `[ChatSuggestion]` the P1/S8 source
//  delivers (so the future server feed drops in unchanged), and each entry keeps the
//  web `i18nKey` + `defaultValue` so the display text resolves through the i18n facade.
//

import Foundation

// MARK: - Suggestion model (web `ChatSuggestion` interface)

/// One suggestion chip — the native mirror of the web `ChatSuggestion`. `i18nKey`
/// resolves the localized text through the surface facade; `defaultValue` is the web
/// English fallback, kept inline so a missing catalog entry still renders the source
/// copy (the same `t(key, default)` contract the web component relies on).
public struct ChatSuggestion: Equatable, Sendable {
    public let i18nKey: String
    public let defaultValue: String

    public init(i18nKey: String, defaultValue: String) {
        self.i18nKey = i18nKey
        self.defaultValue = defaultValue
    }
}

/// The default in-process suggestions — the verbatim native port of the web
/// `getChatSuggestions()` array (same keys, same English defaults, same order). The
/// production app may instead feed server-sourced suggestions through the P1/S8
/// source; this catalog backs previews, tests, and the offline/default path.
public enum SuggestedPromptsCatalog {
    public static let defaults: [ChatSuggestion] = [
        ChatSuggestion(
            i18nKey: "chatbot.suggestion.fleetYesterday",
            defaultValue: "What did my fleet do yesterday?"
        ),
        ChatSuggestion(
            i18nKey: "chatbot.suggestion.chargingCost30d",
            defaultValue: "Charging cost last 30 days"
        ),
        ChatSuggestion(
            i18nKey: "chatbot.suggestion.socDropping",
            defaultValue: "Why is my SoC dropping faster this week?"
        ),
        ChatSuggestion(
            i18nKey: "chatbot.suggestion.efficientDrive",
            defaultValue: "Show me the most efficient drive this month"
        )
    ]
}

// MARK: - Resolved chip (web `suggestions.map(...)` render item)

/// One resolved chip — the native mirror of the web `<li>` render item. The display
/// label is carried as an i18n key + English fallback (resolved in the view through
/// the facade), and `id` keys the list off the stable `i18nKey` exactly as the web
/// `key={s.i18nKey}` does.
public struct SuggestedPrompt: Identifiable, Equatable, Sendable {
    public let id: String
    public let i18nKey: String
    public let fallback: String

    public init(i18nKey: String, fallback: String) {
        id = i18nKey
        self.i18nKey = i18nKey
        self.fallback = fallback
    }
}

// MARK: - Projection (web render branches)

/// The resolved, view-ready chip list — a pure function of the cached suggestions.
/// `hasData` drives the model's content/empty phase split.
public struct SuggestedPromptsProjection: Equatable, Sendable {
    public let items: [SuggestedPrompt]

    public init(items: [SuggestedPrompt]) {
        self.items = items
    }

    /// Whether any chip resolved — the web `suggestions.length > 0` condition.
    public var hasData: Bool {
        !items.isEmpty
    }

    /// The no-data projection (the future backend-fed "no suggestions" case).
    public static let empty = SuggestedPromptsProjection(items: [])
}

/// Pure projection from cached suggestions to the resolved chip list — the native
/// port of the web `suggestions.map((s) => …)`. Entries with a blank `i18nKey` are
/// dropped so the list never renders an un-keyable, untranslatable chip (null safety
/// the web array shape assumes but does not enforce). Unit tested in isolation.
public enum SuggestedPromptsAdapter {
    public static func project(_ suggestions: [ChatSuggestion]) -> SuggestedPromptsProjection {
        let items = suggestions
            .filter { !$0.i18nKey.isEmpty }
            .map { SuggestedPrompt(i18nKey: $0.i18nKey, fallback: $0.defaultValue) }
        return SuggestedPromptsProjection(items: items)
    }
}
