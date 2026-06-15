import SwiftUI

/// Registers the native Redis Signal Viewer surface for the `.redisSignals` route so the app
/// shell's route host renders it (web `/redis-signals`). Mirrors the peer admin route
/// registrations (`LiveSignalInspectorRouteRegistration` / `DevToolsRouteRegistration`): the
/// `@Observable` model is built on the main actor here and captured, so the escaping registry
/// closure never constructs an isolated type. The default seams seed sample data; production
/// injects the KMP-backed vehicles feed + dev-tools client at composition time (ADR-004).
public enum RedisSignalViewerRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        vehicleSource: any RedisSignalViewerVehicleSource = SampleRedisSignalViewerVehicleSource(),
        store: any RedisSignalStore = SampleRedisSignalStore()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = RedisSignalViewerPageModel(vehicleSource: vehicleSource, store: store)
        registry.register(.redisSignals) {
            RedisSignalViewerPage(model: model)
        }
        return registry
    }
}
