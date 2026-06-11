//
//  VehiclePhotoGallery.Seams.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  The dependency seams the VehiclePhotoGallery view-model binds through, kept apart from the
//  model for the lint length budget: the surface identity, the P1/S11 telemetry contract, the
//  P1/S10 i18n facade (web `useTranslation`), the read snapshot + P1/S8 source protocol (the
//  native equivalent of the parent passing `photos`, plus the rendered bytes the view never
//  fetches itself), and the in-memory source used by previews + tests. None of this imports
//  SwiftUI, so the pure + model layer compiles and unit-tests with no rendering toolchain.
//

import Foundation
import OSLog

// MARK: - Surface identity

/// The surface's stable, non-identifying slug — used by the `view.opened` telemetry. Kept
/// SwiftUI-free (off the view struct) so the model + seams layer stays renderer-independent
/// for the isolated unit build.
public enum PhotoGallerySurface {
    public static let slug = "VehiclePhotoGallery"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// diagnostics sink (consent-gated + redacted there).
public protocol PhotoGalleryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant logged verbatim.
public struct OSLogPhotoGalleryTelemetry: PhotoGalleryTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "VehiclePhotoGallery" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings. The web keys (`vehicles.photos.*`) are preserved verbatim.
public enum PhotoGalleryStrings {
    public static let table = "VehiclePhotoGallery"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{name}}` / `{{index}}`): resolves then
    /// substitutes a single token, mirroring the web `t(key, { ... })` calls.
    public static func string(_ key: String, _ fallback: String, _ token: String, _ value: String) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Read snapshot + P1/S8 source protocol (the parent's `photos` feed)

/// One coalesced snapshot pushed by a `PhotoGallerySource`: the load status, the resolved
/// image records (each carrying its rendered bytes, fetched behind the seam so the view
/// performs no HTTP), the live-state freshness, and the in-flight reload flag.
public struct PhotoGalleryUpdate: Sendable, Equatable {
    public var status: PhotoGalleryLoadStatus
    public var photos: [PhotoGalleryImage]
    public var connection: PhotoGalleryConnection
    public var refreshing: Bool

    public init(
        status: PhotoGalleryLoadStatus = .loading,
        photos: [PhotoGalleryImage] = [],
        connection: PhotoGalleryConnection = .live,
        refreshing: Bool = false
    ) {
        self.status = status
        self.photos = photos
        self.connection = connection
        self.refreshing = refreshing
    }
}

/// The read seam the view binds through. Production implements this over the shared P1/S8
/// vehicle-photo state holder (the photo query plus the per-image rendered-bytes fetch);
/// previews/tests use `InMemoryPhotoGallerySource`. The view never talks to the network.
@MainActor
public protocol PhotoGallerySource: AnyObject {
    var onUpdate: (@MainActor (PhotoGalleryUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (the error-state retry + the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryPhotoGallerySource: PhotoGallerySource {
    public var onUpdate: (@MainActor (PhotoGalleryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PhotoGalleryUpdate?

    public init(initial: PhotoGalleryUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: PhotoGalleryUpdate) {
        onUpdate?(update)
    }
}
