import SwiftUI

/// Expandable section (web `Accordion`) over the native `DisclosureGroup`.
public struct TSAccordion<Content: View>: View {
    private let title: LocalizedStringKey
    @State private var isExpanded: Bool
    private let content: () -> Content

    public init(
        _ title: LocalizedStringKey,
        initiallyExpanded: Bool = false,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        _isExpanded = State(initialValue: initiallyExpanded)
        self.content = content
    }

    public var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            content().padding(.top, TSSpacing.sm)
        } label: {
            TSPanelTitle(title)
        }
        .tint(Color.TS.accent)
        .padding(TSSpacing.md)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// Page navigation control (web `Pagination`): prev/next + position readout.
public struct TSPagination: View {
    @Binding private var currentPage: Int
    private let pageCount: Int

    public init(currentPage: Binding<Int>, pageCount: Int) {
        _currentPage = currentPage
        self.pageCount = pageCount
    }

    private var canGoBack: Bool {
        currentPage > 0
    }

    private var canGoForward: Bool {
        currentPage < pageCount - 1
    }

    public var body: some View {
        HStack(spacing: TSSpacing.md) {
            Button {
                if canGoBack { currentPage -= 1 }
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)
            .disabled(!canGoBack)
            .accessibilityLabel(Text("pagination.previous"))

            TSCode("\(min(currentPage + 1, max(pageCount, 1))) / \(max(pageCount, 1))")

            Button {
                if canGoForward { currentPage += 1 }
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)
            .disabled(!canGoForward)
            .accessibilityLabel(Text("pagination.next"))
        }
        .foregroundStyle(Color.TS.accent)
    }
}

#if DEBUG
    #Preview("Disclosure") {
        VStack(spacing: TSSpacing.lg) {
            TSAccordion("accordion.title", initiallyExpanded: true) {
                TSText("accordion.body")
            }
            TSPagination(currentPage: .constant(1), pageCount: 5)
        }
        .padding()
    }
#endif
