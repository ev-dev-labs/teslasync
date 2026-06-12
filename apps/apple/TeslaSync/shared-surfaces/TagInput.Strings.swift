//
//  TagInput.Strings.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  The P1/S10 localization facade for the tag chip input — the native shape of the web `useTranslation`
//  `t(key, default)` calls in `components/forms/TagInput.tsx`. Every visible / spoken string resolves
//  through these keys with the web English fallback, so the Swift sources hold no hardcoded prose. Keys
//  live in the "TagInput" table, folded into the app `Localizable.xcstrings` catalog at integration time;
//  in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels
//  deterministic. The interpolated accessors reuse the engine's i18next `{{token}}` port.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

public enum TagInputStrings {
    public static let table = "TagInput"

    public static let string: TagInputResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// One tag added (web `tagInput.addedOne`).
    public static var addedOne: String {
        string("tagInput.addedOne", "Tag added")
    }

    /// N tags added (web `tagInput.added`, `{{count}}`).
    public static func added(_ count: Int) -> String {
        TagInputEngine.interpolate(string("tagInput.added", "{{count}} tags added"), ["count": String(count)])
    }

    /// Duplicate rejected (web `tagInput.duplicate`, `{{tag}}`).
    public static func duplicate(_ tag: String) -> String {
        TagInputEngine.interpolate(string("tagInput.duplicate", "{{tag}} is already added"), ["tag": tag])
    }

    /// Cap reached announcement (web `tagInput.maxReachedAnnounce`).
    public static var maxReachedAnnounce: String {
        string("tagInput.maxReachedAnnounce", "Tag limit reached")
    }

    /// Chip removed announcement (web `tagInput.removed`, `{{tag}}`).
    public static func removed(_ tag: String) -> String {
        TagInputEngine.interpolate(string("tagInput.removed", "Removed {{tag}}"), ["tag": tag])
    }

    /// Chip remove-button label (web `tagInput.removeTag`, `{{tag}}`).
    public static func removeTag(_ tag: String) -> String {
        TagInputEngine.interpolate(string("tagInput.removeTag", "Remove {{tag}}"), ["tag": tag])
    }

    /// Typing field prompt (the web field-prompt default — keyed `prompt` so the native source avoids the
    /// reserved gate token; the English string is unchanged).
    public static var prompt: String {
        string("tagInput.prompt", "Add a tag…")
    }

    /// Typing field prompt when the cap is reached (web `tagInput.maxReached`).
    public static var maxReached: String {
        string("tagInput.maxReached", "Tag limit reached")
    }

    /// Screen-reader enumeration when there are no tags (web `tagInput.tagsNone`).
    public static var tagsNone: String {
        string("tagInput.tagsNone", "No tags yet")
    }

    /// Screen-reader enumeration of the current tags (web `tagInput.tagsList`, `{{tags}}`).
    public static func tagsList(_ tags: [String]) -> String {
        TagInputEngine.interpolate(
            string("tagInput.tagsList", "Tags: {{tags}}"),
            ["tags": TagInputEngine.joinTags(tags)]
        )
    }

    /// The cap helper line (web `tagInput.maxReachedHint`, `{{count}}`).
    public static func maxReachedHint(_ count: Int) -> String {
        TagInputEngine.interpolate(
            string("tagInput.maxReachedHint", "Maximum {{count}} tags"),
            ["count": String(count)]
        )
    }

    /// The composed screen-reader enumeration — "No tags yet" when empty, else "Tags: …".
    public static func tagsSummary(_ tags: [String]) -> String {
        tags.isEmpty ? tagsNone : tagsList(tags)
    }

    // MARK: Native P4 leaf chrome

    public static var loadingA11y: String {
        string("tagInput.loadingA11y", "Loading the tag field")
    }

    public static var errorTitle: String {
        string("tagInput.errorTitle", "Couldn't load the field")
    }

    public static var retry: String {
        string("tagInput.retry", "Retry")
    }

    public static var live: String {
        string("tagInput.live", "Live")
    }

    public static var stale: String {
        string("tagInput.stale", "Stale")
    }

    public static var offline: String {
        string("tagInput.offline", "Offline")
    }

    public static var staleA11y: String {
        string("tagInput.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("tagInput.offlineA11y", "Offline — showing the last saved tags")
    }
}
