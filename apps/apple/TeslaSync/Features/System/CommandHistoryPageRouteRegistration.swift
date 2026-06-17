//
//  CommandHistoryPageRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · system/CommandHistory (Apple) — Navigation
//
//  Navigation registration for the `CommandHistoryPage` parity unit. The web route
//  `/command-history` is modeled natively as a typed `NavigationDestination` value: a host
//  stack adopts `.commandHistoryDestination(onOpenCommands:)` and pushes a
//  `CommandHistoryLink()` to open the screen, so the page is reachable + deep-linkable on
//  the macOS / iPad detail column and the iPhone stack (ADR-002/006). The global `AppRoute`
//  enum (Sources/App) is outside this prompt's allowed-files scope, so — following the
//  accepted sibling precedent (Geofences / TirePressure / GuardMode) — the page is delivered
//  as a NavigationStack-ready `View` plus this typed destination, rather than editing the
//  shared route host.
//

import SwiftUI

/// The typed deep-link value for the command-history screen (web `/command-history`).
public struct CommandHistoryLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `CommandHistoryPage` as the `NavigationDestination` for a
    /// `CommandHistoryLink`, so any host stack can deep-link into the screen
    /// (web `/command-history`).
    ///
    /// - Parameter onOpenCommands: navigation seam for the page's "back to Commands" link
    ///   (web `/commands`), wired by the host; defaults to a no-op for standalone use.
    func commandHistoryDestination(onOpenCommands: @escaping () -> Void = {}) -> some View {
        navigationDestination(for: CommandHistoryLink.self) { _ in
            CommandHistoryPage(onOpenCommands: onOpenCommands)
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model.
public enum CommandHistoryRouteRegistration {
    /// Builds the command-history screen (web `/command-history`).
    ///
    /// - Parameters:
    ///   - dataSource: the command-history source (defaults to the sample-backed seed).
    ///   - onOpenCommands: navigation seam for the "back to Commands" link.
    @MainActor
    public static func make(
        dataSource: any CommandHistoryDataSource = SampleCommandHistoryDataSource(),
        onOpenCommands: @escaping () -> Void = {}
    ) -> CommandHistoryPage {
        CommandHistoryPage(
            model: CommandHistoryPageModel(dataSource: dataSource),
            onOpenCommands: onOpenCommands
        )
    }
}
