//
//  CommandPalette.Runner.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The activation seam the ``CommandPaletteModel`` routes a chosen row out through — the native peer of the
//  web action callbacks (`go` → `useNavigate`, `executeCommand` → `useVehicleCommand`, `switchActiveVehicle`
//  → `setVehicleId`, `runRegistryCommand` → `cmd.invoke`, the search-hit `go(hit.url)`). Kept apart from the
//  source seam (CommandPalette.Seams.swift) for the SwiftLint file-length budget. The view never performs a
//  side effect itself — it hands the model a ``PaletteAction``, and the model dispatches here. No networking
//  lives in the view; the production runner is implemented over the shared command + navigation services.
//

import Foundation
import OSLog

// MARK: - Activation seam (P1/S8 write side — web action callbacks)

/// The activation seam the model dispatches a row's ``PaletteAction`` through. The production app implements
/// it over the shared vehicle-command service + the navigation router + the selected-vehicle store + the
/// registry; previews and tests use ``InMemoryCommandPaletteRunner``.
@MainActor
public protocol CommandPaletteRunner: AnyObject {
    /// Navigate to a route (web `useNavigate()(path)`).
    func navigate(to path: String)
    /// Run a vehicle command against a vehicle (web `useVehicleCommand().mutate`).
    func runVehicleCommand(_ command: String, vehicleID: Int)
    /// Switch the active vehicle (web `setVehicleId`).
    func switchVehicle(id: Int)
    /// Invoke a static registry command by id (web `cmd.invoke()`).
    func runRegistry(id: String)
    /// Open a server search result by url (web search-hit `go(hit.url)`).
    func openSearchResult(url: String)
}

// MARK: - Logging default

/// `os.Logger`-backed default that records each activation without performing it — a safe production fallback
/// before the host wires the real services, and a deterministic stand-in for SwiftUI previews. Identifiers are
/// logged at `.public`; no PII (query text, VINs) is emitted.
public final class LoggingCommandPaletteRunner: CommandPaletteRunner {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "command-palette") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func navigate(to path: String) {
        logger.info("palette.navigate path=\(path, privacy: .public)")
    }

    public func runVehicleCommand(_ command: String, vehicleID: Int) {
        logger.info("palette.command command=\(command, privacy: .public) vehicle=\(vehicleID, privacy: .public)")
    }

    public func switchVehicle(id: Int) {
        logger.info("palette.switch vehicle=\(id, privacy: .public)")
    }

    public func runRegistry(id: String) {
        logger.info("palette.registry id=\(id, privacy: .public)")
    }

    public func openSearchResult(url: String) {
        logger.info("palette.searchResult url=\(url, privacy: .public)")
    }
}

// MARK: - In-memory spy (previews + tests)

/// A recording runner for previews + tests — captures every dispatched activation so a test can assert the
/// model routed the right ``PaletteAction`` without touching the network or navigation.
@MainActor
public final class InMemoryCommandPaletteRunner: CommandPaletteRunner {
    /// One captured activation, in dispatch order.
    public enum Activation: Equatable {
        case navigate(String)
        case command(String, Int)
        case switchVehicle(Int)
        case registry(String)
        case searchResult(String)
    }

    public private(set) var activations: [Activation] = []

    public init() {}

    public func navigate(to path: String) {
        activations.append(.navigate(path))
    }

    public func runVehicleCommand(_ command: String, vehicleID: Int) {
        activations.append(.command(command, vehicleID))
    }

    public func switchVehicle(id: Int) {
        activations.append(.switchVehicle(id))
    }

    public func runRegistry(id: String) {
        activations.append(.registry(id))
    }

    public func openSearchResult(url: String) {
        activations.append(.searchResult(url))
    }
}
