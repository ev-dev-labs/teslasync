//
//  DataTable.Header.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The data table's header row + its cells — the native peers of the web `<thead>`: the optional select-all
//  control (web the multi-select header checkbox with its indeterminate state), the expand-column header (web
//  the empty labelled `<th>`), and one cell per visible column with a sort toggle (web the `<button>` +
//  `ChevronUp`/`ChevronDown`), an optional reorder grip + drag-to-reorder (web `GripVertical` + the HTML5 drag
//  handlers), and a trailing ``DataTableResizer`` when the column is resizable. Every cell is fixed-width so the
//  pinned header aligns with the body rows. Token-driven (P1/S9); strings via the P1/S10 facade.
//

import SwiftUI

// MARK: - DataTableHeaderRow (web `<thead><tr>`)

/// The pinned header row — fixed-width leading control cells followed by the visible column headers. Each
/// column header sorts (when sortable), reorders (when enabled, via a drag whose drop target is tinted), and
/// resizes (when enabled, via the trailing handle). A hairline underline separates it from the body (web the
/// `border-b`), reinforced for forced-colors users.
public struct DataTableHeaderRow: View {
    let specs: [DataTableColumnSpec]
    let selectionMode: DataTableSelectionMode
    let expandable: Bool
    let sortKey: String?
    let sortDirection: DataTableSortDirection?
    let onSort: ((String) -> Void)?
    let allSelected: Bool
    let someSelected: Bool
    let onToggleAll: () -> Void
    let resizeEnabled: Bool
    let reorderEnabled: Bool
    let dragOverKey: String?
    let controlWidth: CGFloat
    let width: (DataTableColumnSpec) -> CGFloat
    let onResize: (String, Double) -> Void
    let onResizeEnd: (String, Double) -> Void
    let onReorderTo: (String, String) -> Void
    let onDragOver: (String?) -> Void

    public var body: some View {
        HStack(spacing: 0) {
            if selectionMode.isSelectable {
                selectAllCell
            }
            if expandable {
                expandHeaderCell
            }
            ForEach(specs) { spec in
                headerCell(spec)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TSMaterial.panel)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: DataTableMetrics.separatorWidth)
        }
    }

    /// The select-all control (web the multi `<th>` checkbox); a single-select table renders an empty cell.
    private var selectAllCell: some View {
        Group {
            if selectionMode.isMulti {
                DataTableSelectAllToggle(allSelected: allSelected, someSelected: someSelected, onToggle: onToggleAll)
            } else {
                Color.clear
            }
        }
        .frame(width: controlWidth)
    }

    /// The expand-column header — an empty, accessibly-labelled cell (web the `aria-label`'d expand `<th>`).
    private var expandHeaderCell: some View {
        Color.clear
            .frame(width: controlWidth)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: DataTableStrings.expandColumnHeader))
    }

    /// One column header — grip (when reorderable) + sort toggle or plain label, fixed-width and aligned, with
    /// the resize handle trailing and the drag-over tint (web the `<th>` body).
    private func headerCell(_ spec: DataTableColumnSpec) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if reorderEnabled {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: DataTableMetrics.gripSide))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            headerLabel(spec)
        }
        .frame(width: width(spec), alignment: spec.alignment.frameAlignment)
        .padding(.horizontal, TSSpacing.md)
        .background(dragOverKey == spec.key ? Color.TS.accent.opacity(0.1) : Color.clear)
        .overlay(alignment: .trailing) { resizeHandle(spec) }
        .modifier(DataTableHeaderReorder(
            spec: spec,
            enabled: reorderEnabled,
            onReorderTo: onReorderTo,
            onDragOver: onDragOver
        ))
    }

    /// The sortable button (web the sort `<button>` + chevron) or the plain header label.
    @ViewBuilder
    private func headerLabel(_ spec: DataTableColumnSpec) -> some View {
        if spec.sortable {
            DataTableSortHeaderButton(
                spec: spec,
                isActive: sortKey == spec.key,
                direction: sortDirection,
                onSort: onSort
            )
        } else {
            Text(verbatim: spec.header)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }

    /// The trailing resize handle (composed ``DataTableResizer``) when the column is resizable.
    @ViewBuilder
    private func resizeHandle(_ spec: DataTableColumnSpec) -> some View {
        if resizeEnabled {
            DataTableResizer(
                columnKey: spec.key,
                width: Double(width(spec)),
                minWidth: spec.minWidth,
                maxWidth: spec.maxWidth,
                onResize: { onResize(spec.key, $0) },
                onResizeEnd: { onResizeEnd(spec.key, $0) },
                label: DataTableStrings.resizeLabel(column: spec.header)
            )
        }
    }
}

// MARK: - DataTableHeaderReorder (web HTML5 column drag)

/// The drag-to-reorder behaviour for a header cell — the native peer of the web `draggable` + `onDragStart` /
/// `onDragOver` / `onDrop` handlers: the cell is a drag source carrying its column key, and a drop target that
/// tints while hovered and moves the dropped column to this slot (the web `handleHeaderDrop` →
/// `moveColumn(order, source, targetIndex)`). A no-op when reorder is disabled.
private struct DataTableHeaderReorder: ViewModifier {
    let spec: DataTableColumnSpec
    let enabled: Bool
    let onReorderTo: (String, String) -> Void
    let onDragOver: (String?) -> Void

    func body(content: Content) -> some View {
        if enabled {
            content
                .draggable(spec.key)
                .dropDestination(for: String.self) { items, _ in
                    onDragOver(nil)
                    guard let source = items.first else { return false }
                    onReorderTo(source, spec.key)
                    return true
                } isTargeted: { targeted in
                    onDragOver(targeted ? spec.key : nil)
                }
        } else {
            content
        }
    }
}

// MARK: - DataTableSortHeaderButton (web sort `<button>`)

/// A sortable column's header button — the web sort `<button>`: the label plus the active chevron (up for
/// ascending, down for descending). Tapping toggles / sets the sort (web `onSort(col.key)`); VoiceOver hears
/// the active sort direction (web `aria-sort`).
public struct DataTableSortHeaderButton: View {
    let spec: DataTableColumnSpec
    let isActive: Bool
    let direction: DataTableSortDirection?
    let onSort: ((String) -> Void)?

    public var body: some View {
        Button {
            onSort?(spec.key)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: spec.header)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                if isActive {
                    Image(systemName: direction == .ascending ? "chevron.up" : "chevron.down")
                        .font(.system(size: DataTableMetrics.sortChevronSide, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(Text(verbatim: isActive ? sortValue : ""))
    }

    /// The spoken active-sort value (web `aria-sort` ascending / descending).
    private var sortValue: String {
        direction == .ascending ? "ascending" : "descending"
    }
}

// MARK: - DataTableSelectAllToggle (web multi header checkbox)

/// The select-all header control — the native peer of the web multi `<input type=checkbox>` with its
/// indeterminate state: a filled box when all rows are selected, a dash box when some are, an empty box
/// otherwise. Tapping toggles every row (web `toggleAll`).
public struct DataTableSelectAllToggle: View {
    let allSelected: Bool
    let someSelected: Bool
    let onToggle: () -> Void

    public var body: some View {
        Button(action: onToggle) {
            Image(systemName: symbolName)
                .font(.system(size: DataTableMetrics.checkboxSide))
                .foregroundStyle(allSelected || someSelected ? Color.TS.accent : Color.TS.textMuted)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DataTableStrings.selectAllLabel(allSelected: allSelected)))
    }

    private var symbolName: String {
        if allSelected { return "checkmark.square.fill" }
        if someSelected { return "minus.square.fill" }
        return "square"
    }
}
