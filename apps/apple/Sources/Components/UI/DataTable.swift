import SwiftUI

/// Row density for `TSDataTable`.
public enum TSTableDensity {
    case compact, standard, comfortable

    var rowPadding: CGFloat {
        switch self {
        case .compact: TSSpacing.xs
        case .standard: TSSpacing.sm
        case .comfortable: TSSpacing.md
        }
    }
}

/// A `TSDataTable` column: a stable id, a header title, an optional comparator
/// for sorting, and a cell builder. Cells are type-erased so columns of mixed
/// content compose in one array.
public struct TSColumn<Row: Identifiable>: Identifiable {
    public let id: String
    public let title: LocalizedStringKey
    public let comparator: ((Row, Row) -> ComparisonResult)?
    let cell: (Row) -> AnyView

    public init(
        id: String,
        title: LocalizedStringKey,
        comparator: ((Row, Row) -> ComparisonResult)? = nil,
        @ViewBuilder cell: @escaping (Row) -> some View
    ) {
        self.id = id
        self.title = title
        self.comparator = comparator
        self.cell = { AnyView(cell($0)) }
    }
}

/// Pure, stable table sort (ties preserve original order) — unit tested.
public enum TSTableSort {
    public static func sorted<Row>(
        _ rows: [Row],
        by comparator: (Row, Row) -> ComparisonResult,
        ascending: Bool
    ) -> [Row] {
        rows.enumerated().sorted { lhs, rhs in
            let result = comparator(lhs.element, rhs.element)
            if result == .orderedSame { return lhs.offset < rhs.offset }
            return ascending ? result == .orderedAscending : result == .orderedDescending
        }.map(\.element)
    }
}

/// Adaptive data table (web `DataTable`): a real columnar grid on macOS / regular
/// width, and a card list on compact iPhone width. Supports stable sorting,
/// multi-selection, row expansion, density, a per-column menu, and a bulk bar.
public struct TSDataTable<Row: Identifiable>: View {
    private let rows: [Row]
    private let columns: [TSColumn<Row>]
    @Binding private var selection: Set<Row.ID>
    private let density: TSTableDensity
    private var rowDetailBuilder: ((Row) -> AnyView)?

    @State private var sortColumnID: String?
    @State private var sortAscending = true
    @State private var expanded: Set<Row.ID> = []

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif

    public init(
        rows: [Row],
        columns: [TSColumn<Row>],
        selection: Binding<Set<Row.ID>> = .constant([]),
        density: TSTableDensity = .standard
    ) {
        self.rows = rows
        self.columns = columns
        _selection = selection
        self.density = density
    }

    /// Adds an expandable detail row revealed by a per-row chevron.
    public func rowDetail(@ViewBuilder _ content: @escaping (Row) -> some View) -> TSDataTable {
        var copy = self
        copy.rowDetailBuilder = { AnyView(content($0)) }
        return copy
    }

    private var sortedRows: [Row] {
        guard
            let sortColumnID,
            let column = columns.first(where: { $0.id == sortColumnID }),
            let comparator = column.comparator
        else { return rows }
        return TSTableSort.sorted(rows, by: comparator, ascending: sortAscending)
    }

    public var body: some View {
        VStack(spacing: 0) {
            if !selection.isEmpty {
                bulkBar
            }
            if isCompact {
                compactList
            } else {
                regularTable
            }
        }
    }

    private var bulkBar: some View {
        HStack(spacing: TSSpacing.md) {
            Text("table.selectedCount \(selection.count)")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer()
            Button("table.clearSelection") { selection.removeAll() }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.accent)
                .font(Font.TS.bodySm)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.accent.opacity(0.1))
    }

    // MARK: Regular (macOS / iPad) columnar layout

    private var regularTable: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(spacing: 0) {
                headerRow
                Divider().overlay(Color.TS.border)
                LazyVStack(spacing: 0) {
                    ForEach(sortedRows) { row in
                        regularRow(row)
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                }
            }
        }
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.md) {
            selectAllToggle
            ForEach(columns) { column in
                headerCell(column)
                    .frame(minWidth: 100, alignment: .leading)
            }
            if rowDetailBuilder != nil {
                Spacer().frame(width: 24)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface)
    }

    private func headerCell(_ column: TSColumn<Row>) -> some View {
        Menu {
            if column.comparator != nil {
                Button("table.sortAscending") { applySort(column.id, ascending: true) }
                Button("table.sortDescending") { applySort(column.id, ascending: false) }
            }
            Button("table.clearSort") { sortColumnID = nil }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(column.title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                if sortColumnID == column.id {
                    Image(systemName: sortAscending ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(Color.TS.accent)
                }
            }
        }
        .menuStyle(.borderlessButton)
        .disabled(column.comparator == nil)
    }

    private func regularRow(_ row: Row) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: TSSpacing.md) {
                selectionToggle(row)
                ForEach(columns) { column in
                    column.cell(row)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(minWidth: 100, alignment: .leading)
                }
                if rowDetailBuilder != nil {
                    expandToggle(row)
                }
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, density.rowPadding)

            if expanded.contains(row.id), let detail = rowDetailBuilder {
                detail(row)
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.bottom, TSSpacing.md)
            }
        }
        .background(selection.contains(row.id) ? Color.TS.accent.opacity(0.08) : Color.clear)
    }

    // MARK: Compact (iPhone) card layout

    private var compactList: some View {
        LazyVStack(spacing: TSSpacing.md) {
            ForEach(sortedRows) { row in
                compactCard(row)
            }
        }
        .padding(.vertical, TSSpacing.sm)
    }

    private func compactCard(_ row: Row) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    selectionToggle(row)
                    Spacer()
                    if rowDetailBuilder != nil {
                        expandToggle(row)
                    }
                }
                ForEach(columns) { column in
                    HStack(alignment: .firstTextBaseline) {
                        Text(column.title)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                        Spacer()
                        column.cell(row)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                }
                if expanded.contains(row.id), let detail = rowDetailBuilder {
                    detail(row)
                }
            }
        }
    }

    // MARK: Shared controls

    private var selectAllToggle: some View {
        let allSelected = !sortedRows.isEmpty && selection.count == sortedRows.count
        return Button {
            if allSelected {
                selection.removeAll()
            } else {
                selection = Set(sortedRows.map(\.id))
            }
        } label: {
            Image(systemName: allSelected ? "checkmark.square.fill" : "square")
                .foregroundStyle(allSelected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("table.selectAll"))
    }

    private func selectionToggle(_ row: Row) -> some View {
        let isSelected = selection.contains(row.id)
        return Button {
            if isSelected { selection.remove(row.id) } else { selection.insert(row.id) }
        } label: {
            Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("table.selectRow"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func expandToggle(_ row: Row) -> some View {
        let isExpanded = expanded.contains(row.id)
        return Button {
            if isExpanded { expanded.remove(row.id) } else { expanded.insert(row.id) }
        } label: {
            Image(systemName: "chevron.right")
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("table.expandRow"))
    }

    private func applySort(_ columnID: String, ascending: Bool) {
        sortColumnID = columnID
        sortAscending = ascending
    }
}
