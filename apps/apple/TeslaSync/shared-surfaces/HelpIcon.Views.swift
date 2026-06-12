//
//  HelpIcon.Views.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  The presentational pieces of the field-level help primitive — the native peers of the web elements: the
//  `(?)` trigger button (web `<button>` wrapping a lucide `<HelpCircle>`), the help bubble body (web
//  `<Tooltip content>`), and the `side` → `Edge` mapping (web tooltip placement). The trigger reveals the
//  bubble on tap and — on macOS — on pointer hover via the native `.help()` modifier, the closest peer of
//  the web "hover, focus, or tap reveals" affordance; Escape and an outside tap collapse the popover (the
//  native peer of the web Escape-to-blur). The hover tint mirrors the web `hover:text-[var(--text-secondary)]`.
//  All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. The glyph is hidden from VoiceOver;
//  the trigger carries the resolved label + the open hint, and the help text backs both the VoiceOver hint
//  and the revealed bubble (the native peer of the web `aria-describedby`).
//

import SwiftUI

// MARK: - Side → Edge (web tooltip `side`)

extension HelpIconSide {
    /// The popover arrow edge for the web tooltip side.
    var arrowEdge: Edge {
        switch self {
        case .top: .top
        case .bottom: .bottom
        case .leading: .leading
        case .trailing: .trailing
        }
    }
}

// MARK: - Pointer tooltip (web `<Tooltip>` hover affordance)

/// Applies the native pointer tooltip carrying the help text — macOS shows it on hover; on iOS / iPadOS it
/// backs the pointer / long-press affordance. The native peer of the web tooltip revealing on hover, layered
/// under the tap-driven popover so both pointer and touch users reach the help.
struct HelpIconHoverTip: ViewModifier {
    let text: String

    func body(content: Content) -> some View {
        content.help(Text(verbatim: text))
    }
}

// MARK: - Trigger (web `<button>` + lucide `<HelpCircle>`)

/// The `(?)` trigger — the native peer of the web `<button>`: a small, inline `questionmark.circle` glyph
/// sized to sit next to a form `<Label>` (web `h-4 w-4` button, `h-3.5 w-3.5` icon, `ml-1`). It reveals the
/// help bubble on tap (keyboard: Return / Space) and on macOS pointer hover; the muted glyph brightens on
/// hover (web `hover:text-[var(--text-secondary)]`). The whole control is one VoiceOver element with the
/// resolved label (web `aria-label`), an open hint, and the help text as its hint (web `aria-describedby`).
struct HelpIconTrigger: View {
    @Bindable var model: HelpIconModel

    @State private var isHovering = false

    private var projection: HelpIconProjection {
        model.projection
    }

    var body: some View {
        Button(action: model.present) {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 13, weight: .regular))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(isHovering ? Color.TS.textSecondary : Color.TS.textMuted)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(.leading, TSSpacing.xs)
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityHint(Text(verbatim: projection.text))
        .accessibilityAddTraits(.isButton)
        .modifier(HelpIconHoverTip(text: projection.text))
        .popover(isPresented: $model.isPresented, arrowEdge: projection.side.arrowEdge) {
            HelpIconPopover(text: projection.text, describedByID: projection.describedByID)
                .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Help bubble (web `<Tooltip content>` body)

/// The revealed help bubble — the native peer of the web tooltip body: the resolved help copy on a padded,
/// width-capped surface. Wrapped in the shared fade-in for entrance polish (the native peer of the web
/// tooltip's fade), which honors Reduce Motion. When a `for` field id is present the body carries the
/// `\(for)-help` accessibility identifier (the native peer of the web `aria-describedby` target).
struct HelpIconPopover: View {
    let text: String
    let describedByID: String?

    var body: some View {
        TSFadeIn {
            bubble
        }
    }

    @ViewBuilder
    private var bubble: some View {
        let base = Text(verbatim: text)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(TSSpacing.md)
            .frame(maxWidth: 260, alignment: .leading)
            .accessibilityAddTraits(.isStaticText)
        if let describedByID {
            base.accessibilityIdentifier(describedByID)
        } else {
            base
        }
    }
}
