//
//  AddressInput.Projection.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  The projected output types for the "Address" autocomplete (one resolved suggestion row + the
//  whole-list projection), the diagnostics surface slug, and the VoiceOver summary builder.
//  Foundation-only so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Projected pieces

/// One resolved suggestion row (web `renderOption`): the address line shown, the coordinates emitted
/// to the parent on select, a stable identity (web `getOptionKey` → `${lat}-${lng}-${display_name}`),
/// and a combined VoiceOver label.
public struct AddressSuggestion: Sendable, Equatable, Identifiable {
    /// Stable identity — the web `getOptionKey(r)` `"\(lat)-\(lng)-\(displayName)"`.
    public var id: String
    /// The address line shown in the row (web `getOptionLabel` → `display_name`).
    public var title: String
    /// The coordinates + name emitted to the parent's `onSelect` when this row is chosen.
    public var location: TripLocationDTO
    /// The combined VoiceOver label (role word + address line).
    public var accessibilityLabel: String

    public init(id: String, title: String, location: TripLocationDTO, accessibilityLabel: String) {
        self.id = id
        self.title = title
        self.location = location
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected suggestion list (web resolved `options`): the de-duplicated, capped rows the
/// menu renders. Empty rows reproduce the web `Combobox` empty menu.
public struct AddressInputProjection: Sendable, Equatable {
    public var suggestions: [AddressSuggestion]

    public init(suggestions: [AddressSuggestion]) {
        self.suggestions = suggestions
    }

    /// Whether the menu shows rows (vs its empty / idle / loading states).
    public var hasSuggestions: Bool {
        !suggestions.isEmpty
    }

    public static let empty = AddressInputProjection(suggestions: [])
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free
/// core so it is reachable from the projection's unit tests.
public enum AddressInputSurface {
    public static let slug = "AddressInput"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum AddressInputAccessibility {
    /// The spoken status of the suggestion area for the current phase. `count` is the resolved
    /// suggestion count (only meaningful for `.content`).
    public static func resultsSummary(
        for phase: AddressSuggestionsPhase,
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .idle:
            return localize(
                "addressInput.a11y.idle",
                "Type at least 3 characters to search addresses"
            )
        case .loading:
            return localize("addressInput.a11y.loading", "Searching addresses")
        case .content:
            let template = localize("addressInput.a11y.results", "%d address suggestions")
            return String(format: template, count)
        case .empty:
            return localize("addressInput.a11y.empty", "No matching addresses")
        case .error:
            return localize("addressInput.a11y.error", "Couldn't search addresses")
        }
    }
}
