//
//  VehiclePhotoGallery.Model.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `VehiclePhotoGallery` is a pure
//  display component: it receives a `photos` array, tracks the open/active-index lightbox
//  state, and renders an empty card or a thumbnail grid. The native surface reproduces that
//  whole lifecycle here — a `PhotoGallerySource` pushes the resolved images + load / freshness
//  status, the model owns the immersive-viewer open + active-index state and the navigation,
//  and it exposes the resolved `PhotoGalleryPhase` for SwiftUI to switch over — and widens it
//  with the P4 leaf contract (loading / error / stale / offline) the web parent owns. No
//  networking lives in the view.
//

import Foundation
import Observation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// freshness chip + cached-data banner. `live` hides them; `stale` / `offline` show them.
public enum PhotoGalleryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Load status (the photo query state)

/// The photo query's load status — the native mirror of the web React-Query state. `failed`
/// carries the human-readable message kept on screen while any cached photos stay visible.
public enum PhotoGalleryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Render phase (web empty/data branch + P4 leaf contract)

/// The resolved phase the view switches over. The web renders the empty-state card or the
/// thumbnail grid; the native leaf contract widens that with a loading skeleton grid and a
/// first-load error with retry.
public enum PhotoGalleryPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case data
}

// MARK: - Projection (web render + P4 leaf contract)

/// Pure projection from the snapshot to the resolved phase — the native port of the web
/// component's `photos.length === 0 ? <empty> : <grid>` branch widened with the P4 leaf
/// contract (loading skeleton + first-load error). Plus the index clamp guarding the viewer.
/// Unit tested across every branch with no rendering host.
public enum PhotoGalleryProjection {
    /// Resolves the render phase.
    ///
    /// - Parameters:
    ///   - status: the photo query status.
    ///   - hasPhotos: whether any image records are available to display (web `photos.length`).
    public static func resolvePhase(status: PhotoGalleryLoadStatus, hasPhotos: Bool) -> PhotoGalleryPhase {
        // Any resolved photos show the grid (web data branch), even if a later reload failed —
        // the cached grid stays put and the failure surfaces as an inline error.
        if hasPhotos { return .data }
        // First-load failure with nothing cached → the leaf error state.
        if case let .failed(message) = status { return .error(message) }
        // Initial fetch → skeleton chrome.
        if case .loading = status { return .loading }
        // Resolved with no photos → the empty-state card (never a blank box; web empty card).
        return .empty
    }

    /// The inline error shown above a still-visible (cached) grid when a reload failed — present
    /// only when the data phase is showing despite a failed query, so the grid stays on screen
    /// while the failure surfaces (web keeps the prior thumbnails).
    public static func inlineErrorMessage(phase: PhotoGalleryPhase, status: PhotoGalleryLoadStatus) -> String? {
        guard case .data = phase, case let .failed(message) = status, !message.isEmpty else {
            return nil
        }
        return message
    }

    /// Clamps an index into the valid range for a count, returning 0 for an empty collection —
    /// guards the immersive viewer's active index when the photo set shrinks under it.
    public static func clampIndex(_ index: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(index, 0), count - 1)
    }
}

// MARK: - View-model (P1/S8 binding)

/// The gallery's observable view-model. Subscribes to a `PhotoGallerySource`, holds the latest
/// images + freshness, owns the immersive-viewer open + active-index state and the prev/next
/// navigation, exposes the resolved `phase`, and emits the P1/S11 `view.opened` event once on
/// first appearance.
@MainActor
@Observable
public final class PhotoGalleryModel {
    // Load + freshness (from the source)
    public private(set) var phase: PhotoGalleryPhase = .loading
    public private(set) var photos: [PhotoGalleryImage] = []
    public private(set) var connection: PhotoGalleryConnection = .live
    public private(set) var refreshing = false

    // Immersive-viewer state (web `open` + `activeIndex`)
    public private(set) var isViewerOpen = false
    public private(set) var activeIndex = 0

    /// Optional vehicle display name used to compose the grid's accessible label (web
    /// `vehicleName` prop → "{{name}} photo gallery").
    public let vehicleName: String?

    @ObservationIgnored let source: any PhotoGallerySource
    @ObservationIgnored let telemetry: any PhotoGalleryTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private(set) var lastStatus: PhotoGalleryLoadStatus = .loading
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any PhotoGallerySource,
        telemetry: any PhotoGalleryTelemetry = OSLogPhotoGalleryTelemetry(),
        localize: @escaping (String, String) -> String = PhotoGalleryStrings.string,
        vehicleName: String? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        self.vehicleName = vehicleName
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (counts, navigation gating, current image)

