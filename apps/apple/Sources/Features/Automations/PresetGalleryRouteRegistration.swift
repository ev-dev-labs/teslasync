import SwiftUI

/// Navigation registration for the **unrouted** `PresetGallery` parity unit.
///
/// The web source is `(unrouted)` — it is the preset-template grid the `/automations` page renders
/// inline inside its quick-start disclosure, not a standalone route. So rather than claim a
/// top-level `AppRoute`, this exposes the screen as a typed `NavigationDestination` (a deep-link
/// value) any `NavigationStack` can host: the `AutomationsList` route adopts
/// `.presetGalleryDestination()` and pushes a `PresetGalleryLink` to surface the full gallery. The
/// model is built inside the destination from the seam's data source (default = the local sample),
/// keeping the escaping closure free of business logic.
public struct PresetGalleryLink: Hashable, Sendable {
    /// Web `category` prop — forwarded to `useAutomationPresets(category)`.
    public var category: String?

    public init(category: String? = nil) {
        self.category = category
    }
}

public extension View {
    /// Registers the `PresetGallery` screen as a `NavigationDestination` for a `PresetGalleryLink`
    /// value, so any host stack can deep-link into it.
    func presetGalleryDestination(
        dataSource: @escaping @Sendable () -> any PresetGalleryDataSource = {
            SamplePresetGalleryDataSource()
        },
        onInstall: @escaping @Sendable (PresetGalleryItem) -> Void = { _ in }
    ) -> some View {
        navigationDestination(for: PresetGalleryLink.self) { link in
            PresetGalleryPage(
                model: PresetGalleryModel(category: link.category, dataSource: dataSource()),
                onInstall: onInstall
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column or the inline preset disclosure) without
/// constructing the model.
public enum PresetGalleryRouteRegistration {
    /// Builds the screen with the given category + data source (default = local sample).
    @MainActor
    public static func make(
        category: String? = nil,
        dataSource: any PresetGalleryDataSource = SamplePresetGalleryDataSource(),
        onInstall: @escaping (PresetGalleryItem) -> Void = { _ in }
    ) -> PresetGalleryPage {
        PresetGalleryPage(
            model: PresetGalleryModel(category: category, dataSource: dataSource),
            onInstall: onInstall
        )
    }
}
