//
//  Avatar.Model.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the shared Avatar primitive. The view binds through `AvatarModel`;
//  no networking lives in the view beyond the platform image load. The web Avatar only reads
//  `useTranslation` (it has no data hook) and takes its identity from props; the native model
//  keeps the same data contract — a source emits the avatar descriptor, the model derives the
//  resolved projection + the localised identity / presence strings, and emits `view.opened` once
//  when the surface first appears.
//
//  Parity note on the P4 "stale / offline" axis: the web Avatar is a pure presentational
//  primitive with no query feed (its only data source is `useTranslation`), so there is no
//  freshness axis to render — fabricating a network stale/offline chip here would be drift, not
//  parity. The avatar's genuine "presence" concept is the online/idle/offline status dot, which
//  is reproduced faithfully, and the image load lifecycle (loading → fallback, loaded → image,
//  failed → fallback) is the only fetch state, handled in the view via `AsyncImage` so the disc
//  is never a blank box.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AvatarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogAvatarTelemetry: AvatarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the view binds through for the avatar descriptor — the native binding point for the
/// web component props. The production app implements this over the host-provided descriptor
/// (`LiveAvatarSource`); previews and tests use `InMemoryAvatarSource`. The feed is local +
/// synchronous (no HTTP in the view).
@MainActor
public protocol AvatarSource: AnyObject {
    var onUpdate: (@MainActor (AvatarDescriptor) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production source. Holds the host-provided descriptor and re-emits it on `start`/`refresh`
/// — the native binding point for the web component props. The feed is local + synchronous; the
/// host re-creates the source when the props change.
@MainActor
public final class LiveAvatarSource: AvatarSource {
    public var onUpdate: (@MainActor (AvatarDescriptor) -> Void)?

    private let descriptor: AvatarDescriptor

    public init(descriptor: AvatarDescriptor) {
        self.descriptor = descriptor
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(descriptor)
    }
}

/// In-memory source for previews + unit/UI tests. Seeds an optional initial descriptor on
/// `start()` and lets a test push further descriptors via `push(_:)`.
@MainActor
public final class InMemoryAvatarSource: AvatarSource {
    public var onUpdate: (@MainActor (AvatarDescriptor) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AvatarDescriptor?

    public init(initial: AvatarDescriptor? = nil) {
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

    /// Pushes a descriptor to the bound model (test/preview affordance).
    public func push(_ descriptor: AvatarDescriptor) {
        onUpdate?(descriptor)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AvatarSource`, recomputes the resolved
/// projection, exposes the resolved view-state plus the localised identity / tooltip / presence
/// strings, and emits the `view.opened` diagnostics event exactly once when the avatar first
/// appears.
@MainActor
@Observable
public final class AvatarModel {
    public private(set) var descriptor: AvatarDescriptor
    public private(set) var resolved: AvatarResolved

    @ObservationIgnored private let source: any AvatarSource
    @ObservationIgnored private let telemetry: any AvatarTelemetry
    @ObservationIgnored private let strings: AvatarResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any AvatarSource,
        telemetry: any AvatarTelemetry = OSLogAvatarTelemetry(),
        strings: @escaping AvatarResolve = AvatarStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        let initial = AvatarDescriptor()
        descriptor = initial
        resolved = AvatarProjection.resolve(initial)
        source.onUpdate = { [weak self] descriptor in self?.apply(descriptor) }
    }

    /// Begins observing the descriptor and emits the `view.opened` diagnostics event exactly once
    /// for the surface's lifetime. Idempotent.
    public func start() {
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: AvatarMeta.surfaceSlug)
        }
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the descriptor.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the descriptor snapshot.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ descriptor: AvatarDescriptor) {
        self.descriptor = descriptor
        resolved = AvatarProjection.resolve(descriptor)
    }

    // MARK: Localised accessors (web `t(key, default)`)

    /// The identity label — the trimmed name, or the localised "Unknown user" (web tooltip /
    /// image `alt` fallback).
    public var identityLabel: String {
        AvatarAccessibility.identityLabel(
            trimmedName: descriptor.trimmedName,
            unknownWord: strings("avatar.unknown", "Unknown user")
        )
    }

    /// The tooltip content — the same identity string, shown only when `showTooltip` is set (web
    /// `<Tooltip content={tooltipLabel}>`).
    public var tooltipLabel: String? {
        descriptor.showTooltip ? identityLabel : nil
    }

    /// The accessible image description — the identity string (web `<img alt={…}>`).
    public var imageAltLabel: String {
        identityLabel
    }

    /// The localised presence value, or `nil` when no status is set (web dot `aria-label`).
    public var presenceLabel: String? {
        guard let status = resolved.status else { return nil }
        return strings(
            AvatarAccessibility.presenceKey(for: status),
            AvatarAccessibility.presenceFallback(for: status)
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "Avatar" table (the web source keys `avatar.unknown`,
/// `avatar.statusOnline`, `avatar.statusIdle`, `avatar.statusOffline`), folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum AvatarStrings {
    public static let table = "Avatar"

    public static let string: AvatarResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
