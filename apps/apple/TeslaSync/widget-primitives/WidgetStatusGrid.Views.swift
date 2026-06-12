//
//  WidgetStatusGrid.Views.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  The presentational pieces of the status grid — the native peers of the web elements: the status chip
//  (web cell — the leading optional icon + label + optional value, with a corner status dot and a
//  tone-tinted rounded border), the responsive grid that collapses its column count by the widget's own
//  rendered width (web container-query class table), and the friendly empty leaf (the native "never a blank
//  box" peer of the web `<EmptyState message emptyIcon />`). All chrome is token-driven (P1/S9): no raw hex,
//  no Tailwind ports. Each chip folds its label/value into one VoiceOver element and restates the status as
//  a spoken word, so the color-coded dot is not the only status signal.
//

import SwiftUI

// MARK: - StatusToneStyle (web `statusStyles`)

/// The chip's tone — the native peer of the web `statusStyles` table (`{ bg, dot }` per status). Semantic
/// states tint a status token at the web `/10` fill and `/20` border opacities with a solid dot; the
/// neutral `inactive` / `unknown` states use the subtle glass surface + hairline border + muted dot (web
/// `bg-white/[0.03] border-white/[0.06]`). Token-driven so light / dark / high-contrast all resolve.
private struct StatusToneStyle {
    /// Web `bg-{tone}-500/10` — the chip fill opacity for a semantic tone.
    private static let fillOpacity: Double = 0.10
    /// Web `border-{tone}-500/20` — the chip border opacity for a semantic tone.
    private static let borderOpacity: Double = 0.20

    let fill: Color
    let border: Color
    let dot: Color

    init(_ kind: StatusCellKind) {
        switch kind {
        case .ok:
            fill = Color.TS.statusSuccess.opacity(Self.fillOpacity)
            border = Color.TS.statusSuccess.opacity(Self.borderOpacity)
            dot = Color.TS.statusSuccess
        case .warning:
            fill = Color.TS.statusWarning.opacity(Self.fillOpacity)
            border = Color.TS.statusWarning.opacity(Self.borderOpacity)
            dot = Color.TS.statusWarning
        case .error:
            fill = Color.TS.statusDanger.opacity(Self.fillOpacity)
            border = Color.TS.statusDanger.opacity(Self.borderOpacity)
            dot = Color.TS.statusDanger
        case .inactive, .unknown:
            fill = Color.TS.surfaceGlass
            border = Color.TS.border
            dot = Color.TS.textMuted
        }
    }
}

// MARK: - StatusGridCellView (web cell)

/// A single status chip — the native peer of the web cell: an optional leading icon, the truncated label
/// over an optional truncated value, a tone-tinted rounded border, and a small status dot pinned to the
/// top-trailing corner (web `absolute right-2 top-2 size-2 rounded-full`). Honors the web `min-h-[44px]`
/// (also the HIG minimum touch target) and the `compact` padding. A pure function of its ``StatusGridCell``,
/// so it composes in every branch for snapshot / preview / test.
struct StatusGridCellView: View {
    let cell: StatusGridCell
    let compact: Bool

    /// Web `size-2` status dot (8pt).
    private let dotSize: CGFloat = 8
    /// Web `min-h-[44px]` — the chip floor (and the HIG minimum touch target).
    private let minHeight: CGFloat = 44

    private var tone: StatusToneStyle {
        StatusToneStyle(cell.status)
    }

    /// Web `px-3` / `compact px-2`.
    private var horizontalPadding: CGFloat {
        compact ? TSSpacing.sm : TSSpacing.md
    }

    /// Web `py-2` / `compact py-1.5` (6pt).
    private var verticalPadding: CGFloat {
        compact ? 6 : TSSpacing.sm
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if let symbol = cell.systemImage, !symbol.isEmpty {
                Image(systemName: symbol)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityHidden(true)
            }
            labelColumn
            Spacer(minLength: 0)
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(minHeight: minHeight, alignment: .leading)
        .background(tone.fill, in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm)
                .strokeBorder(tone.border, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(tone.dot)
                .frame(width: dotSize, height: dotSize)
                .padding(TSSpacing.sm)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The label over the optional value (web `min-w-0 flex-1` column). The value renders only when present
    /// — it is already gated by `compact` upstream (web `!compact && cell.value`).
    private var labelColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: cell.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            if let value = cell.value, !value.isEmpty {
                Text(verbatim: value)
                    .font(Font.TS.body.weight(.medium))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var accessibilityLabel: String {
        WidgetStatusGridStrings.cellAccessibilityLabel(
            label: cell.label,
            value: cell.value,
            status: cell.status
        )
    }
}

// MARK: - WidgetStatusGridContent (web `<div className="grid">`)

/// The responsive cell grid — the native peer of the web grid `<div>`. It measures its own rendered width
/// and resolves the column count from the target via ``WidgetStatusGridLayout`` (the web container-query
/// class table), so a 3- or 4-up grid collapses on a narrow widget. Holds only value-type inputs, so it
/// stays cheap to recompose; the measured width is local `@State`.
struct WidgetStatusGridContent: View {
    let cells: [StatusGridCell]
    let columns: StatusGridColumns
    let compact: Bool

    @State private var availableWidth: CGFloat = 0

    private var columnCount: Int {
        WidgetStatusGridLayout.columnCount(target: columns, availableWidth: availableWidth)
    }

    private var gridColumns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .top),
            count: max(1, columnCount)
        )
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(cells) { cell in
                StatusGridCellView(cell: cell, compact: compact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            availableWidth = newWidth
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - WidgetStatusGridEmptyState (web `<EmptyState />`)

/// The friendly empty leaf — the native "never a blank box" peer of the web
/// `<EmptyState message={emptyMessage} icon={emptyIcon} />`. A `ContentUnavailableView` with the supplied
/// glyph + headline (the caller override or the facade default) over a supporting hint. Folded into a
/// single VoiceOver element; copy via the P1/S10 facade.
struct WidgetStatusGridEmptyState: View {
    let message: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: systemImage)
            }
        } description: {
            Text(verbatim: WidgetStatusGridStrings.emptyHint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(message). \(WidgetStatusGridStrings.emptyHint)"))
    }
}
