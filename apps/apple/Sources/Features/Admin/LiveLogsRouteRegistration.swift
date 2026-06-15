import SwiftUI

/// Registers the native Live Logs surface for the `.liveLogs` route so the app shell's route
/// host renders it. The web page is unrouted (rendered ad hoc), so it is surfaced here in the
/// System sidebar group and made deep-linkable at `/live-logs` (alias `/admin/live-logs`),
/// keeping it reachable alongside the sibling admin pages. Mirrors `ApiLogsRouteRegistration`:
/// the `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
public enum LiveLogsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        source: any LiveLogsStreaming = SampleLiveLogsSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = LiveLogsPageModel(source: source)
        registry.register(.liveLogs) {
            LiveLogsPage(model: model)
        }
        return registry
    }
}
