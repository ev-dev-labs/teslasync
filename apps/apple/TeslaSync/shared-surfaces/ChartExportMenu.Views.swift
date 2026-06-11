//
//  ChartExportMenu.Views.swift
//  TeslaSync — P4 shared surface · 0066 · ChartExportMenu (Apple)
//
//  The presentational subviews composed by `ChartExportMenu`: the Download-icon trigger label (the
//  native parity of the web ghost `Button` with the lucide `Download` glyph) and the per-row menu
//  item button (the parity of each web `role="menuitem"` button — a leading lucide glyph + the
//  localised action label). Both consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex. The item rows carry their own enablement so the web
//  `busy` gating renders faithfully inside the native `Menu`.
//

import SwiftUI

// MARK: - Trigger label (web ghost Download button)

/// The menu trigger's appearance — a single Download glyph styled as a muted ghost icon control,
/// the native parity of the web `<Button variant="ghost" icon={<Download/>}>`. Dims when the menu
/// is disabled (web `disabled` trigger); the spoken label is supplied by the parent `Menu`.
struct ChartExportMenuTriggerLabel: View {
    let disabled: Bool

    var body: some View {
        Image(systemName: "square.and.arrow.down")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Color.TS.textMuted)
            .frame(width: 28, height: 28)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .opacity(disabled ? 0.5 : 1)
            .accessibilityHidden(true)
    }
}

// MARK: - Menu item button (web `role="menuitem"` row)

/// One export action row inside the menu — a leading SF Symbol (mirroring the web lucide glyph) and
/// the localised action label, the native parity of a web `<button role="menuitem">`. Disabled when
/// the item is gated by `busy` (web `disabled={busy}` on the snapshot-dependent items); the label
/// text is the row's own VoiceOver content.
struct ChartExportMenuItemButton: View {
    let item: ChartExportMenuItem
    let onTap: () -> Void

    private var title: String {
        ChartExportMenuStrings.itemLabel(item)
    }

    var body: some View {
        Button(action: onTap) {
            Label {
                Text(verbatim: title)
            } icon: {
                Image(systemName: item.systemImage)
            }
        }
        .disabled(!item.isEnabled)
        .accessibilityLabel(Text(verbatim: title))
    }
}
