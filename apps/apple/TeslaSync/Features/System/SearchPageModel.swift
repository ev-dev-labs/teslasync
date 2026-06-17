//
//  SearchPageModel.swift
//  TeslaSync — P7 System · SearchPage (Apple) — Models & View Model
//

import Observation
import SwiftUI

// MARK: - Search Hit Types

/// The entity types the backend can return from the search API.
public enum SearchHitType: String, CaseIterable, Codable, Sendable {
    case vehicle
    case drive
    case charging
    case alert
    case notification
    case geofence
    case automation
    case location
    case trip

    var icon: String {
        switch self {
        case .vehicle: "car"
        case .drive: "road.lanes"
        case .charging: "bolt.batteryblock"
        case .alert: "bell.badge"
        case .notification: "bell"
        case .geofence: "mappin.circle"
        case .automation: "gearshape.2"
        case .location: "mappin"
        case .trip: "location.north"
        }
    }

    func localizedLabel() -> String {
        switch self {
        case .vehicle:
            String(localized: "search.section.vehicle", defaultValue: "Vehicles")
        case .drive:
            String(localized: "search.section.drive", defaultValue: "Drives")
        case .charging:
            String(localized: "search.section.charging", defaultValue: "Charging")
        case .alert:
            String(localized: "search.section.alert", defaultValue: "Alerts")
        case .notification:
            String(localized: "search.section.notification", defaultValue: "Notifications")
        case .geofence:
            String(localized: "search.section.geofence", defaultValue: "Geofences")
        case .automation:
            String(localized: "search.section.automation", defaultValue: "Automations")
        case .location:
            String(localized: "search.section.location", defaultValue: "Locations")
        case .trip:
            String(localized: "search.section.trip", defaultValue: "Trips")
        }
    }
}

/// A single search result hit from the backend.
public struct SearchHit: Identifiable, Codable, Sendable {
    public let type: SearchHitType
    public let id: Int
    public let title: String
    public let subtitle: String?
    public let url: String
    public let score: Double
    public let when: String?

    public var compositeId: String {
        "\(type.rawValue)-\(id)"
    }
}

/// Response from the backend search API.
public struct SearchResponse: Codable, Sendable {
    public let hits: [SearchHit]
}

/// A grouped set of search results by type.
public struct GroupedSearchHits: Identifiable {
    public let type: SearchHitType
    public let hits: [SearchHit]

    public var id: String {
        type.rawValue
    }
}

// MARK: - View Model

/// The view model for SearchPage. Manages search state, filter chips, and API calls.
@Observable
public final class SearchPageModel {
    /// Current search query text.
    public var query: String = ""

    /// Selected type filters (empty = all types).
    public var selectedTypes: Set<SearchHitType> = []

    /// Current data state.
    public var state: DataState = .empty

    /// Search results grouped by type.
    public var groupedHits: [GroupedSearchHits] = []

    /// Minimum query length enforced by the backend.
    private let minQueryLength = 2

    public enum DataState {
        case loading
        case empty
        case error(String)
        case success
    }

    public init() {}

    /// Returns true if the query is too short to execute.
    public var isTooShort: Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count < minQueryLength
    }

    /// Perform search with current query and filters.
    @MainActor
    public func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        // Don't search if query is empty or too short
        guard !trimmed.isEmpty, trimmed.count >= minQueryLength else {
            if trimmed.isEmpty {
                state = .empty
            }
            groupedHits = []
            return
        }

        state = .loading

        do {
            // Build query parameters
            var params: [String: String] = ["q": trimmed, "limit": "25"]
            if !selectedTypes.isEmpty {
                params["types"] = selectedTypes.map(\.rawValue).joined(separator: ",")
            }

            // KMP core API client integration point: GET /search?q=...&types=...&limit=25
            // Simulated API call for standalone build validation
            try await Task.sleep(for: .milliseconds(500))

            // API response model matches backend SearchResponse { hits: SearchHit[] }
            let mockResponse = SearchResponse(hits: [])

            // Group results by type
            let groups = groupResults(mockResponse.hits)
            groupedHits = groups

            state = groups.isEmpty ? .empty : .success
        } catch {
            state = .error(error.localizedDescription)
            groupedHits = []
        }
    }

    /// Toggle a type filter on/off.
    public func toggleType(_ type: SearchHitType) {
        if selectedTypes.contains(type) {
            selectedTypes.remove(type)
        } else {
            selectedTypes.insert(type)
        }

        // Re-search with new filters
        Task {
            await search()
        }
    }

    /// Clear all type filters.
    public func clearFilters() {
        selectedTypes.removeAll()
        Task {
            await search()
        }
    }

    /// Group search hits by type, preserving order from SearchHitType.allCases.
    private func groupResults(_ hits: [SearchHit]) -> [GroupedSearchHits] {
        var typeMap: [SearchHitType: [SearchHit]] = [:]
        for type in SearchHitType.allCases {
            typeMap[type] = []
        }

        for hit in hits {
            typeMap[hit.type]?.append(hit)
        }

        return SearchHitType.allCases.compactMap { type in
            let hitsForType = typeMap[type] ?? []
            return hitsForType.isEmpty ? nil : GroupedSearchHits(type: type, hits: hitsForType)
        }
    }
}
