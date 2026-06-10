//
//  VehiclePhotoUpload.Model.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `VehiclePhotoUpload` owns the
//  metadata query (`useVehiclePhoto`), the upload + delete mutations
//  (`useUploadVehiclePhoto` / `useDeleteVehiclePhoto`), the `useToast` calls, the instant
//  object-URL preview, and the delete-confirm flag. The native surface reproduces that
//  whole lifecycle here: a `VehiclePhotoSource` pushes the resolved metadata + rendered
//  bytes + load / freshness status, a `VehiclePhotoWriter` performs the mutations, and the
//  model owns the local picked preview, the per-action in-flight flags, the delete-confirm
//  flag, and the transient toast — exposing the resolved `VehiclePhotoPhase` for SwiftUI to
//  switch over. No networking lives in the view.
//

import Foundation
import Observation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// freshness chip + cached-data banner. `live` hides them; `stale` / `offline` show them.
public enum VehiclePhotoConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Load status (web `useVehiclePhoto` query state)

/// The metadata query's load status — the native mirror of the web React-Query state.
/// `failed` carries the human-readable message kept on screen while any cached photo
/// stays visible (web `error.message`).
public enum VehiclePhotoLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Render phase (web preview-region branch + P4 leaf contract)

/// The resolved preview-region phase the view switches over. The web always renders the
/// dropzone chrome; the preview region itself shows the image, the drop prompt, a skeleton,
/// or (P4 leaf contract) a first-load error with retry.
public enum VehiclePhotoPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case data
}

// MARK: - Projection (web render + P4 leaf contract)

/// Pure projection from the snapshot + local-preview state to the resolved preview phase —
/// the native port of the web component's `currentUrl ? <img> : <prompt>` branch widened
/// with the P4 leaf contract (loading skeleton + first-load error). Unit tested across
/// every branch with no rendering host.
public enum VehiclePhotoProjection {
    /// Resolves the preview-region phase.
    ///
    /// - Parameters:
    ///   - status: the metadata query status.
    ///   - hasPhoto: whether the metadata says a photo exists (web `has_photo`).
    ///   - hasImageData: whether the rendered photo bytes are available to display.
    ///   - hasLocalPreview: whether a just-picked local preview is held (web `previewUrl`).
    public static func resolvePhase(
        status: VehiclePhotoLoadStatus,
        hasPhoto: Bool,
        hasImageData: Bool,
        hasLocalPreview: Bool
    ) -> VehiclePhotoPhase {
        // A just-picked preview shows immediately (web `previewUrl ?? …`).
        if hasLocalPreview { return .data }
        // A resolved photo with its bytes shows the image (web `<img src>`).
        if hasPhoto, hasImageData { return .data }
        // First-load failure with nothing cached → the leaf error state.
        if case let .failed(message) = status { return .error(message) }
        // Initial fetch → skeleton chrome.
        if case .loading = status { return .loading }
        // Metadata says a photo exists but its bytes are still arriving.
        if hasPhoto { return .loading }
        // Resolved with no photo → the drop prompt (never a blank box).
        return .empty
    }

    /// The inline error shown above a still-visible (cached) photo when a reload failed —
    /// present only when the data phase is showing despite a failed query, so the image
    /// stays on screen while the failure surfaces (web keeps the prior `<img>`).
    public static func inlineErrorMessage(
        phase: VehiclePhotoPhase,
        status: VehiclePhotoLoadStatus
    ) -> String? {
        guard case .data = phase, case let .failed(message) = status, !message.isEmpty else {
            return nil
        }
        return message
    }
}

// MARK: - View-model (P1/S8 binding)

/// The uploader's observable view-model. Subscribes to a `VehiclePhotoSource`, holds the
/// latest metadata + rendered bytes + freshness, the local picked preview, the per-action
/// in-flight flags, the delete-confirm flag, and the transient toast; exposes the resolved
/// `phase`; validates + drives the write seam; and emits the P1/S11 `view.opened` event
/// once on first appearance.
@MainActor
@Observable
public final class VehiclePhotoUploadModel {
    // Load + freshness (from the source)
    public private(set) var phase: VehiclePhotoPhase = .loading
    public private(set) var meta: VehiclePhotoMeta = .absent
    public private(set) var imageData: Data?
    public private(set) var connection: VehiclePhotoConnection = .live
    public private(set) var refreshing = false

    // Local interaction state (web `previewUrl`, mutation `isPending`, `confirmDelete`)
    public private(set) var localPreview: Data?
    public private(set) var isUploading = false
    public private(set) var isRemoving = false
    public internal(set) var pendingRemove = false

    /// The transient toast raised after an upload/delete or a rejection (web `useToast`).
    public private(set) var toast: VehiclePhotoToast?

    @ObservationIgnored let source: any VehiclePhotoSource
    @ObservationIgnored let writer: any VehiclePhotoWriter
    @ObservationIgnored let telemetry: any VehiclePhotoTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private(set) var lastStatus: VehiclePhotoLoadStatus = .loading
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored var toastDismissTask: Task<Void, Never>?

