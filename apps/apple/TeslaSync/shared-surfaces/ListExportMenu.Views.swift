//
//  ListExportMenu.Views.swift
//  TeslaSync — P4 shared surface · 0155 · ListExportMenu (Apple)
//
//  The presentational subviews composed by `ListExportMenu`: the Download-icon trigger (the native
//  parity of the web ghost `Button` with the lucide `Download` glyph + the "Export" caption), the
//  popover body (the optional scope chooser + the CSV/JSON format rows), the scope radio row (the
//  parity of the web `<label><input type=radio></label>`), and the format row (the parity of each web
//  `role="menuitem"` button). All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex. The trigger reproduces the web `disabled` affordance:
//  a spinner while loading, a dimmed glyph when empty (both web `disabled`).
//

import SwiftUI

// MARK: - Trigger (web ghost Download button + "Export" caption)

/// The menu trigger — a Download glyph + the "Export" caption styled as a muted ghost control, the
/// native parity of the web `<Button variant="ghost" size="sm" icon={<Download/>}>Export</Button>`
/// (whose `className` tints it `--text-secondary`). While `.loading` the glyph is replaced by a small
/// spinner and while `.empty` it dims — the two visual faces of the single web `disabled` prop. The
/// spoken label is the availability-driven trigger label (web `disabledTooltip` / `menuLabel`).
struct ListExportMenuTrigger: View {
    let availability: ListExportAvailability
    let action: () -> Void

    private var accessibilityLabel: String {
        ListExportMenuStrings.triggerLabel(availability: availability)
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                leadingGlyph
                Text(verbatim: ListExportMenuStrings.exportButtonLabel())
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
            .opacity(availability == .empty ? 0.5 : 1)
            .frame(minHeight: 28)
            .padding(.horizontal, TSSpacing.sm)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    @ViewBuilder
    private var leadingGlyph: some View {
        if availability == .loading {
            ProgressView()
                .controlSize(.small)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 13, weight: .medium))
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Popover content (web popover `role="menu"`)

/// The popover body — the optional scope chooser (shown only when `selectedCount > 0`) above the two
/// format rows (CSV then JSON). Bound through the scope `Binding`; every format tap routes to
/// `onExport`, so no networking lives here. Sized to the web `w-56` (224pt) minimum.
struct ListExportMenuPopoverContent: View {
    @Binding var scope: ListExportScope
    let selectedCount: Int
    let visibleCount: Int?
    let onExport: (ListExportFormat) -> Void

    private var showsScopeChooser: Bool {
        ListExportMenuLogic.showsScopeChooser(selectedCount: selectedCount)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if showsScopeChooser {
                scopeChooser
                Divider().overlay(Color.TS.border)
            }
            ForEach(ListExportMenuLogic.formatOrder) { format in
                ListExportFormatRow(
                    label: ListExportMenuStrings.formatLabel(format),
                    systemImage: format.systemImage
                ) { onExport(format) }
            }
        }
        .padding(TSSpacing.sm)
        .frame(minWidth: 224, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ListExportMenuStrings.triggerLabel(availability: .ready)))
    }

    // MARK: Scope chooser (web `<fieldset aria-label="Export scope">`)

    private var scopeChooser: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "checklist")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: ListExportMenuStrings.scopeLegend())
                    .font(Font.TS.label)
                    .textCase(.uppercase)
            }
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.bottom, 2)

            ListExportScopeRadioRow(
                label: ListExportMenuStrings.visibleScopeLabel(visibleCount: visibleCount),
                isSelected: scope == .visible
            ) { scope = .visible }

            ListExportScopeRadioRow(
                label: ListExportMenuStrings.selectedScopeLabel(selectedCount: selectedCount),
                isSelected: scope == .selected
            ) { scope = .selected }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ListExportMenuStrings.scopeLegend()))
    }
}

// MARK: - Scope radio row (web `<label><input type="radio"></label>`)

/// One scope option — a radio indicator + its label, the native parity of the web `ScopeRadio`. The
/// row is a `Button` (so the whole row is the hit target, like the web `<label>`); the selected state
/// is exposed to VoiceOver via the `.isSelected` trait.
struct ListExportScopeRadioRow: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: isSelected ? "circle.inset.filled" : "circle")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Format row (web `<button role="menuitem">`)

/// One export-format action row — a leading SF Symbol (mirroring the web lucide glyph) and the
/// localised format label, the native parity of a web `<button role="menuitem">`. Full-width hit
/// target; the label text is the row's own VoiceOver content.
struct ListExportFormatRow: View {
    let label: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .regular))
                    .frame(width: 16)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.body)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isButton)
    }
}
