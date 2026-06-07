import SwiftUI

/// A reference sheet of every TeslaSync keyboard shortcut, grouped by menu and
/// built straight from `MenuCommandCatalog`, so it can never drift from the real
/// menus. Presented from Help ▸ Keyboard Shortcuts.
public struct KeyboardShortcutsView: View {
    private let onClose: () -> Void

    public init(onClose: @escaping () -> Void = {}) {
        self.onClose = onClose
    }

    private var categoriesWithShortcuts: [AppMenuCategory] {
        AppMenuCategory.allCases.filter { category in
            MenuCommandCatalog.commands(in: category).contains { $0.shortcut != nil }
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack {
                TSSectionTitle("menu.help.shortcuts")
                Spacer()
                TSButton("action.close", variant: .ghost, size: .small, action: onClose)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ForEach(categoriesWithShortcuts) { category in
                        section(for: category)
                    }
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(minWidth: 360, minHeight: 420)
        .background(Color.TS.bg)
    }

    @ViewBuilder
    private func section(for category: AppMenuCategory) -> some View {
        let rows = MenuCommandCatalog.commands(in: category).filter { $0.shortcut != nil }
        if !rows.isEmpty {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSPanelTitle(LocalizedStringKey(category.titleKey))
                    ForEach(rows) { spec in
                        HStack {
                            Text(LocalizedStringKey(spec.titleKey))
                                .font(Font.TS.body)
                                .foregroundStyle(Color.TS.textPrimary)
                            Spacer()
                            if let shortcut = spec.shortcut {
                                TSCode(shortcut.displaySymbols)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

/// Help landing sheet linking to the user guide and the keyboard-shortcut
/// reference. Presented from Help ▸ TeslaSync Help.
public struct MenuHelpView: View {
    private let onShowShortcuts: () -> Void
    private let onClose: () -> Void

    public init(onShowShortcuts: @escaping () -> Void = {}, onClose: @escaping () -> Void = {}) {
        self.onShowShortcuts = onShowShortcuts
        self.onClose = onClose
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                TSSectionTitle("menu.help.guide")
                Spacer()
                TSButton("action.close", variant: .ghost, size: .small, action: onClose)
            }
            TSText("menu.help.body")
            TSButton("menu.help.shortcuts", variant: .secondary, action: onShowShortcuts)
            Spacer()
        }
        .padding(TSSpacing.lg)
        .frame(minWidth: 320, minHeight: 220)
        .background(Color.TS.bg)
    }
}
