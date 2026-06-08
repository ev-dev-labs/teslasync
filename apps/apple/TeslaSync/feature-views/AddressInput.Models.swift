//
//  AddressInput.Models.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  The Foundation-only value types for the geocoded "Address" autocomplete: the inbound geocode DTO
//  (web `GeocodeResult`) and the resolved trip-location payload (web `TripLocation`), the injected
//  pre-localized copy, the search tunables (web `useGeocodeSearch` `q.length >= 3` + `limit=5` + the
//  400 ms debounce), and the phase / status / connection enums. Free of SwiftUI so the projection
//  logic compiles and tests on a plain host. Parity target:
//  features/driving/components/AddressInput.tsx.
//

import Foundation

// MARK: - Inbound DTO (web `GeocodeResult`)

/// One geocoder suggestion — the SwiftUI parity of the web `GeocodeResult`
/// (`{ display_name, lat, lng }`) returned by `useGeocodeSearch`.
public struct GeocodeResultDTO: Sendable, Equatable {
    /// The human-readable address line (web `display_name`), shown in the row + written back on select.
    public var displayName: String
    /// Latitude in decimal degrees (web `lat`).
    public var lat: Double
    /// Longitude in decimal degrees (web `lng`).
    public var lng: Double

    public init(displayName: String, lat: Double, lng: Double) {
        self.displayName = displayName
        self.lat = lat
        self.lng = lng
    }
}

// MARK: - Resolved selection payload (web `TripLocation`)

/// The coordinates emitted to the parent when a suggestion is chosen — the SwiftUI parity of the web
/// `TripLocation` (`{ lat, lng, name }`) passed to `onSelect`. `name` is the chosen `display_name`.
public struct TripLocationDTO: Sendable, Equatable {
    public var lat: Double
    public var lng: Double
    public var name: String

    public init(lat: Double, lng: Double, name: String) {
        self.lat = lat
        self.lng = lng
        self.name = name
    }
}

// MARK: - Search tunables (web `useGeocodeSearch`)

/// The geocode-search behaviour the web hook bakes in: the minimum query length that enables the
/// query (web `enabled: query.length >= 3`), the upstream result cap (web `&limit=5`), and the
/// keystroke debounce the web component applies before querying (web `setTimeout(…, 400)`).
public enum AddressInputConfig {
    /// Web `query.length >= 3` — below this the query is idle (the hook is disabled).
    public static let minimumQueryLength = 3
    /// Web `&limit=5` — the most suggestions ever shown.
    public static let resultLimit = 5
    /// Web `setTimeout(() => setDebouncedQuery(value), 400)` — keystroke→query debounce.
    public static let debounceInterval: TimeInterval = 0.4
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs: the field label the web reads via
/// `t('addressInput.label', 'Address')` and the VoiceOver role word spoken for each suggestion.
/// Injected so the projection stays Foundation-only and host-testable (the view resolves the real
/// catalog copy through the P1/S10 facade).
public struct AddressInputCopy: Sendable, Equatable {
    /// The field label (web `t('addressInput.label', 'Address')`).
    public var fieldLabel: String
    /// The VoiceOver role spoken before each suggestion's address (native a11y enrichment).
    public var suggestionRole: String

    public init(fieldLabel: String = "Address", suggestionRole: String = "Address suggestion") {
        self.fieldLabel = fieldLabel
        self.suggestionRole = suggestionRole
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = AddressInputCopy()
}

// MARK: - Render phase (the suggestion-area envelope around the web async results)

/// What the suggestion area should render. The web `Combobox` shows its menu only while focused with
/// either a spinner, options, or its no-options text; the native surface reproduces that whole
/// envelope — plus the below-minimum "idle" branch (web hook disabled) — so every state renders.
public enum AddressSuggestionsPhase: Sendable, Equatable {
    /// Query below `minimumQueryLength` (web hook `enabled: false`) — a "keep typing" hint.
    case idle
    /// Searching (web `loading: isLoading && debouncedQuery.length >= 3`).
    case loading
    /// Resolved with ≥1 suggestion.
    case content
    /// Resolved with no suggestions (web `Combobox` empty menu).
    case empty
    /// The geocode search failed.
    case error(String)
}

/// The bound source's load status (web `useGeocodeSearch` disabled / loading / resolved / failure).
public enum AddressInputLoadStatus: Sendable, Equatable {
    /// The query is below the minimum length, so no request is in flight (web hook disabled).
    case idle
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-results banner so cached
/// suggestions are clearly labelled while reconnecting / offline.
public enum AddressInputConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
