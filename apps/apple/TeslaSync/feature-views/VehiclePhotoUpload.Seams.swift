//
//  VehiclePhotoUpload.Seams.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  The dependency seams the VehiclePhotoUpload view-model binds through, kept apart from
//  the model for the lint length budget: the surface identity, the P1/S11 telemetry
//  contract, the P1/S10 i18n facade (web `useTranslation`), the toast type (web
//  `useToast`), the read snapshot + P1/S8 source protocol (web `useVehiclePhoto`), and
//  the write seam (web `useUploadVehiclePhoto` + `useDeleteVehiclePhoto`) with its result
//  type plus the in-memory source / recording writer used by previews + tests. None of
//  this imports SwiftUI, so the pure + model layer compiles and unit-tests with no
//  rendering toolchain. No networking lives in the view.
//

import Foundation
import OSLog

// MARK: - Surface identity

/// The surface's stable, non-identifying slug — used by the `view.opened` telemetry.
/// Kept SwiftUI-free (off the view struct) so the model + seams layer stays
/// renderer-independent for the isolated unit build.
public enum VehiclePhotoSurface {
    public static let slug = "VehiclePhotoUpload"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// diagnostics sink (consent-gated + redacted there).
public protocol VehiclePhotoTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant logged verbatim.
public struct OSLogVehiclePhotoTelemetry: VehiclePhotoTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold
/// no hardcoded literals. Keys live in the "VehiclePhotoUpload" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings. The web keys (`vehicles.photos.*` / `common.remove`) are
/// preserved verbatim.
public enum VehiclePhotoStrings {
    public static let table = "VehiclePhotoUpload"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{max}}` / `{{type}}`): resolves then
    /// substitutes a single token, mirroring the web `t(key, { max })` calls.
    public static func string(_ key: String, _ fallback: String, _ token: String, _ value: String) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Toast (web `useToast`)

/// The two toast tones the web surface raises (`toast.success` after an upload/delete,
/// `toast.error` on a failed mutation or a rejected file).
public enum VehiclePhotoToastKind: Sendable, Equatable {
    case success
    case error
}

/// A transient toast raised after an upload/delete or a client-side rejection — the native
/// projection of the web `useToast` calls. Holds pre-resolved copy (already run through the
/// i18n facade) so the renderer prints it verbatim.
public struct VehiclePhotoToast: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public let kind: VehiclePhotoToastKind
    public let message: String

    public init(kind: VehiclePhotoToastKind, message: String) {
        self.kind = kind
        self.message = message
    }
}

// MARK: - Read snapshot + P1/S8 source protocol (web `useVehiclePhoto`)

/// One coalesced snapshot pushed by a `VehiclePhotoSource`: the load status, the resolved
/// photo metadata, the rendered photo bytes (web `<img src>`, fetched behind the seam so
/// the view performs no HTTP), the live-state freshness, and the in-flight reload flag.
public struct VehiclePhotoUpdate: Sendable, Equatable {
    public var status: VehiclePhotoLoadStatus
    public var meta: VehiclePhotoMeta
    public var imageData: Data?
    public var connection: VehiclePhotoConnection
    public var refreshing: Bool

    public init(
        status: VehiclePhotoLoadStatus = .loading,
        meta: VehiclePhotoMeta = .absent,
        imageData: Data? = nil,
        connection: VehiclePhotoConnection = .live,
        refreshing: Bool = false
    ) {
        self.status = status
        self.meta = meta
        self.imageData = imageData
        self.connection = connection
        self.refreshing = refreshing
    }
}

/// The read seam the view binds through. Production implements this over the shared P1/S8
/// vehicle-photo state holder (the `useVehiclePhoto` query plus the rendered-bytes fetch);
/// previews/tests use `InMemoryVehiclePhotoSource`. The view never talks to the network
/// directly.
@MainActor
public protocol VehiclePhotoSource: AnyObject {
    var onUpdate: (@MainActor (VehiclePhotoUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web cache invalidation after an upload/delete + the
    /// stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryVehiclePhotoSource: VehiclePhotoSource {
    public var onUpdate: (@MainActor (VehiclePhotoUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehiclePhotoUpdate?

    public init(initial: VehiclePhotoUpdate? = nil) {
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
    public func push(_ update: VehiclePhotoUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Write seam (web `useUploadVehiclePhoto` + `useDeleteVehiclePhoto`)

/// The outcome of an upload/delete mutation — success, or a failure carrying the backend's
/// human-readable message (web `onError(err) → toast.error(err.message)`).
public enum VehiclePhotoWriteResult: Sendable, Equatable {
    case success
    case failure(String)
}

/// The two mutations the surface drives. Both are kept off the view so all networking lives
/// behind the seam; the model awaits a result, raises the matching toast, and refreshes the
/// bound source on success (web invalidates the photo + vehicle queries).
public protocol VehiclePhotoWriter: Sendable {
    /// Uploads a validated candidate (web `useUploadVehiclePhoto` → POST multipart).
    func upload(_ candidate: VehiclePhotoCandidate) async -> VehiclePhotoWriteResult

    /// Deletes the current photo (web `useDeleteVehiclePhoto` → DELETE, idempotent).
    func delete() async -> VehiclePhotoWriteResult
}

/// `os.Logger`-backed default that records the intent without networking, so previews
/// render the write chrome safely. Reports success so the bound source refreshes.
public struct OSLogVehiclePhotoWriter: VehiclePhotoWriter {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "vehicle-photo")
    }

    public func upload(_ candidate: VehiclePhotoCandidate) async -> VehiclePhotoWriteResult {
        logger.info("vehiclePhoto.upload bytes=\(candidate.byteCount, privacy: .public)")
        return .success
    }

    public func delete() async -> VehiclePhotoWriteResult {
        logger.info("vehiclePhoto.delete")
        return .success
    }
}

/// Records every upload/delete for tests and returns a pre-configured result, with no
/// side effects. An `actor` so the model's awaited mutations stay race-free under Swift 6
/// strict concurrency.
public actor RecordingVehiclePhotoWriter: VehiclePhotoWriter {
    public private(set) var uploadedCandidates: [VehiclePhotoCandidate] = []
    public private(set) var deleteCount = 0

    private let uploadResult: VehiclePhotoWriteResult
    private let deleteResult: VehiclePhotoWriteResult

    public init(
        uploadResult: VehiclePhotoWriteResult = .success,
        deleteResult: VehiclePhotoWriteResult = .success
    ) {
        self.uploadResult = uploadResult
        self.deleteResult = deleteResult
    }

    public func upload(_ candidate: VehiclePhotoCandidate) async -> VehiclePhotoWriteResult {
        uploadedCandidates.append(candidate)
        return uploadResult
    }

    public func delete() async -> VehiclePhotoWriteResult {
        deleteCount += 1
        return deleteResult
    }

    /// The number of uploads recorded (test affordance).
    public var uploadCount: Int {
        uploadedCandidates.count
    }
}
