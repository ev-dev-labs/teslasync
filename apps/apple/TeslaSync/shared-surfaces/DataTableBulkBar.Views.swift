//
//  DataTableBulkBar.Views.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  The presentational pieces of the table selection toolbar — the native peers of the web elements: the
//  tinted bar container (web `role="region"` with the `tableTokens.bulkBar` chrome), the polite
//  "{{count}} selected" label (web count `<span aria-live="polite">`), the bulk-action slot (web
//  `children`), the "Clear selection" button (web `<button>` with its leading ✕), and the production
//  announcer that posts a real polite announcement. All chrome is token-driven (P1/S9); no raw hex, no
//  Tailwind ports. The leading ✕ is hidden from VoiceOver; the clear button carries the explicit "Clear
//  selection" label. The web `flex flex-wrap` row is reproduced with a `ViewThatFits` that drops the
//  controls onto their own line when the bar (or Dynamic Type) needs the width — the Apple-idiomatic peer
//  of wrapping versus a clipped single line.
//

import SwiftUI

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the announcement to the assistive technology via SwiftUI's
/// `AccessibilityNotification.Announcement` at `.default` (polite) speech priority — the native parity of
/// the web count span's `aria-live="polite"` content the toolbar writes the selection count into.
@MainActor
public struct LiveDataTableBulkBarAnnouncer: DataTableBulkBarAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}

// MARK: - Bar chrome tokens (web `tableTokens.bulkBar` cyan tint)

/// The bar's tint opacities — the native peers of the web `border-cyan-500/20 bg-cyan-500/[0.06]`. Held
/// on a non-generic enum so they read as named constants (a generic view cannot own static stored
/// properties). The cyan-500 maps to the brand ``Color/TS/accent``.
enum DataTableBulkBarStyle {
    /// Background tint — the web `bg-cyan-500/[0.06]`.
    static let fillOpacity: Double = 0.06
    /// Border tint — the web `border-cyan-500/20`.
    static let borderOpacity: Double = 0.20
    /// Clear-button hover tint — the theme-adaptive peer of the web `hover:bg-white/[0.06]`.
    static let hoverOpacity: Double = 0.06
}

// MARK: - Bar (web `role="region"` selection toolbar)

/// The selection toolbar — the native peer of the web bulk bar `<div role="region">`: the polite count
/// label on the leading edge, the caller's bulk-action slot, and the trailing "Clear selection" button.
/// Tinted with the brand accent (web cyan), rounded + bordered, with a hairline margin below (web
/// `mb-2`). Labelled "Bulk actions" as one VoiceOver region whose children stay individually navigable.
struct DataTableBulkBarBar<Actions: View>: View {
    let model: DataTableBulkBarModel
    let actions: Actions

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            horizontalRow
            verticalStack
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.accent.opacity(DataTableBulkBarStyle.fillOpacity), in: shape)
        .overlay(shape.strokeBorder(Color.TS.accent.opacity(DataTableBulkBarStyle.borderOpacity), lineWidth: 1))
        .padding(.bottom, TSSpacing.sm)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: DataTableBulkBarStrings.regionLabel))
    }

    /// The wide layout — count label, a flexible gap (web `ml-auto`), then the controls.
    private var horizontalRow: some View {
        HStack(spacing: TSSpacing.md) {
            countLabel
            Spacer(minLength: TSSpacing.sm)
            controls
        }
    }

    /// The narrow / large-Dynamic-Type fallback — the controls wrap onto their own line (web flex-wrap).
    private var verticalStack: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            countLabel
            controls
        }
    }

    /// The bulk-action slot (web `children`) followed by the clear button (web trailing `<button>`).
    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            if model.projection.showsActions {
                actions
            }
            DataTableBulkBarClearButton { model.clear() }
        }
    }

    /// The polite "{{count}} selected" label — web count `<span className="font-medium">`.
    private var countLabel: some View {
        Text(verbatim: DataTableBulkBarStrings.selected(model.projection.count))
            .font(Font.TS.body)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textPrimary)
    }
}

// MARK: - Clear button (web trailing `<button aria-label="Clear selection">`)

/// The "Clear selection" button — the native peer of the web `<button>`: a leading ✕ (web `<X>`, hidden
/// from VoiceOver) and the "Clear selection" label, with a theme-adaptive hover tint (web
/// `hover:bg-white/[0.06]` + `hover:text-[var(--text-primary)]`). The whole control is one tap target
/// with the explicit "Clear selection" VoiceOver label; the system focus engine supplies the keyboard
/// focus ring (web `focus-visible:ring-2`).
struct DataTableBulkBarClearButton: View {
    let onClear: () -> Void

    @State private var isHovering = false

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
    }

    var body: some View {
        Button(action: onClear) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: DataTableBulkBarStrings.clear)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(isHovering ? Color.TS.textPrimary : Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.textPrimary.opacity(isHovering ? DataTableBulkBarStyle.hoverOpacity : 0), in: shape)
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: DataTableBulkBarStrings.clear))
    }
}
