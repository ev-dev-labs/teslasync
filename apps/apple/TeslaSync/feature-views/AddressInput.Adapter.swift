//
//  AddressInput.Adapter.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  The testable projection core for the "Address" autocomplete — the faithful port of
//  features/driving/components/AddressInput.tsx. `AddressInputProjector` reproduces the component's
//  option pipeline VERBATIM (the `getOptionKey` identity `${lat}-${lng}-${display_name}`, the
//  `getOptionLabel` → `display_name` row text, the `onSelect` `{ lat, lng, name }` payload, the
//  `&limit=5` cap) and the menu-phase precedence the web `Combobox` + `useGeocodeSearch` imply.
//  Foundation-only so it is unit-tested without a bundle or a rendered view.
//

import Foundation

/// The dependency-free projection from cached `GeocodeResultDTO`s to de-duplicated, capped
/// suggestion rows, plus the menu-phase resolver. Every value uses the same identity + payload shape
/// as the web component so the web and native menus resolve identical rows for identical input.
public enum AddressInputProjector {
    /// Whether a query reaches the length that enables the search (web `query.length >= 3`).
    public static func meetsMinimumLength(_ query: String) -> Bool {
        query.count >= AddressInputConfig.minimumQueryLength
    }

    /// Builds the suggestion projection from the geocoder rows: drops blank address lines, maps each
    /// to its `getOptionKey` identity + `onSelect` payload, removes duplicate keys (web React keys
    /// are unique), and caps at the web `&limit=5`.
    public static func project(
        results: [GeocodeResultDTO],
        copy: AddressInputCopy = .fallback
    ) -> AddressInputProjection {
        var seen = Set<String>()
        var rows: [AddressSuggestion] = []
        for result in results {
            let name = result.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            let id = key(lat: result.lat, lng: result.lng, name: result.displayName)
            guard seen.insert(id).inserted else { continue }
            rows.append(
                AddressSuggestion(
                    id: id,
                    title: result.displayName,
                    location: TripLocationDTO(lat: result.lat, lng: result.lng, name: result.displayName),
                    accessibilityLabel: "\(copy.suggestionRole): \(result.displayName)"
                )
            )
            if rows.count >= AddressInputConfig.resultLimit { break }
        }
        return AddressInputProjection(suggestions: rows)
    }

    /// Resolves the menu phase, mirroring the web precedence: a below-minimum query is idle (the
    /// hook is disabled); otherwise loading short-circuits, then failure, then a resolved menu is
    /// content when it has rows and empty when it does not.
    public static func resolvePhase(
        _ status: AddressInputLoadStatus,
        queryLength: Int,
        hasResults: Bool
    ) -> AddressSuggestionsPhase {
        guard queryLength >= AddressInputConfig.minimumQueryLength else { return .idle }
        switch status {
        case .idle, .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded:
            return hasResults ? .content : .empty
        }
    }

    /// The web `getOptionKey(r)` identity, `"\(lat)-\(lng)-\(displayName)"`.
    static func key(lat: Double, lng: Double, name: String) -> String {
        "\(lat)-\(lng)-\(name)"
    }
}
