//
//  AlertMessageEditor.Projection.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The projected output types for the message-template editor (one autocomplete suggestion row, the
//  grouped suggestion list, one preset card, the resolved gallery), the diagnostics surface slug,
//  and the VoiceOver summary builders. Foundation-only so it executes on a plain host and is pinned
//  by the adapter tests.
//

import Foundation

// MARK: - Token autocomplete projection

/// One autocomplete suggestion row (web grouped option): the `{{key}}` insertion, the label, the
/// flat cursor index keyboard navigation highlights against, and a combined VoiceOver label.
public struct TokenSuggestion: Sendable, Equatable, Identifiable {
    /// Stable identity — the unique token key (web React key).
    public var id: String
    /// The token key shown as `{{key}}` (web `key`).
    public var key: String
    /// The human-readable label (web `label`).
    public var label: String
    /// The exact text spliced into the template (`"{{key}}"`).
    public var insertion: String
    /// The position in the flattened filtered sequence — the cursor space the web `index` highlights.
    public var flatIndex: Int
    /// The combined VoiceOver label (role word + `{{key}}` + label).
    public var accessibilityLabel: String

    public init(
        id: String,
        key: String,
        label: String,
        insertion: String,
        flatIndex: Int,
        accessibilityLabel: String
    ) {
        self.id = id
        self.key = key
        self.label = label
        self.insertion = insertion
        self.flatIndex = flatIndex
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One catalog group (web `grouped` bucket): the group name + its suggestion rows, in first-seen
/// order so the menu reads cleanly while the flat index keeps keyboard nav predictable.
public struct TokenSuggestionGroup: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var tokens: [TokenSuggestion]

    public init(name: String, tokens: [TokenSuggestion]) {
        id = name
        self.name = name
        self.tokens = tokens
    }
}

/// The fully projected autocomplete list (web resolved + filtered token list): the display groups
/// plus the flattened cursor-space sequence.
public struct TokenSuggestionProjection: Sendable, Equatable {
    public var groups: [TokenSuggestionGroup]
    public var flat: [TokenSuggestion]

    public init(groups: [TokenSuggestionGroup], flat: [TokenSuggestion]) {
        self.groups = groups
        self.flat = flat
    }

    /// Whether the menu shows rows (vs its empty / loading states).
    public var hasSuggestions: Bool {
        !flat.isEmpty
    }

    public static let empty = TokenSuggestionProjection(groups: [], flat: [])
}

// MARK: - Preset gallery projection

/// One preset card (web gallery `<li>`): the name, optional description, the template (shown in a
/// code chip), the tags, and a combined VoiceOver label.
public struct PresetCardModel: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var template: String
    public var summary: String?
    public var tags: [String]
    public var accessibilityLabel: String

    public init(
        id: String,
        name: String,
        template: String,
        summary: String?,
        tags: [String],
        accessibilityLabel: String
    ) {
        self.id = id
        self.name = name
        self.template = template
        self.summary = summary
        self.tags = tags
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The resolved preset gallery (web op-valid + tag-filtered presets): the sorted tag chips + the
/// cards for the active filter.
public struct PresetGalleryProjection: Sendable, Equatable {
    public var tags: [String]
    public var cards: [PresetCardModel]

    public init(tags: [String], cards: [PresetCardModel]) {
        self.tags = tags
        self.cards = cards
    }

    /// Whether the gallery shows cards (vs its empty / loading states).
    public var hasCards: Bool {
        !cards.isEmpty
    }

    public static let empty = PresetGalleryProjection(tags: [], cards: [])
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free
/// core so it is reachable from the projection's unit tests.
public enum AlertMessageEditorSurface {
    public static let slug = "AlertMessageEditor"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum AlertMessageEditorAccessibility {
    /// The spoken status of the token autocomplete area for the current phase.
    public static func tokenSummary(
        for phase: TokenSuggestionsPhase,
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .hidden:
            return localize("alertEditor.a11y.tokensHidden", "Type two opening braces to insert a value")
        case .loading:
            return localize("alertEditor.a11y.tokensLoading", "Loading suggestions")
        case .content:
            let template = localize("alertEditor.a11y.tokensResults", "%d suggestions")
            return String(format: template, count)
        case .empty:
            return localize("alertEditor.a11y.tokensEmpty", "No matching suggestions")
        }
    }

    /// The spoken status of the live-preview panel for the current phase.
    public static func previewSummary(
        for phase: PreviewPhase,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .empty:
            localize("alertEditor.a11y.previewEmpty", "Start typing to see a preview")
        case .loading:
            localize("alertEditor.a11y.previewLoading", "Rendering preview")
        case .content:
            localize("alertEditor.a11y.previewContent", "Notification preview")
        case .error:
            localize("alertEditor.a11y.previewError", "Preview failed")
        }
    }

    /// The spoken status of the preset gallery for the current phase.
    public static func presetSummary(
        for phase: PresetGalleryPhase,
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .loading:
            return localize("alertEditor.a11y.presetsLoading", "Loading presets")
        case .content:
            let template = localize("alertEditor.a11y.presetsResults", "%d presets")
            return String(format: template, count)
        case .empty:
            return localize("alertEditor.a11y.presetsEmpty", "No presets match this filter")
        case .error:
            return localize("alertEditor.a11y.presetsError", "Couldn't load presets")
        }
    }
}
