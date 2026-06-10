//
//  VehicleCommandCenter.Model.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  State-holder seams (P1/S8) + telemetry seam (P1/S11) + feedback/toast seam + favorites
//  seam + i18n facade (P1/S10) for the Vehicle Command Center — the SwiftUI parity of
//  features/system/components/VehicleCommandCenter.tsx. The view binds the same data the web
//  orchestrator reads through these seams so it performs no I/O. The DTOs live in
//  VehicleCommandCenter.State.swift and the observable model in VehicleCommandCenter.ViewModel.swift.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept SwiftUI-free
/// so the model compiles + tests on a plain host; the view re-exposes it.
public enum VehicleCommandCenterSurface {
    public static let slug = "VehicleCommandCenter"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared
/// core diagnostics pipeline (consent-gated + redacted there).
public protocol VehicleCommandCenterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogVehicleCommandCenterTelemetry: VehicleCommandCenterTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Feedback seam (web `useToast`)

/// The transient feedback seam (web `toast.success` / `toast.error`). The model
/// routes every command outcome through it; production wires it to the shared
/// `ToastCenter`, previews + tests inject `InMemoryVehicleCommandFeedback`.
@MainActor
public protocol VehicleCommandFeedback: AnyObject {
    func success(_ message: String)
    func failure(_ message: String)
}

/// `os.Logger`-backed default used when no toast host is injected.
@MainActor
public final class OSLogVehicleCommandFeedback: VehicleCommandFeedback {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "commands")
    }

    public func success(_ message: String) {
        logger.info("command toast success: \(message, privacy: .public)")
    }

    public func failure(_ message: String) {
        logger.warning("command toast failure: \(message, privacy: .public)")
    }
}

/// Records emitted toasts for previews + tests.
@MainActor
public final class InMemoryVehicleCommandFeedback: VehicleCommandFeedback {
    public private(set) var successes: [String] = []
    public private(set) var failures: [String] = []

    public init() {}

    public func success(_ message: String) {
        successes.append(message)
    }

    public func failure(_ message: String) {
        failures.append(message)
    }
}

// MARK: - Favorites seam (web localStorage `teslasync-cmd-favorites-{id}`)

/// Persistence seam for the per-vehicle favorite command ids (web localStorage).
/// Production wires `UserDefaults`; previews + tests inject the in-memory store.
@MainActor
public protocol VehicleCommandFavoritesStore: AnyObject {
    /// The persisted favorite ids, or `nil` when nothing has been stored yet (web
    /// `localStorage.getItem(...) == null` → fall back to the catalog defaults).
    func load() -> [String]?
    /// Persists the new favorite set (web `localStorage.setItem`).
    func save(_ ids: [String])
}

/// `UserDefaults`-backed favorites store keyed per vehicle, matching the web key
/// shape `teslasync-cmd-favorites-{vehicleID}`.
@MainActor
public final class UserDefaultsVehicleCommandFavoritesStore: VehicleCommandFavoritesStore {
    private let defaults: UserDefaults
    private let key: String

    public init(vehicleID: Int, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        key = "teslasync-cmd-favorites-\(vehicleID)"
    }

    public func load() -> [String]? {
        defaults.array(forKey: key) as? [String]
    }

    public func save(_ ids: [String]) {
        defaults.set(ids, forKey: key)
    }
}

/// In-memory favorites store for previews + tests.
@MainActor
public final class InMemoryVehicleCommandFavoritesStore: VehicleCommandFavoritesStore {
    private var stored: [String]?
    public private(set) var saveCount = 0

    public init(initial: [String]? = nil) {
        stored = initial
    }

    public func load() -> [String]? {
        stored
    }

    public func save(_ ids: [String]) {
        stored = ids
        saveCount += 1
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// Deterministic command source for previews + unit/UI tests. Emits the optional
/// initial snapshot on `start`, records dispatches, and can auto-report a canned
/// result for each `execute` (or be driven manually via `push` / `report`).
@MainActor
public final class InMemoryVehicleCommandSource: VehicleCommandSource {
    public var onUpdate: (@MainActor (VCCUpdate) -> Void)?
    public var onCommandResult: (@MainActor (VCCCommandResult) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var executed: [VCCInvocation] = []

    private let initial: VCCUpdate?
    private let autoResult: Bool

    public init(initial: VCCUpdate? = nil, autoResult: Bool = false) {
        self.initial = initial
        self.autoResult = autoResult
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

    public func execute(_ invocation: VCCInvocation) {
        executed.append(invocation)
        if autoResult {
            onCommandResult?(
                VCCCommandResult(commandID: invocation.commandID, success: true, message: "OK")
            )
        }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: VCCUpdate) {
        onUpdate?(update)
    }

    /// Reports a command outcome to the bound model (test affordance).
    public func report(_ result: VCCCommandResult) {
        onCommandResult?(result)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the view
/// holds no hardcoded literals. Keys live in the "VehicleCommandCenter" table,
/// folded into the app `Localizable.xcstrings` master catalog at integration time;
/// the per-surface table keeps this prompt owning its own strings without editing
/// the shared catalog. Foundation-only so the model + adapter can resolve copy; the
/// SwiftUI `text(_:_:)` helper lives in the view file.
public enum VehicleCommandCenterStrings {
    public static let table = "VehicleCommandCenter"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a format string then substitutes positional arguments (web template
    /// literals like `` `${t('Command sent to')} ${name}` ``).
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        let template = string(key, fallback)
        return String(format: template, locale: Locale.current, arguments: args)
    }
}
