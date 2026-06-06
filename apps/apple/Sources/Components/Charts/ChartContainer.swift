import SwiftUI

/// Frames a chart with a title, optional export menu, an accessible summary, and
/// a self-contained empty overlay (never hides the panel).
public struct TSChartContainer<Content: View>: View {
    private let title: LocalizedStringKey
    private let summary: LocalizedStringKey?
    private let isEmpty: Bool
    private let csv: String?
    private let content: () -> Content

    public init(
        _ title: LocalizedStringKey,
        summary: LocalizedStringKey? = nil,
        isEmpty: Bool = false,
        csv: String? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.summary = summary
        self.isEmpty = isEmpty
        self.csv = csv
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                TSPanelTitle(title)
                Spacer()
                if let csv {
                    Menu {
                        Button("chart.copyData") { TSClipboard.copy(csv) }
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    .menuStyle(.borderlessButton)
                    .accessibilityLabel(Text("chart.export"))
                }
            }
            if isEmpty {
                emptyOverlay
            } else {
                content()
                    .frame(minHeight: 160)
            }
            if let summary {
                TSCaption(summary)
                    .accessibilityLabel(Text(summary))
            }
        }
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

    private var emptyOverlay: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.xyaxis.line")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
            TSCaption("chart.noData")
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

/// Toggleable legend (web `ChartLegend`): tapping a series hides/shows it.
public struct TSChartLegend: View {
    private let series: [TSChartSeries]
    @Binding private var hidden: Set<String>

    public init(series: [TSChartSeries], hidden: Binding<Set<String>>) {
        self.series = series
        _hidden = hidden
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                ForEach(series) { item in
                    let isHidden = hidden.contains(item.id)
                    Button {
                        hidden = TSChartFormat.toggleHidden(hidden, item.id)
                    } label: {
                        HStack(spacing: TSSpacing.xs) {
                            Circle()
                                .fill(item.color)
                                .frame(width: 8, height: 8)
                                .opacity(isHidden ? 0.3 : 1)
                            Text(item.name)
                                .font(Font.TS.caption)
                                .foregroundStyle(isHidden ? Color.TS.textMuted : Color.TS.textSecondary)
                                .strikethrough(isHidden)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isHidden ? .isButton : [.isButton, .isSelected])
                }
            }
        }
    }
}
