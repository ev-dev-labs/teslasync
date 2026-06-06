import Charts
import SwiftUI

/// One row in a `TSChartTooltip`.
public struct TSTooltipRow: Identifiable {
    public let id: String
    public let label: LocalizedStringKey
    public let value: String
    public let colorIndex: Int

    public init(id: String, label: LocalizedStringKey, value: String, colorIndex: Int = 0) {
        self.id = id
        self.label = label
        self.value = value
        self.colorIndex = colorIndex
    }
}

/// Floating value readout (web `ChartTooltip`) for use in a `.chartOverlay`.
public struct TSChartTooltip: View {
    private let title: LocalizedStringKey
    private let rows: [TSTooltipRow]

    public init(title: LocalizedStringKey, rows: [TSTooltipRow]) {
        self.title = title
        self.rows = rows
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption(title)
            ForEach(rows) { row in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: row.colorIndex))
                        .frame(width: 7, height: 7)
                    Text(row.label).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    TSCode(row.value)
                }
            }
        }
        .padding(TSSpacing.sm)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// A vertical annotation/marker at an x position.
public struct TSAnnotationLine: Identifiable {
    public let id: String
    public let xValue: Double
    public let label: LocalizedStringKey
    public let colorIndex: Int

    public init(id: String, x: Double, label: LocalizedStringKey, colorIndex: Int = 3) {
        self.id = id
        xValue = x
        self.label = label
        self.colorIndex = colorIndex
    }
}

/// Dashed "now"/event marker to embed inside a `Chart { … }` (web `TimeMarker`).
@ChartContentBuilder
public func tsTimeMarker(at xValue: Double, label: LocalizedStringKey) -> some ChartContent {
    RuleMark(x: .value("marker", xValue))
        .foregroundStyle(Color.TS.textMuted)
        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
        .annotation(position: .top, alignment: .leading) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
}

/// Annotation rule lines to embed inside a `Chart { … }` (web `AnnotationLines`).
@ChartContentBuilder
public func tsAnnotationLines(_ lines: [TSAnnotationLine]) -> some ChartContent {
    ForEach(lines) { line in
        RuleMark(x: .value("annotation", line.xValue))
            .foregroundStyle(TSChartPalette.color(at: line.colorIndex).opacity(0.8))
            .lineStyle(StrokeStyle(lineWidth: 1.5))
            .annotation(position: .top, alignment: .leading) {
                Text(line.label).font(Font.TS.caption)
                    .foregroundStyle(TSChartPalette.color(at: line.colorIndex))
            }
    }
}

/// Time-window selector (web `ChartBrush`): an overview sparkline plus an
/// accessible range slider that drives the visible x-window bindings.
public struct TSChartBrush: View {
    private let values: [Double]
    @Binding private var lowerX: Double
    @Binding private var upperX: Double
    private let domain: ClosedRange<Double>

    public init(
        values: [Double],
        lowerX: Binding<Double>,
        upperX: Binding<Double>,
        in domain: ClosedRange<Double>
    ) {
        self.values = values
        _lowerX = lowerX
        _upperX = upperX
        self.domain = domain
    }

    public var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSparkline(values: values)
            TSRangeSlider("chart.window", lowerValue: $lowerX, upperValue: $upperX, in: domain)
        }
    }
}

/// Inline form to add an annotation at a position (web `AddAnnotationPopover`).
public struct TSAddAnnotationPopover: View {
    @Binding private var isPresented: Bool
    private let xValue: Double
    private let onAdd: (String, Double) -> Void
    @State private var note = ""

    public init(isPresented: Binding<Bool>, xValue: Double, onAdd: @escaping (String, Double) -> Void) {
        _isPresented = isPresented
        self.xValue = xValue
        self.onAdd = onAdd
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPanelTitle("annotation.add")
            TSTextField("annotation.note", text: $note)
            HStack {
                Spacer()
                TSButton("action.cancel", variant: .secondary, size: .small) { isPresented = false }
                TSButton("action.add", size: .small) {
                    onAdd(note, xValue)
                    isPresented = false
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(minWidth: 260)
    }
}

/// List of annotations with delete (web `AnnotationList`).
public struct TSAnnotationList: View {
    private let annotations: [TSAnnotationLine]
    private let onDelete: (TSAnnotationLine) -> Void

    public init(annotations: [TSAnnotationLine], onDelete: @escaping (TSAnnotationLine) -> Void) {
        self.annotations = annotations
        self.onDelete = onDelete
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(annotations) { annotation in
                HStack(spacing: TSSpacing.sm) {
                    Circle()
                        .fill(TSChartPalette.color(at: annotation.colorIndex))
                        .frame(width: 8, height: 8)
                    Text(annotation.label).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                    Spacer()
                    TSCode(TSChartFormat.axisLabel(annotation.xValue))
                    Button {
                        onDelete(annotation)
                    } label: {
                        Image(systemName: "trash").foregroundStyle(Color.TS.statusDanger)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("action.delete"))
                }
            }
        }
    }
}
