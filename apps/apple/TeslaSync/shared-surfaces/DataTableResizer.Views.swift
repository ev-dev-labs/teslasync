//
//  DataTableResizer.Views.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  The presentational support for the column-resize handle — the native peers of the web resizer chrome:
//  the geometry tokens (the `w-1.5` visible bar plus a comfortable touch target), the macOS column-resize
//  pointer (the native peer of the web `cursor-col-resize`, guarded to macOS where SwiftUI's `pointerStyle`
//  exists), and a reusable column harness that hosts the handle on a real resizable header cell so the
//  previews and the view tests exercise the genuine drag / keyboard / clamp behavior rather than a static
//  swatch. All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - Handle geometry (web `tableTokens.resizer` `w-1.5 h-full`)

/// The handle's geometry tokens — the native peers of the web resizer `w-1.5` (the 6-point visible bar)
/// plus an Apple-HIG-comfortable touch target the thin bar is centered within (the web relies on a mouse
/// over a 6-pixel strip; touch needs more). Held on a non-generic enum so they read as named constants.
enum DataTableResizerStyle {
    /// The visible bar width — the web `w-1.5` (0.375rem ≈ 6 pt).
    static let barWidth: CGFloat = 6
    /// The interactive width the bar is centered within — wider than the bar so the handle is reliably
    /// hittable by touch + pointer (Apple HIG minimum-target guidance).
    static let hitWidth: CGFloat = 14
    /// The bar corner radius — a soft pill matching the web rounded edge.
    static let barCornerRadius: CGFloat = 3
}

// MARK: - Column-resize pointer (web `cursor-col-resize`)

extension View {
    /// Applies the macOS column-resize pointer — the native peer of the web `cursor-col-resize`. SwiftUI's
    /// `pointerStyle(_:)` is macOS-only (iOS 18 has no such member), so the modifier is compiled in only on
    /// macOS; on iOS / iPadOS the drag + accessible-adjustable affordances carry the interaction.
    @ViewBuilder
    func tsColumnResizePointer() -> some View {
        #if os(macOS)
            pointerStyle(.columnResize)
        #else
            self
        #endif
    }
}

// MARK: - Column harness (host demo — real resizable header cell)

/// A self-contained resizable column header that hosts a ``DataTableResizer`` on its trailing edge — the
/// native peer of a web `<th style={{ width }}>` with the resizer pinned to its right edge. It owns the
/// `width` as local state and feeds it back through the handle's `onResize` (continuous) / `onResizeEnd`
/// (commit) callbacks, so dragging the handle or arrow-keying it visibly resizes the cell. Used by the
/// previews and the view tests to demonstrate the genuine behavior; production tables host the handle
/// directly with their own column-width state.
public struct DataTableResizerColumnHarness: View {
    private let columnKey: String
    private let title: String
    private let minWidth: Double
    private let maxWidth: Double
    @State private var width: Double
    @State private var lastCommitted: Double

    public init(
        columnKey: String,
        title: String,
        width: Double = 160,
        minWidth: Double = 60,
        maxWidth: Double = 800
    ) {
        self.columnKey = columnKey
        self.title = title
        self.minWidth = minWidth
        self.maxWidth = maxWidth
        _width = State(initialValue: width)
        _lastCommitted = State(initialValue: width)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            headerCell
            Text(verbatim: "\(Int(width.rounded())) pt  ·  committed \(Int(lastCommitted.rounded())) pt")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
                .accessibilityHidden(true)
        }
    }

    private var headerCell: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(width: CGFloat(width), alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .overlay(alignment: .trailing) {
            DataTableResizer(
                columnKey: columnKey,
                width: width,
                minWidth: minWidth,
                maxWidth: maxWidth,
                onResize: { width = $0 },
                onResizeEnd: { lastCommitted = $0 }
            )
        }
    }
}
