import SwiftUI

/// macOS / iPad menu-bar commands: quick navigation shortcuts and a Navigate menu
/// mirroring the sidebar groups. Bound to the app's route selection.
public struct AppCommands: Commands {
    @Binding private var selection: AppRoute?

    public init(selection: Binding<AppRoute?>) {
        _selection = selection
    }

    public var body: some Commands {
        CommandGroup(after: .sidebar) {
            Button("menu.goDashboard") { selection = .dashboard }
                .keyboardShortcut("1", modifiers: .command)
            Button("menu.goVehicles") { selection = .vehicles }
                .keyboardShortcut("2", modifiers: .command)
            Button("menu.goCharging") { selection = .charging }
                .keyboardShortcut("3", modifiers: .command)
            Button("menu.goAnalytics") { selection = .analytics }
                .keyboardShortcut("4", modifiers: .command)
        }

        CommandMenu("menu.navigate") {
            ForEach(AppRouteGroup.allCases) { group in
                Section(group.titleKey) {
                    ForEach(AppRoute.routes(in: group)) { route in
                        Button(route.titleKey) { selection = route }
                    }
                }
            }
        }
    }
}
