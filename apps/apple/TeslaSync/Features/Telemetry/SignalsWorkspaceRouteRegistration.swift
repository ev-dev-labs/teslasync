import SwiftUI

/// Registers the native Signals workspace for the `.telemetry` route so the app
/// shell's route host renders it (web `/signals`). `AppRouteParser` resolves the
/// web path `/signals` to `.telemetry`, so hosting here makes the workspace
/// reachable and deep-linkable.
///
/// Mirrors `LiveSignalInspectorRouteRegistration`: the `@Observable` model is
/// built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type.
public enum SignalsWorkspaceRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        model: SignalsWorkspacePageModel = SignalsWorkspacePageModel()
    ) -> AppRouteHostRegistry {
        var registry = base
        registry.register(.telemetry) {
            SignalsWorkspacePage(model: model)
        }
        return registry
    }
}
