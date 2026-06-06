import SwiftUI

/// One tab in a `TSTabs` bar.
public struct TSTab<Value: Hashable>: Identifiable {
    public let value: Value
    public let title: LocalizedStringKey
    public let systemImage: String?
    public var id: Value {
        value
    }

    public init(_ value: Value, _ title: LocalizedStringKey, systemImage: String? = nil) {
        self.value = value
        self.title = title
        self.systemImage = systemImage
    }
}

/// Segmented tab bar (web `Tabs`) — a token-styled selection control.
///
/// Horizontally scrollable so it stays usable on compact iPhone widths; each tab
/// is a real button carrying `.isSelected` for VoiceOver.
public struct TSTabs<Value: Hashable>: View {
    @Binding private var selection: Value
    private let tabs: [TSTab<Value>]

    public init(selection: Binding<Value>, tabs: [TSTab<Value>]) {
        _selection = selection
        self.tabs = tabs
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(tabs) { tab in
                    tabButton(tab)
                }
            }
            .padding(TSSpacing.xs)
        }
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }

    @ViewBuilder
    private func tabButton(_ tab: TSTab<Value>) -> some View {
        let isSelected = tab.value == selection
        Button {
            selection = tab.value
        } label: {
            HStack(spacing: TSSpacing.xs) {
                if let systemImage = tab.systemImage {
                    Image(systemName: systemImage)
                }
                Text(tab.title)
            }
            .font(Font.TS.bodySm)
            .fontWeight(isSelected ? .semibold : .regular)
            .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(
                isSelected ? Color.TS.accent : Color.clear,
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
