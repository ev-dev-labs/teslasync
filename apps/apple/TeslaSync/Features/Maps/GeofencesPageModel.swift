//
//  GeofencesPageModel.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — View Model
//
//  Full parity with web/src/features/maps/pages/GeofencesPage.tsx. An
//  `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web TanStack queries/mutations keep their original names at the Swift call
//  sites (`useGeofences`, `useVehicles`, `usePinned`, `useBulkGeofencesDelete`,
//  create/update/delete/toggle/rename, `useVehiclePositions`, `reverseGeocode`) in
//  `GeofencesPageDataSource.swift` — the only seam that changes when the generated
//  client lands (P1/S2-S3). The view holds no business logic and never touches the
//  network.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Render branches (web shell loading / content / empty / error)

/// The four declared data states (loading · empty · error · success). `empty` is
/// reached when the account has zero geofences; the search-no-match empty lives
/// inside the success/empty content list.
enum GeofencesPageViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - Transient toast (web `useToast`)

/// A transient success/error message (web `toast.success` / `toast.error`).
struct GeofencesToast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let isError: Bool
}

// MARK: - View Model

@MainActor
@Observable
final class GeofencesPageModel {
    /// Render state (web PageContainer loading / error + body).
    var viewState: GeofencesPageViewState = .loading

    // Source data (web query results).
    var zones: [GeofenceZone] = []
    var vehicles: [GeofencesVehicle] = []
    var pins: [GeofencesPinnedItem] = []

    // List filtering + bulk selection (web `search`, `useBulkSelection`).
    var search: String = ""
    var selectedIDs: Set<String> = []

    /// AI suggest location id input (web `aiLocationIdRaw`).
    var aiLocationIDRaw: String = ""

    // Create / edit modal (web modal state).
    var isModalOpen: Bool = false
    var editingID: String?
    var form: GeofencesFormData = .empty
    var initialForm: GeofencesFormData = .empty
    var fieldErrors: [GeofencesFormField: String] = [:]
    var formError: String?
    var isSaving: Bool = false

    // "Use Current Location" panel (web `locationSource`, `selectedVehicleId`).
    var locationSource: GeofencesLocationSource = .vehicle
    var selectedVehicleID: Int64 = 0
    var isLocating: Bool = false

    // Delete confirmation + discard-changes guard (web ConfirmDialog / useDirtyForm).
    var deleteTarget: GeofenceZone?
    var isDiscardPromptPresented: Bool = false

    // Live freshness (ADR-013) + transient toast.
    var lastLoadedAt: Date?
    var toast: GeofencesToast?

    init() {}
}

// MARK: - Derived state (web `useMemo` / inline derivations)

extension GeofencesPageModel {
    /// Web `stats` memo (total / active / entry-alert / exit-alert).
    var stats: GeofencesStats {
        GeofencesMath.stats(for: zones)
    }

    /// Web `filteredGeofences` (name search) — drives the no-match empty.
    var filteredZones: [GeofenceZone] {
        GeofencesMath.filtered(zones, search: search)
    }

    /// Web `sortedGeofences` (pinned-first ordering of the filtered list).
    var sortedZones: [GeofenceZone] {
        GeofencesMath.pinnedSorted(filteredZones, pins: pins)
    }

    /// Whether the account holds any geofence at all (web `geofences.length > 0`).
    var hasAnyZone: Bool {
        !zones.isEmpty
    }

    /// Parsed AI location id (web `aiLocationId`, 0 when blank/invalid).
    var aiLocationID: Int {
        let parsed = Int(GeofencesText.trim(aiLocationIDRaw)) ?? 0
        return parsed > 0 ? parsed : 0
    }

    /// The modal title (web `editingId ? 'Edit Geofence' : 'Create Geofence'`).
    var modalTitle: String {
        editingID != nil
            ? String(localized: "Edit Geofence", defaultValue: "Edit Geofence")
            : String(localized: "Create Geofence", defaultValue: "Create Geofence")
    }

    /// The primary save-button label (web `editingId ? 'Update' : 'Create'`).
    var saveLabel: String {
        editingID != nil
            ? String(localized: "Update", defaultValue: "Update")
            : String(localized: "Create", defaultValue: "Create")
    }

    /// Web `isFormDirty` — the open modal's form diverges from its open snapshot.
    var isFormDirty: Bool {
        isModalOpen && form != initialForm
    }

    /// Web `hasMinimalInput && !isSaving` — the save button enabled-state.
    var canSave: Bool {
        form.hasMinimalInput && !isSaving
    }

    /// `> 2 min` since the last successful load (live staleness, ADR-013).
    var isStale: Bool {
        guard let lastLoadedAt else { return false }
        return Date().timeIntervalSince(lastLoadedAt) > 120
    }

    /// Whether the draw-map's draft fence is plottable (web `drawerFences`).
    var draftFence: GeofencesDraftFence? {
        guard let latitude = Double(GeofencesText.trim(form.latitude)),
              let longitude = Double(GeofencesText.trim(form.longitude)),
              let radius = Double(GeofencesText.trim(form.radius)),
              latitude.isFinite, longitude.isFinite, radius.isFinite,
              !(latitude == 0 && longitude == 0)
        else { return nil }
        return GeofencesDraftFence(
            latitude: latitude,
            longitude: longitude,
            radius: radius,
            name: form.name.isEmpty ? nil : form.name
        )
    }
}
