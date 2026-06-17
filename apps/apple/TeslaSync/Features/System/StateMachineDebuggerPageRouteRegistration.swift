//
//  StateMachineDebuggerPageRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Navigation
//
//  Navigation registration for the `StateMachineDebuggerPage` parity unit. The web route
//  `/state-debugger` is modeled natively as a typed `NavigationDestination` value: a host stack
//  adopts `.stateMachineDebuggerDestination()` and pushes a `StateMachineDebuggerLink()` to open
//  the screen, so the page is reachable + deep-linkable on the macOS / iPad detail column and the
//  iPhone stack (ADR-002/006). The global `AppRoute` enum (Sources/App) is outside this prompt's
//  allowed-files scope, so — following the accepted sibling precedent (CommandHistory / Geofences
//  / TirePressure) — the page is delivered as a NavigationStack-ready `View` plus this typed
//  destination, rather than editing the shared route host.
//

import SwiftUI

/// The typed deep-link value for the FSM debugger screen (web `/state-debugger`).
public struct StateMachineDebuggerLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `StateMachineDebuggerPage` as the `NavigationDestination` for a
    /// `StateMachineDebuggerLink`, so any host stack can deep-link into the screen
    /// (web `/state-debugger`).
    func stateMachineDebuggerDestination() -> some View {
        navigationDestination(for: StateMachineDebuggerLink.self) { _ in
            StateMachineDebuggerPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model.
public enum StateMachineDebuggerRouteRegistration {
    /// Builds the FSM debugger screen (web `/state-debugger`).
    ///
    /// - Parameter dataSource: the FSM data source (defaults to the sample-backed seed).
    @MainActor
    public static func make(
        dataSource: any StateMachineDataSource = SampleStateMachineDataSource()
    ) -> StateMachineDebuggerPage {
        StateMachineDebuggerPage(model: StateMachineDebuggerPageModel(dataSource: dataSource))
    }
}
