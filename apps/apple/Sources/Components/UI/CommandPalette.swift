import SwiftUI

/// A command for `TSCommandPalette`. `searchText` is the plain, lowercase-able
/// string used for filtering (the localized `title` can't be matched directly).
public struct TSCommand: Identifiable {
    public let id: String
    public let title: LocalizedStringKey
    public let searchText: String
    public let systemImage: String?
    public let isEnabled: Bool
    public let action: () -> Void

    public init(
        id: String,
        title: LocalizedStringKey,
        searchText: String,
        systemImage: String? = nil,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) {
        self.id = id
        self.title = title
        self.searchText = searchText
        self.systemImage = systemImage
        self.isEnabled = isEnabled
        self.action = action
    }
}

/// Pure command filtering (substring, case-insensitive) — unit tested.
public enum TSCommandFilter {
    public static func filter(_ commands: [TSCommand], query: String) -> [TSCommand] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return commands }
        return commands.filter { $0.searchText.lowercased().contains(needle) }
    }
}

/// Pure selection-index movement (clamped) — unit tested.
public enum TSCommandNavigation {
    public static func move(_ index: Int, by delta: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(index + delta, 0), count - 1)
    }
}

/// Filterable command launcher (web `CommandPalette`). Keyboard support is kept
/// conservative: arrows move the selection, Return runs it, Escape dismisses.
public struct TSCommandPalette: View {
    private let commands: [TSCommand]
    @Binding private var isPresented: Bool
    @State private var query = ""
    @State private var selectedIndex = 0
    @FocusState private var searchFocused: Bool

    public init(commands: [TSCommand], isPresented: Binding<Bool>) {
        self.commands = commands
        _isPresented = isPresented
    }

    private var results: [TSCommand] {
        TSCommandFilter.filter(commands, query: query)
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color.TS.textMuted)
                TextField("command.search", text: $query)
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .focused($searchFocused)
                    .onSubmit(runSelected)
            }
            .padding(TSSpacing.md)
            Divider().overlay(Color.TS.border)

            if results.isEmpty {
                TSText("command.empty")
                    .padding(TSSpacing.lg)
            } else {
                resultsList
            }
        }
        .frame(minWidth: 280, maxWidth: 480)
        .background(Color.TS.surface)
        .onAppear { searchFocused = true }
        .onChange(of: query) { selectedIndex = 0 }
        .onKeyPress(.downArrow) {
            selectedIndex = TSCommandNavigation.move(selectedIndex, by: 1, count: results.count)
            return .handled
        }
        .onKeyPress(.upArrow) {
            selectedIndex = TSCommandNavigation.move(selectedIndex, by: -1, count: results.count)
            return .handled
        }
        .onKeyPress(.escape) {
            isPresented = false
            return .handled
        }
    }

    private var resultsList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(Array(results.enumerated()), id: \.element.id) { offset, command in
                    commandRow(command, isSelected: offset == selectedIndex)
                }
            }
        }
        .frame(maxHeight: 320)
    }

    private func commandRow(_ command: TSCommand, isSelected: Bool) -> some View {
        Button {
            run(command)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                if let systemImage = command.systemImage {
                    Image(systemName: systemImage)
                        .foregroundStyle(Color.TS.textSecondary)
                        .frame(width: 20)
                }
                Text(command.title)
                    .font(Font.TS.body)
                    .foregroundStyle(command.isEnabled ? Color.TS.textPrimary : Color.TS.textMuted)
                Spacer()
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(isSelected ? Color.TS.accent.opacity(0.12) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!command.isEnabled)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func runSelected() {
        guard results.indices.contains(selectedIndex) else { return }
        run(results[selectedIndex])
    }

    private func run(_ command: TSCommand) {
        guard command.isEnabled else { return }
        command.action()
        isPresented = false
    }
}

public extension View {
    /// Attaches a native context menu (macOS right-click / iOS long-press).
    func tsContextMenu(@ViewBuilder _ items: @escaping () -> some View) -> some View {
        contextMenu(menuItems: items)
    }
}
