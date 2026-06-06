import SwiftUI

/// Frosted panel surface (web `GlassPanel`) using a native material.
public struct TSGlassPanel<Content: View>: View {
    private let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        content()
            .padding(TSSpacing.lg)
            .tsGlassPanel()
    }
}

/// Solid elevated card surface (web `Card`).
public struct TSCard<Content: View>: View {
    private let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        content()
            .padding(TSSpacing.lg)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

/// Card header with a title, optional subtitle, and optional trailing accessory.
public struct TSCardHeader<Trailing: View>: View {
    private let title: LocalizedStringKey
    private let subtitle: LocalizedStringKey?
    private let trailing: () -> Trailing

    public init(
        _ title: LocalizedStringKey,
        subtitle: LocalizedStringKey? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPanelTitle(title)
                if let subtitle {
                    TSCaption(subtitle)
                }
            }
            Spacer(minLength: TSSpacing.md)
            trailing()
        }
    }
}

public extension TSCardHeader where Trailing == EmptyView {
    /// Header with no trailing accessory.
    init(_ title: LocalizedStringKey, subtitle: LocalizedStringKey? = nil) {
        self.init(title, subtitle: subtitle) { EmptyView() }
    }
}

/// Card footer: a top divider with trailing-aligned content (actions).
public struct TSCardFooter<Content: View>: View {
    private let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                content()
            }
        }
    }
}

#if DEBUG
    #Preview("Cards") {
        VStack(spacing: TSSpacing.lg) {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSCardHeader("card.title", subtitle: "card.subtitle") {
                        TSBadge("card.badge", tone: .info)
                    }
                    TSText("card.body")
                    TSCardFooter {
                        TSButton("card.action", size: .small) {}
                    }
                }
            }
            TSGlassPanel {
                TSText("panel.body")
            }
        }
        .padding()
    }
#endif
