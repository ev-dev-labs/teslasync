//
//  UserCell.Model.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the shared UserCell primitive. The view binds through `UserCellModel`;
//  the cell performs no fetch of its own (the only network is the composed avatar's optional remote
//  image). The web UserCell only reads `useTranslation` (it has no data hook) and takes its user
//  from props; the native model keeps the same data contract — a source emits the cell descriptor,
//  the model derives the resolved projection + the localised display name, and emits `view.opened`
//  once when the surface first appears.
//
//  Parity note on the P4 "loading / stale / offline" axis: the web UserCell is a pure presentational
//  cell with no query feed (its only data source is `useTranslation`), so there is no freshness axis
//  to render — fabricating a network loading / error / stale / offline chip here would be drift, not
//  parity, and is exactly what the Honesty Covenant forbids (no parity shortcuts, no silent drift).
//  The two genuine render branches the web source has — the em-dash empty cell and the populated
//  avatar + name (+ optional email) — are both reproduced, and the avatar's own image load lifecycle
//  (loading → fallback disc, loaded → image, failed → fallback) is handled inside the composed
//  Avatar surface, so the cell is never a blank box.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol UserCellTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogUserCellTelemetry: UserCellTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the view binds through for the cell descriptor — the native binding point for the web
/// component props. The production app implements this over the host-provided descriptor
/// (`LiveUserCellSource`); previews and tests use `InMemoryUserCellSource`. The feed is local +
/// synchronous (no HTTP in the view).
@MainActor
public protocol UserCellSource: AnyObject {
    var onUpdate: (@MainActor (UserCellDescriptor) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production source. Holds the host-provided descriptor and re-emits it on `start`/`refresh`
/// — the native binding point for the web component props. The feed is local + synchronous; the
/// host re-creates the source when the props change.
@MainActor
public final class LiveUserCellSource: UserCellSource {
    public var onUpdate: (@MainActor (UserCellDescriptor) -> Void)?

    private let descriptor: UserCellDescriptor

    public init(descriptor: UserCellDescriptor) {
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

/// In-memory source for previews + unit/UI tests. Seeds an optional initial descriptor on `start()`
/// and lets a test push further descriptors via `push(_:)`.
@MainActor
public final class InMemoryUserCellSource: UserCellSource {
    public var onUpdate: (@MainActor (UserCellDescriptor) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: UserCellDescriptor?

    public init(initial: UserCellDescriptor? = nil) {
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
    public func push(_ descriptor: UserCellDescriptor) {
        onUpdate?(descriptor)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `UserCellSource`, recomputes the resolved
/// projection (resolving the localised "Unknown user" word through the i18n facade), exposes the
/// resolved view-state plus the localised display name / accessibility strings, and emits the
/// `view.opened` diagnostics event exactly once when the cell first appears.
@MainActor
@Observable
public final class UserCellModel {
    public private(set) var descriptor: UserCellDescriptor
    public private(set) var resolved: UserCellResolved

    @ObservationIgnored private let source: any UserCellSource
    @ObservationIgnored private let telemetry: any UserCellTelemetry
    @ObservationIgnored private let strings: UserCellResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any UserCellSource,
        telemetry: any UserCellTelemetry = OSLogUserCellTelemetry(),
        strings: @escaping UserCellResolve = UserCellStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        let initial = UserCellDescriptor()
        descriptor = initial
        resolved = UserCellProjection.resolve(initial, unknownWord: strings("avatar.unknown", "Unknown user"))
        source.onUpdate = { [weak self] descriptor in self?.apply(descriptor) }
    }

    /// Begins observing the descriptor and emits the `view.opened` diagnostics event exactly once
    /// for the surface's lifetime. Idempotent.
    public func start() {
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: UserCellMeta.surfaceSlug)
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

    private func apply(_ descriptor: UserCellDescriptor) {
        self.descriptor = descriptor
        resolved = UserCellProjection.resolve(descriptor, unknownWord: unknownWord)
    }

    // MARK: Localised accessors (web `t(key, default)`)

    /// The localised "Unknown user" word — the web `t('avatar.unknown', 'Unknown user')` fallback,
    /// shared with the Avatar surface key namespace.
    public var unknownWord: String {
        strings("avatar.unknown", "Unknown user")
    }

    /// The visible / spoken display name when the cell is populated, else `nil` for the empty cell.
    /// Mirrors the web computed `displayName`.
    public var displayName: String? {
        switch resolved {
        case .empty: nil
        case let .populated(populated): populated.displayName
        }
    }

    /// The VoiceOver label for the cell — the display name when populated, else the em-dash glyph
    /// the empty cell renders.
    public var accessibilityLabel: String {
        switch resolved {
        case .empty: UserCellProjection.emptyGlyph
        case let .populated(populated): UserCellAccessibility.label(for: populated)
        }
    }

    /// The VoiceOver value for the cell — the email line when shown, else empty (no value).
    public var accessibilityValue: String {
        switch resolved {
        case .empty: ""
        case let .populated(populated): UserCellAccessibility.value(for: populated)
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. The one web key is `avatar.unknown` (the display-name fallback the cell
/// shares with the Avatar surface). Kept in the per-surface "UserCell" table so each parallel
/// prompt owns its own strings; the entries fold into the app `Localizable.xcstrings` catalog at
/// integration time.
public enum UserCellStrings {
    public static let table = "UserCell"

    public static let string: UserCellResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
