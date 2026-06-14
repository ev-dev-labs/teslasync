import SwiftUI

/// Navigation registration for the **sub-routed** `AutomationBuilder` parity unit.
///
/// The web source lives at `/automations/new`, `/automations/:id/edit`, and `?preset=` — sub-routes
/// the `/automations` hub navigates into, not a standalone top-level `AppRoute`. So (like the
/// sibling `AutomationActivityFeed`) it is exposed as a typed `NavigationDestination`: any host
/// `NavigationStack` adopts `.automationBuilderDestination()` and pushes an `AutomationBuilderLink`
/// to open the create / preset / edit builder. The `@Observable` model is built inside the
/// main-actor destination closure from the injected data-source provider, keeping the escaping
/// closure free of business logic (ADR-004).
public struct AutomationBuilderLink: Hashable, Sendable {
    public var automationID: Int64?
    public var presetID: String?

    public init(automationID: Int64? = nil, presetID: String? = nil) {
        self.automationID = automationID
        self.presetID = presetID
    }

    /// Resolves the entry mode (web `isEdit` / `presetId` branching).
    public var mode: AutomationBuilderMode {
        if let automationID { return .edit(automationID) }
        if let presetID { return .preset(presetID) }
        return .create
    }
}

public extension View {
    /// Registers the `AutomationBuilder` screen as a `NavigationDestination` for an
    /// `AutomationBuilderLink`, so any host stack can deep-link into the create / preset / edit form.
    func automationBuilderDestination(
        dataSource: @escaping @Sendable () -> any AutomationBuilderDataSource = {
            SampleAutomationBuilderDataSource()
        },
        onClose: @escaping () -> Void = {}
    ) -> some View {
        navigationDestination(for: AutomationBuilderLink.self) { link in
            AutomationBuilderPage(
                model: AutomationBuilderPageModel(mode: link.mode, dataSource: dataSource()),
                onClose: onClose
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column) without constructing the model.
public enum AutomationBuilderRouteRegistration {
    /// Builds the builder screen for the given mode + data source (default = the sample double).
    @MainActor
    public static func make(
        mode: AutomationBuilderMode,
        dataSource: any AutomationBuilderDataSource = SampleAutomationBuilderDataSource(),
        onClose: @escaping () -> Void = {}
    ) -> AutomationBuilderPage {
        AutomationBuilderPage(
            model: AutomationBuilderPageModel(mode: mode, dataSource: dataSource),
            onClose: onClose
        )
    }
}
