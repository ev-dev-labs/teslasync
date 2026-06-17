//
//  LiveSignalMonitorRouteRegistration.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  Registers the native Live Signal Monitor on the `.liveMonitor` route so the
//  app shell's route host renders it (web `/live-monitor`). `AppRouteParser`
//  resolves the web path `/live-monitor` to `.liveMonitor` via its kebab-cased
//  `pathSegment`, making the page reachable and deep-linkable.
//
//  Mirrors `SignalsWorkspaceRouteRegistration`: the `@Observable` model is built
//  on the main actor here and captured, so the escaping registry closure never
//  constructs an isolated type off the main actor.
//

import SwiftUI

public enum LiveSignalMonitorRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        model: LiveSignalMonitorPageModel = LiveSignalMonitorPageModel()
    ) -> AppRouteHostRegistry {
        var registry = base
        registry.register(.liveMonitor) {
            LiveSignalMonitorPage(model: model)
        }
        return registry
    }
}
