//
//  GeofencesPageModel+Actions.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — View Model actions
//
//  The lifecycle + intent surface of `GeofencesPageModel` (web event handlers):
//  load/refresh, search + bulk selection, row toggle/rename/delete, the create/edit
//  modal lifecycle + discard guard, submit (create/update), the "Use Current
//  Location" resolver, and the transient toast plumbing. Split from the core model
//  purely to keep each file within the lint budget; all members extend the single
//  `@MainActor @Observable GeofencesPageModel`.
//

import Foundation
import SwiftUI

// MARK: - Lifecycle

extension GeofencesPageModel {
    /// Initial load: the list, plus the selector roster + pin ordering.
    func load() async {
        if viewState != .loading { viewState = .loading }
        async let roster = useVehicles()
        async let pinned = usePinned("geofence")
        let list = await useGeofences()
        vehicles = await roster
        pins = await pinned
        applyList(list)
    }

    /// Pull-to-refresh — re-reads the list (web `invalidateQueries`).
    func refresh() async {
        let list = await useGeofences()
        pins = await usePinned("geofence")
        applyList(list)
    }

    /// Drive the `.error` branch when the primary query fails (web PageContainer error).
    func fail(_ message: String) {
        viewState = .error(message)
    }

    private func applyList(_ list: [GeofenceZone]) {
        zones = list
        lastLoadedAt = Date()
        // Drop selections that no longer exist (web bulk-selection clears on change).
        selectedIDs = selectedIDs.intersection(Set(list.map(\.id)))
        viewState = list.isEmpty ? .empty : .success
    }
}

// MARK: - List actions (search, selection, bulk delete)

extension GeofencesPageModel {
    /// Clear the name search (web `setSearch('')`).
    func clearSearch() {
        search = ""
    }

    /// Toggle a bulk-selection checkbox (web `sel.toggle`).
    func toggleSelection(_ id: String) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }

    /// Whether a row is selected (web `sel.isSelected`).
    func isSelected(_ id: String) -> Bool {
        selectedIDs.contains(id)
    }

    /// Clear the whole selection (web `sel.clear`).
    func clearSelection() {
        selectedIDs.removeAll()
    }

    /// Whether a fence is pinned to the top (web `geofencePins`).
    func isPinned(_ id: String) -> Bool {
        pins.contains { $0.itemID == id }
    }

    /// Toggle a fence's pin (web `PinButton`) — re-floats it via `sortedZones`.
    func togglePin(_ zone: GeofenceZone) {
        if let index = pins.firstIndex(where: { $0.itemID == zone.id }) {
            pins.remove(at: index)
        } else {
            pins.append(GeofencesPinnedItem(itemID: zone.id, position: pins.count))
        }
    }

    /// Bulk-delete the selected fences (web `bulkDelete.mutateAsync(ids.map(Number))`).
    func bulkDeleteSelected() async {
        let ids = selectedIDs.compactMap { Int64($0) }
        guard !ids.isEmpty else { return }
        let outcome = await useBulkGeofencesDelete(ids)
        if case let .failed(message) = outcome {
            presentToast(message, isError: true)
            return
        }
        clearSelection()
        await refresh()
    }
}

// MARK: - Row actions (toggle, rename, delete)

extension GeofencesPageModel {
    /// Flip a fence's enabled flag (web `toggleMut`).
    func toggle(_ zone: GeofenceZone, enabled: Bool) async {
        let outcome = await toggleGeofence(id: zone.id, enabled: enabled)
        if case let .failed(message) = outcome {
            presentToast(
                String(localized: "Failed to toggle geofence", defaultValue: "Failed to toggle geofence"),
                detail: message
            )
            return
        }
        await refresh()
    }

    /// Inline-rename a fence (web `renameMut`). Errors surface inline in the row.
    @discardableResult
    func rename(_ zone: GeofenceZone, to name: String) async -> Bool {
        let outcome = await renameGeofence(id: zone.id, name: name)
        guard case .success = outcome else { return false }
        await refresh()
        return true
    }

    /// Stage a fence for deletion (web `setDeleteTarget`).
    func requestDelete(_ zone: GeofenceZone) {
        deleteTarget = zone
    }

    /// Confirm the staged deletion (web ConfirmDialog `onConfirm`).
    func confirmDelete() async {
        guard let target = deleteTarget else { return }
        let outcome = await deleteGeofence(id: target.id)
        deleteTarget = nil
        if case let .failed(message) = outcome {
            presentToast(
                String(localized: "Failed to delete geofence", defaultValue: "Failed to delete geofence"),
                detail: message
            )
            return
        }
        presentToast(String(localized: "Geofence deleted", defaultValue: "Geofence deleted"))
        await refresh()
    }
}

// MARK: - Modal lifecycle (open create / edit, AI draft, close + discard guard)

extension GeofencesPageModel {
    /// Open a blank create modal (web `openCreate`).
    func openCreate() {
        editingID = nil
        form = .empty
        initialForm = .empty
        fieldErrors = [:]
        formError = nil
        isLocating = false
        isModalOpen = true
    }

    /// Open the modal seeded for editing (web `openEdit`).
    func openEdit(_ zone: GeofenceZone) {
        editingID = zone.id
        let next = GeofencesFormData(
            name: zone.name,
            latitude: String(zone.latitude),
            longitude: String(zone.longitude),
            radius: String(Int(zone.radius.rounded())),
            alertType: zone.alertKind,
            enabled: zone.enabled
        )
        form = next
        initialForm = next
        fieldErrors = [:]
        formError = nil
        isModalOpen = true
    }