    public init(
        source: any VehiclePhotoSource,
        writer: any VehiclePhotoWriter = OSLogVehiclePhotoWriter(),
        telemetry: any VehiclePhotoTelemetry = OSLogVehiclePhotoTelemetry(),
        localize: @escaping (String, String) -> String = VehiclePhotoStrings.string
    ) {
        self.source = source
        self.writer = writer
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (preview, labels, gating)

    /// Whether the metadata says a photo exists (web `hasPhoto`) — drives the "Remove"
    /// affordance and the "Replace"/"Choose" label split.
    public var hasPhoto: Bool {
        meta.hasPhoto
    }

    /// The bytes the preview renders — the local pick takes precedence over the resolved
    /// remote photo (web `previewUrl ?? vehiclePhotoUrl(...)`).
    public var displayImageData: Data? {
        localPreview ?? imageData
    }

    /// The primary CTA's resolved label (web `Uploading… / Replace photo / Choose photo`).
    public var primaryLabel: String {
        let descriptor = VehiclePhotoPrimaryLabel.resolve(isUploading: isUploading, hasPhoto: hasPhoto)
        return localize(descriptor.key, descriptor.fallback)
    }

    /// Whether the "Remove" affordance is shown (web `hasPhoto ? <Button> : null`).
    public var canRemove: Bool {
        hasPhoto
    }

    /// Whether the primary CTA is disabled (web `disabled={isUploading}`).
    public var isPrimaryDisabled: Bool {
        isUploading
    }

    /// Whether the "Remove" CTA is disabled (web `disabled={isUploading || remove.isPending}`).
    public var isRemoveDisabled: Bool {
        isUploading || isRemoving
    }

    /// The inline error shown above a cached photo when a reload failed (web keeps `<img>`).
    public var inlineErrorMessage: String? {
        VehiclePhotoProjection.inlineErrorMessage(phase: phase, status: lastStatus)
    }

    /// The VoiceOver phrase describing the current preview-region state.
    public func previewStatePhrase(localizeChrome: (String, String) -> String) -> String {
        switch phase {
        case .loading:
            localizeChrome("vehicles.photos.upload.loadingA11y", "Loading photo")
        case .error:
            localizeChrome("vehicles.photos.upload.errorA11y", "Photo failed to load")
        case .empty:
            localizeChrome("vehicles.photos.upload.dropPrompt", "Drag a photo here or click to choose a file")
        case .data:
            localizeChrome("vehicles.photos.upload.previewAlt", "Vehicle photo preview")
        }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehiclePhotoSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed and tears down the toast timer.
    public func stop() {
        started = false
        toastDismissTask?.cancel()
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry + post-write
    /// invalidation + stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Upload (web `startUpload` → validate → preview → mutate)

    /// Validates a picked candidate and, when acceptable, shows an instant preview and runs
    /// the upload — the native port of the web `startUpload`. A rejected file raises an error
    /// toast and never fires the doomed request (web `validateVehiclePhotoFile` guard).
    public func choose(_ candidate: VehiclePhotoCandidate) async {
        if let rejection = VehiclePhotoValidator.validate(
            byteCount: candidate.byteCount,
            mimeType: candidate.mimeType
        ) {
            raiseToast(.error, message: validationMessage(rejection))
            return
        }
        localPreview = candidate.data
        recomputePhase()
        isUploading = true
        let result = await writer.upload(candidate)
        isUploading = false
        switch result {
        case .success:
            raiseToast(.success, message: localize("vehicles.photos.uploadSuccess", "Photo uploaded."))
            localPreview = nil
            recomputePhase()
            source.refresh()
        case let .failure(message):
            let fallback = localize("vehicles.photos.uploadFailed", "Photo upload failed.")
            raiseToast(.error, message: message.isEmpty ? fallback : message)
            localPreview = nil
            recomputePhase()
        }
    }

    // MARK: Delete (web `confirmDelete` → `useDeleteVehiclePhoto`)

    /// Opens the delete confirmation (web `setConfirmDelete(true)`).
    public func requestRemove() {
        pendingRemove = true
    }

    /// Closes the delete confirmation (web `setConfirmDelete(false)`) — the cancel button
    /// and the dialog's dismiss both route here.
    public func cancelRemove() {
        pendingRemove = false
    }

    /// Removes the current photo — the native port of the web `handleRemove`. Raises the
    /// matching toast and refreshes the bound source on success (web invalidates the query).
    public func confirmRemove() async {
        isRemoving = true
        let result = await writer.delete()
        isRemoving = false
        switch result {
        case .success:
            raiseToast(.success, message: localize("vehicles.photos.deleteSuccess", "Photo removed."))
            source.refresh()
        case let .failure(message):
            let fallback = localize("vehicles.photos.deleteFailed", "Failed to remove photo.")
            raiseToast(.error, message: message.isEmpty ? fallback : message)
        }
    }

    // MARK: Toast (web `useToast`)

    /// Raises a toast and schedules its auto-dismiss (web toast lifetime).
    func raiseToast(_ kind: VehiclePhotoToastKind, message: String) {
        toast = VehiclePhotoToast(kind: kind, message: message)
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    /// Clears the active toast (auto-dismiss + manual close).
    public func dismissToast() {
        toastDismissTask?.cancel()
        toast = nil
    }

    // MARK: Snapshot application

    private func apply(_ update: VehiclePhotoUpdate) {
        meta = update.meta
        imageData = update.imageData
        connection = update.connection
        refreshing = update.refreshing
        lastStatus = update.status
        recomputePhase()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the render phase from the last status, the metadata, the available bytes,
    /// and whether a local preview is held.
    func recomputePhase() {
        phase = VehiclePhotoProjection.resolvePhase(
            status: lastStatus,
            hasPhoto: meta.hasPhoto,
            hasImageData: imageData != nil,
            hasLocalPreview: localPreview != nil
        )
    }

    /// The localized failure message for a rejected file, with the reason's `{{token}}`
    /// substituted (web hardcodes these strings; native routes them through the facade).
    private func validationMessage(_ rejection: VehiclePhotoRejection) -> String {
        var message = localize(rejection.messageKey, rejection.messageFallback)
        if let interpolation = rejection.interpolation {
            message = message.replacingOccurrences(of: interpolation.token, with: interpolation.value)
        }
        return message
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// photo on screen and does not refetch.
    private func handleAutoRefresh(for connection: VehiclePhotoConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
