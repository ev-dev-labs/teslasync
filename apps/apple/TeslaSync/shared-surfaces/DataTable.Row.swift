//
//  DataTable.Row.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The data table's body cells — the native peers of the web row renderer (`renderDataRow`) and the empty /
//  error branches: one data row (the optional selection checkbox/radio, the optional expand chevron, the
//  fixed-width data cells, and the expanded drawer below an expanded row), the empty-state row (web the
//  `emptyMessage` cell), and the error fallback (web the `<SectionErrorBoundary>` "This table failed to render"
//  cell, here with a retry affordance). Token-driven (P1/S9); strings via the P1/S10 facade. The selection /
//  expansion handlers route to the model, which mirrors them to the host (web `onSelectionChange` /
//  `onExpandedChange`); a right-click / long-press surfaces the row's context actions (web `rowContextMenu`).
//

import SwiftUI
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - DataTableKeyedRow (web React `key`)

/// A row paired with its stable id for `ForEach` — the native peer of the web `key={rowKey}`. The id is the
/// `keyExtractor` output; a collision routes the body to the error fallback (see ``DataTableProjector``).
public struct DataTableKeyedRow<Row>: Identifiable {
    public let id: DataTableRowKey
    public let value: Row

    public init(id: DataTableRowKey, value: Row) {
        self.id = id
        self.value = value
    }
}

// MARK: - DataTableDataRow (web `renderDataRow`)

/// One body row + its optional expanded drawer — the native peer of the web `renderDataRow`. The leading
/// control cells (selection, expand) and the fixed-width data cells align with the header; a selected row is
/// tinted (web `rowSelected`); an expanded row reveals its drawer beneath (web the expanded `<tr>`); a hairline
/// separates rows. Right-click / long-press shows the row's context actions when supplied (web `rowContextMenu`).
public struct DataTableDataRow<Row>: View {
    let row: Row
    let rowKey: DataTableRowKey
    let columns: [DataTableColumn<Row>]
    let selectionMode: DataTableSelectionMode
    let isSelected: Bool
    let expandable: Bool
    let isExpanded: Bool
    let density: DataTableDensity
    let controlWidth: CGFloat
    let width: (DataTableColumnSpec) -> CGFloat
    let onToggleRow: (Bool) -> Void
    let onToggleExpand: () -> Void
    let expandedContent: AnyView?
    let contextActions: [DataTableMenuAction]

    public var body: some View {
        VStack(spacing: 0) {
            rowLine
            if isExpanded, let expandedContent {
                expandedDrawer(expandedContent)
            }
        }
        .background(isSelected ? Color.TS.accent.opacity(0.08) : Color.clear)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.TS.border.opacity(0.5))
                .frame(height: DataTableMetrics.separatorWidth)
        }
        .modifier(DataTableRowContextMenu(actions: contextActions))
        .accessibilityElement(children: .contain)
    }

    /// The primary row line — the leading controls then the data cells (web the row `<tr>`).
    private var rowLine: some View {
        HStack(spacing: 0) {
            if selectionMode.isSelectable {
                DataTableSelectionControl(
                    isSelected: isSelected,
                    isMulti: selectionMode.isMulti,
                    onToggle: onToggleRow
                )
                .frame(width: controlWidth)
            }
            if expandable {
                DataTableExpandControl(isExpanded: isExpanded, onToggle: onToggleExpand)
                    .frame(width: controlWidth)
            }
            ForEach(columns) { column in
                dataCell(column)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, CGFloat(density.cellPaddingV))
    }

    /// One data cell — the column's renderer, fixed-width and aligned (web the `<td>`). The body font / primary
    /// text color are applied as defaults the cell content may override.
    private func dataCell(_ column: DataTableColumn<Row>) -> some View {
        column.cell(row)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(width: width(column.spec), alignment: column.alignment.frameAlignment)
            .padding(.horizontal, CGFloat(density.cellPaddingH))
    }

    /// The expanded-row drawer — the host's `renderExpanded` body, inset and full-width (web the expanded `<tr>`).
    private func expandedDrawer(_ content: AnyView) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, CGFloat(density.cellPaddingH))
            .padding(.vertical, CGFloat(density.cellPaddingV))
            .background(Color.TS.surfaceGlass)
    }
}