    /// Apply an AI draft into a pre-filled create modal (web `applyAiDraftToForm`).
    func applyAIDraft(name: String, latitude: Double, longitude: Double, radius: Double) {
        editingID = nil
        form = GeofencesFormData(
            name: name,
            latitude: String(latitude),
            longitude: String(longitude),
            radius: String(Int(radius.rounded())),
            alertType: GeofencesFormData.empty.alertType,
            enabled: GeofencesFormData.empty.enabled
        )
        initialForm = .empty
        fieldErrors = [:]
        formError = nil
        isLocating = false
        isModalOpen = true
    }

    /// Cancel handler (web `handleRequestClose`) — guard unsaved edits.
    func requestCloseModal() {
        if isFormDirty {
            isDiscardPromptPresented = true
        } else {
            closeModal()
        }
    }

    /// Discard edits and dismiss (web confirm → `closeModal`).
    func discardAndClose() {
        isDiscardPromptPresented = false
        closeModal()
    }

    /// Tear down the modal state (web `closeModal`).
    func closeModal() {
        isModalOpen = false
        editingID = nil
        form = .empty
        initialForm = .empty
        fieldErrors = [:]
        formError = nil
    }
}

// MARK: - Submit (web `handleSubmit` → create/update)

extension GeofencesPageModel {
    /// Validate + persist the form (web `handleSubmit`).
    func submit() async {
        formError = nil
        let errors = GeofencesMath.validate(form)
        guard errors.isEmpty, let payload = GeofencesMath.payload(from: form) else {
            fieldErrors = errors
            formError = String(
                localized: "forms.validationFailed",
                defaultValue: "Please fix the highlighted fields before saving."
            )
            return
        }
        fieldErrors = [:]
        isSaving = true
        defer { isSaving = false }

        if let editingID {
            let outcome = await updateGeofence(id: editingID, payload: payload)
            handleSaveOutcome(
                outcome,
                success: String(localized: "Geofence updated", defaultValue: "Geofence updated"),
                failure: String(localized: "Failed to update geofence", defaultValue: "Failed to update geofence")
            )
        } else {
            let outcome = await createGeofence(payload)
            handleSaveOutcome(
                outcome,
                success: String(localized: "Geofence created", defaultValue: "Geofence created"),
                failure: String(localized: "Failed to create geofence", defaultValue: "Failed to create geofence")
            )
        }
    }

    private func handleSaveOutcome(
        _ outcome: GeofencesMutationOutcome,
        success: String,
        failure: String
    ) {
        switch outcome {
        case .success:
            presentToast(success)
            closeModal()
            Task { await refresh() }
        case let .failed(message):
            presentToast(failure, detail: message)
        }
    }
}

// MARK: - "Use Current Location" (web `handleGetLocation`)

extension GeofencesPageModel {
    /// Resolve a coordinate from the active source (vehicle / browser) and seed the
    /// form name + coordinates (web `handleGetLocation`).
    func getLocation() async {
        isLocating = true
        defer { isLocating = false }
        do {
            let position: GeofencesVehiclePosition
            switch locationSource {
            case .vehicle:
                guard selectedVehicleID > 0 else {
                    presentToast(
                        String(localized: "geofences.selectVehicle", defaultValue: "Select Vehicle"),
                        isError: true
                    )
                    return
                }
                let samples = await useVehiclePositions(vehicleID: selectedVehicleID)
                guard let first = samples.first else {
                    throw GeofencesLocationError.noPosition
                }
                position = first
            case .browser:
                position = try await GeofencesLocationProvider.deviceLocation()
            case .map:
                return
            }
            let name = await reverseGeocode(latitude: position.latitude, longitude: position.longitude)
            applyResolvedLocation(name: name, position: position)
        } catch let error as GeofencesLocationError {
            presentToast(message(for: error), isError: true)
        } catch {
            presentToast(
                String(localized: "geofences.locationFailed", defaultValue: "Failed to get location"),
                isError: true
            )
        }
    }

    /// Seed the draw-map result into the form (web `handleDrawerCreate`).
    func applyDrawnFence(latitude: Double, longitude: Double, radius: Double) {
        form.latitude = String(latitude)
        form.longitude = String(longitude)
        form.radius = String(Int(radius.rounded()))
    }

    private func applyResolvedLocation(name: String, position: GeofencesVehiclePosition) {
        if form.name.isEmpty { form.name = name }
        form.latitude = String(position.latitude)
        form.longitude = String(position.longitude)
    }

    private func message(for error: GeofencesLocationError) -> String {
        switch error {
        case .noPosition:
            String(
                localized: "geofences.noPosition",
                defaultValue: "No position data available for this vehicle"
            )
        case .denied:
            String(localized: "geofences.locationDenied", defaultValue: "Location access denied")
        case .failed:
            String(localized: "geofences.locationFailed", defaultValue: "Failed to get location")
        }
    }
}

// MARK: - Toast plumbing

extension GeofencesPageModel {
    /// Present a transient toast (web `toast.success` / `toast.error`), auto-clearing
    /// after a short delay. `detail` mirrors the web error toast's secondary line.
    func presentToast(_ message: String, detail: String? = nil, isError: Bool = false) {
        let text = detail.map { "\(message) — \($0)" } ?? message
        let toast = GeofencesToast(message: text, isError: isError)
        self.toast = toast
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            if self?.toast?.id == toast.id { self?.toast = nil }
        }
    }
}

// MARK: - Draft fence (web `DrawableGeofence`)

/// The in-progress fence rendered on the draw map (web `drawerFences[0]`).
struct GeofencesDraftFence: Equatable {
    let latitude: Double
    let longitude: Double
    let radius: Double
    let name: String?
}
