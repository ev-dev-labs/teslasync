import SwiftUI

/// Completes the macOS / iPad command menus beyond the navigation set in
/// `AppCommands`: File (Export, Print), View (Refresh), a Vehicle menu, a Commands
/// menu of gated vehicle actions, and Help. The standard New Window / Close /
/// Toggle Sidebar / Window menu are provided by AppKit (see `MenuCommandCatalog`).
public struct AppMenuCommands: Commands {
    @Binding private var selection: AppRoute?
    private let actions: AppCommandActions

    public init(selection: Binding<AppRoute?>, actions: AppCommandActions) {
        _selection = selection
        self.actions = actions
    }

    public var body: some Commands {
        CommandGroup(after: .importExport) {
            Button("menu.file.export") { selection = .sharing }
                .keyboardShortcut("e", modifiers: .command)
            Button("menu.file.print") { actions.triggerPrint() }
                .keyboardShortcut("p", modifiers: .command)
        }

        CommandGroup(after: .sidebar) {
            Divider()
            Button("menu.view.refresh") { actions.refresh() }
                .keyboardShortcut("r", modifiers: .command)
        }

        CommandMenu("menu.category.vehicle") {
            Button("menu.vehicle.refreshState") {
                actions.refresh()
                selection = .vehicles
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])
            Divider()
            Button("menu.vehicle.charging") { selection = .charging }
            Button("menu.vehicle.liveMap") { selection = .maps }
            Button("menu.vehicle.energy") { selection = .energy }
        }

        CommandMenu("menu.category.commands") {
            ForEach(MenuCommandCatalog.menuCommandKinds, id: \.self) { kind in
                commandButton(kind)
            }
        }

        CommandGroup(replacing: .help) {
            Button("menu.help.guide") { actions.helpSheetVisible = true }
            Button("menu.help.shortcuts") { actions.shortcutsSheetVisible = true }
                .keyboardShortcut("/", modifiers: .command)
        }
    }

    @ViewBuilder
    private func commandButton(_ kind: VehicleCommandKind) -> some View {
        let button = Button {
            actions.requestCommand(kind)
        } label: {
            Label {
                Text(kind.titleResource)
            } icon: {
                Image(systemName: kind.systemImage)
            }
        }
        .disabled(!actions.isAuthenticated)

        if kind == .wake {
            button.keyboardShortcut("w", modifiers: [.command, .shift])
        } else {
            button
        }
    }
}