// MARK: - DataTableSelectionControl (web row checkbox / radio)

/// A row's selection control — the native peer of the web `<input type=checkbox|radio>`: a filled box / circle
/// when selected, an empty one otherwise. Tapping toggles the row; on macOS a Shift-tap extends the additive
/// range (web the shift-click range), passed through to the handler.
public struct DataTableSelectionControl: View {
    let isSelected: Bool
    let isMulti: Bool
    let onToggle: (Bool) -> Void

    public var body: some View {
        Button(action: toggle) {
            Image(systemName: symbolName)
                .font(.system(size: DataTableMetrics.checkboxSide))
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DataTableStrings.rowSelectionLabel(isSelected: isSelected)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// Toggles the row, passing whether Shift is held for the additive range (web shift-click).
    private func toggle() {
        onToggle(isShiftPressed)
    }

    private var symbolName: String {
        if isMulti {
            return isSelected ? "checkmark.square.fill" : "square"
        }
        return isSelected ? "largecircle.fill.circle" : "circle"
    }

    /// Whether Shift is held at tap time (macOS range select); always `false` where there is no modifier.
    private var isShiftPressed: Bool {
        #if canImport(AppKit)
            return NSEvent.modifierFlags.contains(.shift)
        #else
            return false
        #endif
    }
}

// MARK: - DataTableExpandControl (web row expand chevron)

/// A row's expand toggle — the native peer of the web expand `<button>`: a disclosure chevron that rotates when
/// the row is expanded (web `ChevronRight` + `rotate-90`). Tapping toggles the drawer.
public struct DataTableExpandControl: View {
    let isExpanded: Bool
    let onToggle: () -> Void

    public var body: some View {
        Button(action: onToggle) {
            Image(systemName: "chevron.right")
                .font(.system(size: DataTableMetrics.expandChevronSide, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DataTableStrings.rowExpansionLabel(isExpanded: isExpanded)))
    }
}

// MARK: - DataTableRowContextMenu (web `rowContextMenu`)

/// The row's right-click / long-press menu — the native peer of the web `rowContextMenu`: a `.contextMenu` of
/// the supplied actions (destructive ones get the system role). A no-op (no menu attached) when the builder
/// returns no actions, so rows without a menu keep their default interaction (web returning `[]` leaves the
/// native menu intact).
private struct DataTableRowContextMenu: ViewModifier {
    let actions: [DataTableMenuAction]

    func body(content: Content) -> some View {
        if actions.isEmpty {
            content
        } else {
            content.contextMenu {
                ForEach(actions) { action in
                    if let systemImage = action.systemImage {
                        Button(
                            action.title,
                            systemImage: systemImage,
                            role: action.isDestructive ? .destructive : nil,
                            action: action.action
                        )
                    } else {
                        Button(
                            action.title,
                            role: action.isDestructive ? .destructive : nil,
                            action: action.action
                        )
                    }
                }
            }
        }
    }
}

// MARK: - DataTableEmptyRow (web `emptyMessage`)

/// The empty-state row — the native peer of the web `data.length === 0` body: the centered `emptyMessage`. It
/// spans at least the table's content width so the message stays centered under the columns when scrolled.
public struct DataTableEmptyRow: View {
    let message: String
    let width: CGFloat

    public var body: some View {
        HStack {
            Spacer(minLength: 0)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            Spacer(minLength: 0)
        }
        .frame(minWidth: width, maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x3xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - DataTableErrorFallback (web SectionErrorBoundary)

/// The error fallback — the native peer of the web `<SectionErrorBoundary>` "This table failed to render" row,
/// reached on a host-signalled failure or a duplicate-key collision. A warning glyph + the boundary title (web
/// `AlertTriangle` + the title) plus a retry affordance (the native addition the web boundary gets for free by
/// re-rendering). Spans the table's content width.
public struct DataTableErrorFallback: View {
    let width: CGFloat
    let onRetry: () -> Void

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: DataTableStrings.errorTitle)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Button(action: onRetry) {
                Text(verbatim: DataTableStrings.retry)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(
                        Color.TS.surfaceGlass,
                        in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: DataTableMetrics.separatorWidth)
                    )
            }
            .buttonStyle(.plain)
        }
        .frame(minWidth: width, maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityElement(children: .contain)
    }
}
