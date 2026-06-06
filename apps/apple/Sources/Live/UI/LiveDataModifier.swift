import SwiftUI

public extension View {
    /// Binds a `LiveDataStore` to this view's scene/visibility lifecycle: the
    /// store connects only while the scene is active *and* this view is on
    /// screen, and tears the stream down on background or disappearance
    /// (foreground-only live data — never a background channel; ADR-009/013).
    func liveData(_ store: LiveDataStore<some Any, some Sendable>) -> some View {
        modifier(LiveDataTask(store: store))
    }
}

/// The view modifier behind `.liveData`. Translates SwiftUI scene phase + view
/// appearance into the store's two lifecycle inputs.
private struct LiveDataTask<Value, Event: Sendable>: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    let store: LiveDataStore<Value, Event>

    func body(content: Content) -> some View {
        content
            .onAppear {
                store.setScenePhaseActive(scenePhase == .active)
                store.setViewVisible(true)
            }
            .onDisappear {
                store.setViewVisible(false)
            }
            .onChange(of: scenePhase) { _, newPhase in
                store.setScenePhaseActive(newPhase == .active)
            }
    }
}
