//
//  VehicleDetailPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleDetail (Apple) — View model
//
//  The `@MainActor @Observable` state holder for `VehicleDetailPage`. It consumes the
//  `VehicleDetailDataSource` seam (the KMP-core binding point, ADR-004), projects the
//  settings resolver into the loading / empty / error / success states the web page
//  renders, derives the page's effective name from the `nickname` effective setting
//  (web `findEffectiveSetting`), and drives the wake action (web `wakeMutation`) with
//  the `vehicles.detail.wakeSuccess` / `wakeFailed` feedback. No view logic lives here.
//

import Observation
import SwiftUI

// MARK: - View-model state

/// The four data states the web `VehicleDetailPage` renders for its settings source.
enum VehicleDetailState: Equatable {
    case loading
    case empty
    case error(String)
    case success(VehicleDetailSettingsResponse)
}

/// Transient feedback for the wake command (web `toast.success` / `toast.error`).
struct VehicleDetailWakeFeedback: Identifiable {
    let id = UUID()
    let messageKey: LocalizedStringKey
    let tone: TSTone
}

// MARK: - Model

@MainActor
@Observable
final class VehicleDetailPageModel {
    let vehicleID: Int64
    @ObservationIgnored private let dataSource: any VehicleDetailDataSource

    private(set) var state: VehicleDetailState = .loading
    private(set) var isWaking = false
    var wakeFeedback: VehicleDetailWakeFeedback?

    init(
        vehicleID: Int64,
        dataSource: any VehicleDetailDataSource = SampleVehicleDetailDataSource()
    ) {
        self.vehicleID = vehicleID
        self.dataSource = dataSource
    }

    /// The resolved settings payload, when the source has loaded successfully.
    var settings: VehicleDetailSettingsResponse? {
        if case let .success(payload) = state { return payload }
        return nil
    }

    /// Web `effectiveName`: the `nickname` override feeds the page title and breadcrumb.
    /// Falls back to `nil` (the title key) when no nickname override is present.
    var effectiveName: String? {
        guard
            case let .text(name)? = findEffectiveSetting(settings, "nickname")?.value,
            !name.isEmpty
        else {
            return nil
        }
        return name
    }

    /// One effective setting row by key (web `findEffectiveSetting(payload, key)`).
    func setting(for key: String) -> VehicleDetailSetting? {
        findEffectiveSetting(settings, key)
    }

    /// Loads the per-vehicle settings (web `useVehicleSettings`). Projects the result
    /// into loading → empty | error | success.
    func load() async {
        state = .loading
        do {
            let payload = try await dataSource.useVehicleSettings(vehicleID: vehicleID)
            state = payload.settings.isEmpty ? .empty : .success(payload)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Pull-to-refresh / Retry: re-fetches the settings resolver.
    func refresh() async {
        await load()
    }

    /// Wake the vehicle (web `wakeMutation.mutate()`), surfacing the success / failure
    /// feedback the web page shows via a toast.
    func wake() async {
        guard !isWaking else { return }
        isWaking = true
        defer { isWaking = false }
        do {
            try await dataSource.wakeVehicle(vehicleID: vehicleID)
            wakeFeedback = VehicleDetailWakeFeedback(
                messageKey: "translation.vehicles.detail.wakeSuccess",
                tone: .success
            )
        } catch {
            wakeFeedback = VehicleDetailWakeFeedback(
                messageKey: "translation.vehicles.detail.wakeFailed",
                tone: .danger
            )
        }
    }
}
