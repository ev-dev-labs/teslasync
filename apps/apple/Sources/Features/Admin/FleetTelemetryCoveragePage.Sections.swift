import SwiftUI

/// One protomodel-Category section for `FleetTelemetryCoveragePage` (web
/// `CategorySection`): a `GlassPanel` carrying the category name, its routed-field
/// count, the per-destination count chips, and either the per-field routing table or
/// the "no fields match the filter" note. Kept as a dedicated surface (mirroring
/// `DiskForecastPage.Table`) so the page file stays focused on chrome + states.
struct FleetTelemetryCategorySection: View {
    let category: FleetTelemetryCategoryCoverage
    /// The fields already filtered by the page model (web per-category `filtered`).
    let fields: [FleetTelemetryFieldCoverage]
    /// The category's destination counts, sorted desc (web `destEntries`).
    let destinations: [(destination: String, count: Int)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                sectionHeader
                if fields.isEmpty {
                    Text("coverage.category.noMatch")
                        .font(Font.TS.bodySm)
                        .italic()
                        .foregroundStyle(Color.TS.textMuted)
                } else {
                    FleetTelemetryFieldTable(fields: fields, emptyMessage: "coverage.category.empty")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: category.category))
    }

    private var sectionHeader: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: category.category)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: Self.totalFieldsText(category.totalFields))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            if !destinations.isEmpty {
                CoverageFlowLayout(spacing: TSSpacing.xs) {
                    ForEach(destinations, id: \.destination) { entry in
                        CoverageCountChip(label: entry.destination, count: entry.count, tone: .neutral)
                    }
                }
            }
        }
    }

    /// Resolves `coverage.category.totalFields` ("%lld routed fields") with the count.
    static func totalFieldsText(_ count: Int) -> String {
        String(format: String(localized: "coverage.category.totalFields"), count)
    }
}

/// The adaptive per-field routing table (web `DataTable`): a columnar grid on macOS /
/// iPad regular width and per-field cards on compact iPhone width. Reproduces the five
/// web columns — Field, Destination, Column, Dual write, Subscribed. The `emptyMessage`
/// mirrors the web `DataTable emptyMessage` (shown only if the rows are empty).
struct FleetTelemetryFieldTable: View {
    let fields: [FleetTelemetryFieldCoverage]
    let emptyMessage: LocalizedStringKey

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        if fields.isEmpty {
            Text(emptyMessage)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(fields, id: \.field) { fieldCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("coverage.col.field")
                header("coverage.col.destination")
                header("coverage.col.column")
                header("coverage.col.dualWrite")
                header("coverage.col.subscribed")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(5)
            ForEach(fields, id: \.field) { field in
                GridRow {
                    fieldNameText(field)
                    CoverageChip(text: field.destination, tone: .info)
                    columnText(field)
                    dualWriteBadge(field)
                    subscribedBadge(field)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(5)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Compact (iPhone) cards

    private func fieldCard(_ field: FleetTelemetryFieldCoverage) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    fieldNameText(field)
                    Spacer(minLength: TSSpacing.sm)
                    subscribedBadge(field)
                }
                labeledRow("coverage.col.destination") {
                    CoverageChip(text: field.destination, tone: .info)
                }
                labeledRow("coverage.col.column") {
                    columnText(field)
                }
                labeledRow("coverage.col.dualWrite") {
                    dualWriteBadge(field)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func labeledRow(_ label: LocalizedStringKey, @ViewBuilder _ value: () -> some View) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            value()
        }
    }

    // MARK: - Shared cells

    private func fieldNameText(_ field: FleetTelemetryFieldCoverage) -> some View {
        Text(verbatim: field.field)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .textSelection(.enabled)
    }

    @ViewBuilder
    private func columnText(_ field: FleetTelemetryFieldCoverage) -> some View {
        if let column = field.column, !column.isEmpty {
            Text(verbatim: column)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .textSelection(.enabled)
        } else {
            Text(verbatim: FleetTelemetryCoverageFormat.emptyValue)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    @ViewBuilder
    private func dualWriteBadge(_ field: FleetTelemetryFieldCoverage) -> some View {
        if field.alsoSignalLog {
            TSBadge("coverage.dualWrite.yes", tone: .warning)
        } else {
            Text(verbatim: FleetTelemetryCoverageFormat.emptyValue)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func subscribedBadge(_ field: FleetTelemetryFieldCoverage) -> some View {
        field.subscribed
            ? TSBadge("coverage.subscribed.yes", tone: .success)
            : TSBadge("coverage.subscribed.no", tone: .neutral)
    }
}

// MARK: - Chips

/// A compact tinted chip rendering caller-provided verbatim text (web `Badge` with a
/// dynamic value). Used where the content is data (destination names / counts) rather
/// than a localizable key, so it mirrors `TSBadge`'s styling without a `LocalizedStringKey`.
struct CoverageChip: View {
    let text: String
    var tone: TSTone = .neutral

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

/// A "destination: count" chip (web `{dest}: {fmtInt(count)}` badge). The count is
/// formatted at the display boundary via `FleetTelemetryCoverageFormat.int`.
struct CoverageCountChip: View {
    let label: String
    let count: Int
    var tone: TSTone = .neutral

    var body: some View {
        CoverageChip(text: "\(label): \(FleetTelemetryCoverageFormat.int(count))", tone: tone)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: "\(label) \(count)"))
    }
}

// MARK: - Flow layout

/// A simple wrapping flow layout for the destination chips (web `flex flex-wrap`).
/// Lays subviews left-to-right, wrapping to a new row when the next subview would
/// overflow the proposed width. Native `Layout` (iOS 16+/macOS 13+), so no WKWebView.
struct CoverageFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var maxRowWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                maxRowWidth = max(maxRowWidth, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        maxRowWidth = max(maxRowWidth, rowWidth)
        let width = proposal.width ?? maxRowWidth
        return CGSize(width: width, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var positionX = bounds.minX
        var positionY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if positionX > bounds.minX, positionX + size.width > bounds.maxX {
                positionX = bounds.minX
                positionY += rowHeight + spacing
                rowHeight = 0
            }
            let origin = CGPoint(x: positionX, y: positionY)
            subview.place(at: origin, anchor: .topLeading, proposal: ProposedViewSize(size))
            positionX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
