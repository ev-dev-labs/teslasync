//
//  MarkdownRenderer.BlockViews.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The multi-line block views for the chatbot markdown renderer: bullet / numbered lists (web `ul`/`ol`,
//  with gfm task checkboxes + nested children), blockquotes (web `blockquote`), and gfm tables (web
//  `table`/`th`/`td`, horizontally scrollable like the web `overflow-x-auto`). Token-driven (P1/S9); copy
//  via the P1/S10 facade. Leaf blocks + the inline builder live in MarkdownRenderer.Views.swift.
//

import SwiftUI

// MARK: - Lists

/// A bullet / numbered list — web `ul.list-disc` / `ol.list-decimal`.
struct MarkdownListView: View {
    let items: [MarkdownListItem]
    let ordered: Bool
    let start: Int
    let onCopy: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                MarkdownListItemRow(item: item, marker: marker(at: index), onCopy: onCopy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func marker(at index: Int) -> String {
        ordered ? "\(start + index)." : "•"
    }
}

/// One list row: a leading bullet / ordinal / gfm checkbox, the item's inline content, and any nested
/// child blocks (sub-lists, extra paragraphs) indented under it.
struct MarkdownListItemRow: View {
    let item: MarkdownListItem
    let marker: String
    let onCopy: (String) -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            markerView
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                MarkdownInlineView.text(item.inlines, font: Font.TS.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !item.children.isEmpty {
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        ForEach(Array(item.children.enumerated()), id: \.offset) { _, child in
                            MarkdownBlockView(block: child, onCopy: onCopy)
                        }
                    }
                    .padding(.leading, TSSpacing.sm)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var markerView: some View {
        if let task = item.task {
            let checked = task == .checked
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .font(.system(size: 13))
                .foregroundStyle(checked ? Color.TS.statusSuccess : Color.TS.textMuted)
                .accessibilityLabel(
                    checked
                        ? MarkdownRendererStrings.text("markdownRenderer.task.checked", "Completed")
                        : MarkdownRendererStrings.text("markdownRenderer.task.unchecked", "To do")
                )
        } else {
            Text(verbatim: marker)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Blockquote

/// A blockquote — web `blockquote`, drawn with a leading accent rule and secondary text.
struct MarkdownBlockquoteView: View {
    let blocks: [MarkdownBlock]
    let onCopy: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(Color.TS.border)
                .frame(width: 3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    MarkdownBlockView(block: block, onCopy: onCopy)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(Color.TS.textSecondary)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Table (gfm)

/// A gfm table — web `table`/`th`/`td`, horizontally scrollable (web `overflow-x-auto`) with a header row,
/// a rule, and per-column alignment from the delimiter row.
struct MarkdownTableView: View {
    let table: MarkdownTable

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.xs) {
                GridRow {
                    ForEach(Array(table.headers.enumerated()), id: \.offset) { column, cell in
                        cellView(cell, font: Font.TS.body.weight(.semibold), column: column)
                    }
                }
                Divider()
                    .gridCellColumns(max(table.columnCount, 1))
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                            cellView(cell, font: Font.TS.body, column: column)
                        }
                    }
                }
            }
            .padding(TSSpacing.sm)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private func cellView(_ inlines: [MarkdownInline], font: Font, column: Int) -> some View {
        MarkdownInlineView.text(inlines, font: font)
            .multilineTextAlignment(textAlignment(for: column))
            .fixedSize(horizontal: false, vertical: true)
            .frame(minWidth: 44, alignment: frameAlignment(for: column))
    }

    private func columnAlignment(for column: Int) -> MarkdownColumnAlignment {
        column < table.alignments.count ? table.alignments[column] : .none
    }

    private func textAlignment(for column: Int) -> TextAlignment {
        switch columnAlignment(for: column) {
        case .center:
            .center
        case .trailing:
            .trailing
        case .leading, .none:
            .leading
        }
    }

    private func frameAlignment(for column: Int) -> Alignment {
        switch columnAlignment(for: column) {
        case .center:
            .center
        case .trailing:
            .trailing
        case .leading, .none:
            .leading
        }
    }
}
