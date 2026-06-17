//
//  SoftwareUpdatesPageModel.swift
//  TeslaSync — P4 feature view · P7 · SoftwareUpdates (Apple) — View Model
//
//  Full parity with web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx.
//  An `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web `useQuery(['software-updates', …])` is kept under the hook-style name
//  `useSoftwareUpdates` at the call site; the toolbar vehicle selector mirrors
//  `useSelectedVehicle`, the range menu mirrors `useRangeState`, and the timeline
//  pager mirrors the web `Pagination`. No business logic lives in the view.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Mutually-exclusive render branches (the four declared data states)

/// The four declared data states (loading · empty · error · success). Drives the
/// timeline region — the summary cards always render (web never hides them).
enum SoftwareUpdatesViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - Range presets (web `useRangeState`, `defaultPresetId: 'all'`)

/// The toolbar range filter (web `RangePicker`). Each preset resolves a
/// `[start, end]` window applied to `created_at` at the data seam.
enum SoftwareUpdatesRangePreset: String, CaseIterable, Identifiable, Equatable {
    case all
    case last7Days
    case last30Days
    case last90Days
    case thisYear

    var id: String { rawValue }

    /// Localized menu label.
    var label: String {
        switch self {
        case .all:
            return String(localized: "All time", defaultValue: "All time")
        case .last7Days:
            return String(localized: "Last 7 days", defaultValue: "Last 7 days")
        case .last30Days:
            return String(localized: "Last 30 days", defaultValue: "Last 30 days")
        case .last90Days:
            return String(localized: "Last 90 days", defaultValue: "Last 90 days")
        case .thisYear:
            return String(localized: "This year", defaultValue: "This year")
        }
    }

    /// The `[start, end]` window. `end` stays open so freshly-created records
    /// (including scheduled future installs) are always included.
    func window(now: Date = Date(), calendar: Calendar = .current) -> (start: Date?, end: Date?) {
        switch self {
        case .all:
            return (nil, nil)
        case .last7Days:
            return (now.addingTimeInterval(-7 * 86_400), nil)
        case .last30Days:
            return (now.addingTimeInterval(-30 * 86_400), nil)
        case .last90Days:
            return (now.addingTimeInterval(-90 * 86_400), nil)
        case .thisYear:
            let components = calendar.dateComponents([.year], from: now)
            return (calendar.date(from: components), nil)
        }
    }
}

// MARK: - View Model

@MainActor
@Observable
final class SoftwareUpdatesPageModel {
    /// The active timeline render branch.
    var viewState: SoftwareUpdatesViewState = .loading

    /// The current page of firmware records (web `updates`).
    private(set) var updates: [SoftwareUpdatesItem] = []

    /// Vehicle roster for the selector (web `useSelectedVehicle`).
    private(set) var vehicles: [SoftwareUpdatesVehicle] = []

    /// Selected vehicle (web `useSelectedVehicle().vehicleId`); `0` ⇒ none.
    var selectedVehicleID: Int64 = 0

    /// Toolbar range filter (web `useRangeState`).
    var rangePreset: SoftwareUpdatesRangePreset = .all

    /// 1-based page index (web `page`).
    private(set) var page = 1

    /// Web `pageSize = 50`.
    let pageSize = 50

    /// Whether the seam reported more rows beyond the current page (fetch-one-extra).
    private(set) var hasMore = false

    /// Last successful refresh — `> 2 min` is treated as stale (ADR-013).
    private(set) var lastUpdated: Date?

    /// Monotonic reload token — guards against a slow older request committing
    /// after a newer vehicle / range / page switch (the `@MainActor` model is
    /// still reentrant across `await`).
    private var reloadGeneration = 0

    init() {}
}

// MARK: - Derived state (web inline derivations)

extension SoftwareUpdatesPageModel {
    /// Web `latestVersion = updates?.[0]?.version ?? t('Unknown')`.
    var latestVersion: String {
        updates.first?.version ?? String(localized: "Unknown", defaultValue: "Unknown")
    }

    /// Web `installedCount = updates?.filter(u => u.status === 'installed').length`.
    var installedCount: Int {
        updates.filter { $0.status == "installed" }.count
    }

    /// Web `totalUpdates = updates?.length`.
    var totalUpdates: Int {
        updates.count
    }

    /// The active vehicle's display name (toolbar label).
    var activeVehicleName: String {
        displayName(for: selectedVehicleID)
    }

    /// Web `vehicleMap.get(u.vehicle_id)?.display_name ?? `${t('Vehicle')} ${id}``.
    func displayName(for vehicleID: Int64) -> String {
        if let match = vehicles.first(where: { $0.id == vehicleID }) {
            return match.displayName
        }
        let vehicleWord = String(localized: "Vehicle", defaultValue: "Vehicle")
        return "\(vehicleWord) \(vehicleID)"
    }

    /// Web pager: a previous page exists once past page 1.
    var hasPreviousPage: Bool { page > 1 }

    /// Web pager heuristic: a next page exists when the seam reported more rows
    /// than the current page holds (fetch-one-extra), avoiding an off-by-one that
    /// could strand the user on an empty page at an exact `pageSize` multiple.
    var hasNextPage: Bool { hasMore }

    /// `> 2 min` since the last successful refresh (live staleness indicator).
    var isStale: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) > 120
    }
}

// MARK: - Lifecycle + actions

extension SoftwareUpdatesPageModel {
    /// Initial load: roster for the selector, then the first page of updates.
    func load() async {
        if vehicles.isEmpty {
            vehicles = await loadVehicles()
        }
        if selectedVehicleID == 0 {
            selectedVehicleID = vehicles.first?.id ?? 0
        }
        await reload()
    }

    /// Pull-to-refresh / Retry — reloads the current page.
    func refresh() async {
        await reload()
    }

    /// Switch the active vehicle (web vehicle selector `onChange`).
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID else { return }
        selectedVehicleID = vehicleID
        page = 1
        await reload()
    }

    /// Apply a range preset (web `RangePicker onChange` → resets to page 1).
    func setRange(_ preset: SoftwareUpdatesRangePreset) async {
        guard preset != rangePreset else { return }
        rangePreset = preset
        page = 1
        await reload()
    }

    /// Advance one page (web `Pagination onPageChange`).
    func nextPage() async {
        guard hasNextPage else { return }
        page += 1
        await reload()
    }

    /// Step back one page (web `Pagination onPageChange`).
    func previousPage() async {
        guard hasPreviousPage else { return }
        page -= 1
        await reload()
    }

    /// Re-fetch the active page for the selected vehicle + range. Fetches one
    /// extra row to derive `hasMore`, and a reload token guards against a stale
    /// older request overwriting a newer switch.
    func reload() async {
        reloadGeneration += 1
        let generation = reloadGeneration

        guard selectedVehicleID > 0 else {
            updates = []
            hasMore = false
            viewState = .empty
            return
        }

        viewState = .loading
        let window = rangePreset.window()
        do {
            let loaded = try await useSoftwareUpdates(
                vehicleID: selectedVehicleID,
                limit: pageSize + 1,
                offset: (page - 1) * pageSize,
                start: window.start,
                end: window.end
            )
            guard generation == reloadGeneration else { return }
            hasMore = loaded.count > pageSize
            updates = Array(loaded.prefix(pageSize))
            lastUpdated = Date()
            viewState = updates.isEmpty ? .empty : .success
        } catch {
            guard generation == reloadGeneration else { return }
            updates = []
            hasMore = false
            viewState = .error(error.localizedDescription)
        }
    }
}