    /// Whether any photos are available (web `photos.length > 0`) — drives the empty/data branch.
    public var hasPhotos: Bool {
        !photos.isEmpty
    }

    /// The number of photos (web `photos.length`) — the viewer counter total + nav bounds.
    public var photoCount: Int {
        photos.count
    }

    /// The image the immersive viewer currently shows, or `nil` when the set is empty.
    public var activeImage: PhotoGalleryImage? {
        guard photos.indices.contains(activeIndex) else { return nil }
        return photos[activeIndex]
    }

    /// Whether the viewer can step to a previous image (web `index > 0`).
    public var canGoPrevious: Bool {
        activeIndex > 0
    }

    /// Whether the viewer can step to a next image (web `index < total - 1`).
    public var canGoNext: Bool {
        activeIndex < photos.count - 1
    }

    /// The inline error shown above a cached grid when a reload failed (web keeps thumbnails).
    public var inlineErrorMessage: String? {
        PhotoGalleryProjection.inlineErrorMessage(phase: phase, status: lastStatus)
    }

    // MARK: Derived labels (resolved through the facade)

    /// The grid's accessible label — web `vehicleName ? '{{name}} photo gallery' : 'Photo
    /// gallery'`, with `{{name}}` substituted when a name is present.
    public var galleryAccessibilityLabel: String {
        let descriptor = PhotoGalleryAccessibility.galleryLabel(hasVehicleName: vehicleName != nil)
        let template = localize(descriptor.key, descriptor.fallback)
        if let vehicleName {
            return PhotoGalleryAccessibility.interpolateName(template, name: vehicleName)
        }
        return template
    }

    /// A thumbnail's accessible label — web `'Open photo {{index}} of {{total}}'` with a
    /// 1-based index.
    public func thumbnailLabel(at index: Int) -> String {
        let template = localize("vehicles.photos.openAt", "Open photo {{index}} of {{total}}")
        return PhotoGalleryAccessibility.interpolatePosition(template, index: index + 1, total: photoCount)
    }

    /// The immersive viewer's counter — "{{index}} of {{total}}", 1-based.
    public var viewerCounterLabel: String {
        let template = localize("vehicles.photos.gallery.viewerCounter", "{{index}} of {{total}}")
        return PhotoGalleryAccessibility.interpolatePosition(template, index: activeIndex + 1, total: photoCount)
    }

    /// The accessible description for an image — its `alt`, or a localized fallback when the
    /// record carries an empty alt (web allows empty alt for decorative images).
    public func imageAlt(_ image: PhotoGalleryImage) -> String {
        image.alt.isEmpty ? localize("vehicles.photos.gallery.photoAlt", "Vehicle photo") : image.alt
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PhotoGallerySurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (the error-state retry + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Immersive viewer (web `<Lightbox open initialIndex>`)

    /// Opens the immersive viewer at a thumbnail index (web `handleOpen(i)`). A no-op when the
    /// set is empty; the index is clamped so an out-of-range request still lands in bounds.
    public func open(at index: Int) {
        guard hasPhotos else { return }
        activeIndex = PhotoGalleryProjection.clampIndex(index, count: photoCount)
        isViewerOpen = true
    }

    /// Closes the immersive viewer (web `onClose`).
    public func close() {
        isViewerOpen = false
    }

    /// Steps to the next image, clamped at the end (web `goNext`).
    public func showNext() {
        activeIndex = PhotoGalleryProjection.clampIndex(activeIndex + 1, count: photoCount)
    }

    /// Steps to the previous image, clamped at the start (web `goPrev`).
    public func showPrevious() {
        activeIndex = PhotoGalleryProjection.clampIndex(activeIndex - 1, count: photoCount)
    }

    // MARK: Snapshot application

    private func apply(_ update: PhotoGalleryUpdate) {
        photos = update.photos
        connection = update.connection
        refreshing = update.refreshing
        lastStatus = update.status
        // Keep the viewer's active index valid when the set changes under it; close the viewer
        // outright if the set emptied so it never shows a blank frame.
        if photos.isEmpty {
            isViewerOpen = false
        }
        activeIndex = PhotoGalleryProjection.clampIndex(activeIndex, count: photoCount)
        recomputePhase()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the render phase from the last status and whether any photos are available.
    func recomputePhase() {
        phase = PhotoGalleryProjection.resolvePhase(status: lastStatus, hasPhotos: hasPhotos)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so
    /// a later stale episode re-triggers exactly once. Offline keeps the cached grid on screen
    /// and does not refetch.
    private func handleAutoRefresh(for connection: PhotoGalleryConnection) {
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
