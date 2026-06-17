//
//  MediaPlayerPageModel.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple) — View Model
//
//  Full parity with web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx.
//  An `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web TanStack queries are kept under their original shape at the Swift call
//  sites (`useMediaLatest`, `useMediaHistory`) in `MediaPlayerDataSource.swift`;
//  that file is the only seam that changes when the generated client lands
//  (P1/S2-S3). The view never touches the network.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Mutually-exclusive render branches (web shell loading / content / empty / error)

/// The four declared data states (loading · empty · error · success).
enum MediaPlayerViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - View Model

@MainActor
@Observable
final class MediaPlayerPageModel {
    // Render state
    var viewState: MediaPlayerViewState = .loading

    // Source data (web query results)
    private(set) var latest: MediaPlayerSnapshot?
    private(set) var history: [MediaPlayerSnapshot] = []
    private(set) var vehicles: [MediaPlayerVehicle] = []

    // Selected vehicle (web useSelectedVehicle) — global across vehicle pages.
    var selectedVehicleID: Int64 = 0

    // History window (web useRangeState, default 7d).
    var selectedRange: MediaPlayerRange = .sevenDays

    // Secondary-error surface (web `anyError` inline AlertBanner). The primary
    // (latest) failure drives the full-screen `.error` state instead.
    private(set) var inlineErrorMessage: String?

    // Live freshness (ADR-013) — `> 2 min` is treated as stale.
    private(set) var lastUpdated: Date?

    // In-flight flags (web `latestLoading` / `historyLoading`) so the gauges and
    // the history chart/table show their redacted skeletons during a reload.
    private(set) var isLoadingLatest = false
    private(set) var isLoadingHistory = false

    init() {}
}

// MARK: - Derived state (web `useMemo` / inline derivations)

extension MediaPlayerPageModel {
    /// Web `filtered` — history clipped to the active `[start, end]` window.
    var filtered: [MediaPlayerSnapshot] {
        let now = Date()
        guard let windowStart = selectedRange.startDate(now: now) else {
            return history
        }
        return history.filter { $0.createdAt >= windowStart && $0.createdAt <= now }
    }

    /// Chronological order, oldest first (web `volumeChartData` sort).
    var filteredAscending: [MediaPlayerSnapshot] {
        filtered.sorted { $0.createdAt < $1.createdAt }
    }

    /// Newest-first rows for the table (web default sort `created_at desc`).
    var historyDescending: [MediaPlayerSnapshot] {
        filtered.sorted { $0.createdAt > $1.createdAt }
    }

    /// Web `stats` — unique tracks, top source, average volume over the window.
    var stats: MediaPlayerStats {
        guard !filtered.isEmpty else {
            return MediaPlayerStats(uniqueTracks: 0, topSource: "—", averageVolume: 0)
        }

        let titles = Set(filtered.compactMap { snapshot -> String? in
            guard let title = snapshot.nowPlayingTitle, !title.isEmpty else { return nil }
            return title
        })

        let sourceCounts = countSources(includeUnknownFallback: false)
        let topSource = sourceCounts
            .max { $0.value < $1.value }?.key ?? "—"

        let volumeSum = filtered.reduce(0.0) { $0 + ($1.audioVolume ?? 0) }
        let average = volumeSum / Double(filtered.count)

        return MediaPlayerStats(uniqueTracks: titles.count, topSource: topSource, averageVolume: average)
    }

    /// Web `volumeChartData` — chronological volume points for the area chart.
    var volumeChartData: [MediaVolumePoint] {
        filteredAscending.map { snapshot in
            MediaVolumePoint(id: snapshot.id, time: snapshot.createdAt, volume: snapshot.audioVolume ?? 0)
        }
    }

    /// Web `sourceData` — source counts mapped to palette-colored slices, desc.
    var sourceData: [MediaSourceSlice] {
        let counts = countSources(includeUnknownFallback: true)
        return counts
            .sorted { lhs, rhs in
                lhs.value != rhs.value ? lhs.value > rhs.value : lhs.key < rhs.key
            }
            .enumerated()
            .map { index, entry in
                MediaSourceSlice(name: entry.key, value: entry.value, color: TSChartPalette.color(at: index))
            }
    }

    /// The volume gauge / Y-axis ceiling (web `latest?.audio_volume_max || 11`).
    var volumeMax: Double {
        guard let maximum = latest?.audioVolumeMax, maximum > 0 else { return 11 }
        return maximum
    }

    /// Active vehicle display name (web selector label).
    var activeVehicleName: String {
        vehicles.first { $0.id == selectedVehicleID }?.displayName ?? ""
    }

    /// `> 2 min` since the last successful refresh (live staleness indicator).
    var isStale: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) > 120
    }

    /// Group play counts by source (web `sources` / `sourceData` reducers).
    private func countSources(includeUnknownFallback: Bool) -> [String: Int] {
        filtered.reduce(into: [:]) { counts, snapshot in
            let source = snapshot.playbackSource
            if let source, !source.isEmpty {
                counts[source, default: 0] += 1
            } else if includeUnknownFallback {
                let unknown = String(localized: "translation.Unknown", defaultValue: "Unknown")
                counts[unknown, default: 0] += 1
            }
        }
    }
}

// MARK: - Lifecycle + actions

extension MediaPlayerPageModel {
    /// Initial load: vehicles for the selector, then the latest + history set.
    func load() async {
        viewState = .loading
        if vehicles.isEmpty {
            vehicles = await loadVehicles()
        }
        if selectedVehicleID == 0 {
            selectedVehicleID = vehicles.first?.id ?? 0
        }
        await reloadData(initial: true)
    }

    /// Pull-to-refresh — reloads the active vehicle's data.
    func refresh() async {
        await reloadData(initial: false)
    }

    /// Switch the active vehicle (web selector `onChange`).
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID else { return }
        selectedVehicleID = vehicleID
        await reloadData(initial: true)
    }

    /// Switch the history window (web RangePicker `onChange`). Re-derives from the
    /// already-loaded history (web filters client-side), so no refetch is needed.
    func selectRange(_ range: MediaPlayerRange) {
        guard range != selectedRange else { return }
        selectedRange = range
        viewState = resolveState()
    }

    /// Re-fetch the latest snapshot + history for the active vehicle.
    func reloadData(initial: Bool) async {
        let vehicleID = selectedVehicleID
        guard vehicleID > 0 else {
            latest = nil
            history = []
            viewState = .empty
            return
        }

        inlineErrorMessage = nil
        if initial { isLoadingLatest = true }
        isLoadingHistory = true

        latest = await useMediaLatest(vehicleID: vehicleID)
        isLoadingLatest = false

        history = await useMediaHistory(vehicleID: vehicleID)
        isLoadingHistory = false

        lastUpdated = Date()
        viewState = resolveState()
    }

    /// Surfaced by the live client when the primary (latest) request fails
    /// (web `latestError` → PageContainer error). Wired here so the `.error`
    /// branch is real logic, not a dead arm.
    func fail(_ message: String) {
        inlineErrorMessage = message
        viewState = .error(message)
    }

    private func resolveState() -> MediaPlayerViewState {
        if latest == nil, history.isEmpty {
            return .empty
        }
        return .success
    }
}
