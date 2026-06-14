//
//  FlagsTable.Model.swift
//  TeslaSync — P4 feature view · 0031 · FlagsTable (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through `FlagsTableModel`;
//  no networking lives in the view.
//
//  The web `FlagsTable` is a presentational component fed `rows` + `loading` by
//  its parent. The native surface keeps that contract: the parent-owned data
//  arrives through a `FlagsTableSource` (the production app wires it to the
//  shared admin-diagnostics state holder), and the row actions stay as the
//  view's `onEdit` / `onAskDelete` callbacks. The model adds the load / refresh
//  / freshness lifecycle the P4 surface contract requires.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted
/// there).
public protocol FlagsTableTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogFlagsTableTelemetry: FlagsTableTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the registry, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum FlagsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum FlagsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `FlagsTableSource`: the cached registry
/// rows plus the load / connection status and the reference time. The model
/// turns this into the `FlagsProjection` + render phase.
public struct FlagsTableUpdate: Sendable, Equatable {
    public var status: FlagsLoadStatus
    public var connection: FlagsConnection
    public var flags: [FlagsTableEntry]?
    public var updatedAt: Date?

    public init(
        status: FlagsLoadStatus = .loading,
        connection: FlagsConnection = .live,
        flags: [FlagsTableEntry]? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.flags = flags
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the admin-diagnostics `useFeatureFlags`
/// equivalent — `StateHolderModel<LoadableState<…>>` over the KMP diagnostics
/// store); previews and tests use `InMemoryFlagsTableSource`. The view never
/// talks to the network directly.
@MainActor
public protocol FlagsTableSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (FlagsTableUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `FlagsTableSource`,
/// recomputes the `FlagsProjection` via `FlagsTableAdapter`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class FlagsTableModel {
    /// The mutually-exclusive render branches (web shell loading / empty + body).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: FlagsConnection = .live
    public private(set) var projection: FlagsProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any FlagsTableSource
    @ObservationIgnored private let telemetry: any FlagsTableTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any FlagsTableSource,
        telemetry: any FlagsTableTelemetry = OSLogFlagsTableTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FlagsTable.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached rows stay visible). Wired to the retry /
    /// refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: FlagsTableUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = FlagsTableAdapter.project(update.flags ?? [])
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the "Loading flags…" message
    /// on the initial fetch and the "No feature flags…" message when nothing
    /// resolved; whenever any rows are known the table renders (cached rows stay
    /// visible behind refresh / errors).
    static func resolvePhase(status: FlagsLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryFlagsTableSource: FlagsTableSource {
    public var onUpdate: (@MainActor (FlagsTableUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FlagsTableUpdate?

    public init(initial: FlagsTableUpdate? = nil) {
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
    public func push(_ update: FlagsTableUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "FlagsTable" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum FlagsTableStrings {
    public static let table = "FlagsTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Count-formatted string (web `t(key, default, { count })` numeric copy).
    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// One-argument format (e.g. the per-row action accessibility labels).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }

    /// Two-argument format (e.g. the per-row "key, value" accessibility label).
    public static func format(
        _ key: String,
        _ fallbackFormat: String,
        _ first: String,
        _ second: String
    ) -> String {
        String(format: string(key, fallbackFormat), first, second)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content spoken for the table + its rows. Pure + public so
/// the a11y label content can be unit-tested without rendering the view.
public enum FlagsTableAccessibility {
    /// The container summary (count of flags, or the empty message).
    public static func summary(for projection: FlagsProjection) -> String {
        guard projection.hasData else {
            return FlagsTableStrings.string(
                "admin.flags.table.empty",
                "No feature flags are set on this server."
            )
        }
        return FlagsTableStrings.count("admin.flags.a11y.count", "%lld feature flags", projection.rows.count)
    }

    /// The per-row label (web row content: the flag key and its value preview).
    public static func rowLabel(_ entry: FlagsTableEntry) -> String {
        FlagsTableStrings.format("admin.flags.a11y.row", "%@, value %@", entry.key, entry.valuePreview)
    }

    /// The Edit action label, scoped to the flag key for VoiceOver.
    public static func editLabel(_ entry: FlagsTableEntry) -> String {
        FlagsTableStrings.format("admin.flags.actions.editFlag", "Edit %@", entry.key)
    }

    /// The Delete action label, scoped to the flag key for VoiceOver.
    public static func deleteLabel(_ entry: FlagsTableEntry) -> String {
        FlagsTableStrings.format("admin.flags.actions.deleteFlag", "Delete %@", entry.key)
    }
}
