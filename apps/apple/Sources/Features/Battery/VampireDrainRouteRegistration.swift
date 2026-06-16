import SwiftUI

/// Registers the native Vampire Drain surface for the `.vampireDrain` route so the app
/// shell's route host renders it. The web routes `/charging/vampire-drain` (canonical) and
/// `/vampire-drain` resolve to `.vampireDrain` through `AppRouteParser` (the alias +
/// `pathSegment`), so registering here makes the page reachable + deep-linkable. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor
/// here and captured, so the escaping registry closure never constructs an isolated type.
public enum VampireDrainRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any VampireDrainDataSource = SampleVampireDrainDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = VampireDrainPageModel(dataSource: dataSource)
        registry.register(.vampireDrain) {
            VampireDrainPage(model: model)
        }
        return registry
    }
}
