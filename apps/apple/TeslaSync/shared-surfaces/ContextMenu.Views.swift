//
//  ContextMenu.Views.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  The presentational pieces of the contextual action menu — the native peers of the web elements: the
//  portal-rendered host overlay (web `ContextMenuRoot` + `createPortal`), the floating menu panel (web the
//  `role="menu"` container `<div>` + `<ul>`), one menu row (web the `role="menuitem"` `<button>`), and the
//  friendly empty body (native — the web silently refuses to open an empty menu). All chrome is token-driven
//  (P1/S9): the panel is a system material clipped to the menu radius with the semantic hairline border and
//  an elevation shadow (web `bg-[var(--surface-elevated)] border-[var(--glass-border)] rounded-lg
//  shadow-xl`); a highlighted row fills with the brand accent — or the danger color when destructive — and
//  flips its content to read on the fill (the HIG-idiomatic menu highlight, the native peer of the web
//  hover / focus tint). No raw hex, no Tailwind ports. The panel is one VoiceOver container named "Context
//  menu" (web `aria-label`); each row is one button labelled by its text, carrying a destructive /
//  unavailable value where it applies; the icon + shortcut glyphs are decorative and hidden from VoiceOver
//  (web `aria-hidden`). Placement reproduces the web measure-and-flip via the pure projector; the hardware
//  -keyboard contract (Arrow / Home / End / Return / Space / Tab / Escape) is wired through `.onKeyPress`.
//

import SwiftUI

// MARK: - ContextMenuOverlay (web `ContextMenuRoot` portal host)

/// The host overlay — the native peer of the web `ContextMenuRoot` rendering the menu through a portal on
/// `document.body`. Mounted once over the app content by the ``ContextMenu`` surface, it watches the
/// ``ContextMenuController`` and, when a menu is open, lays a transparent dismiss backdrop (web the
/// document `pointerdown`-to-close listener) under the floating ``ContextMenuPanel``. The panel is measured
/// with `onGeometryChange` and positioned by the pure
/// ``ContextMenuProjector/place(anchor:menuSize:containerSize:margin:)`` so it flips off any overflowing
/// edge, exactly as the web `useLayoutEffect` corrects `left` / `top` after the first measured layout.
struct ContextMenuOverlay: View {
    let controller: ContextMenuController
    let reduceMotion: Bool

    @State private var menuSize: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            if let presentation = controller.presentation {
                ZStack(alignment: .topLeading) {
                    dismissBackdrop

                    ContextMenuPanel(controller: controller, reduceMotion: reduceMotion)
                        .fixedSize()
                        .onGeometryChange(for: CGSize.self, of: { $0.size }, action: { menuSize = $0 })
                        .offset(origin(for: presentation, container: proxy.size))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .transition(.opacity)
            }
        }
        .ignoresSafeArea()
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: controller.presentation?.nonce)
    }

    /// The tap-outside-to-close layer (web the document `pointerdown` listener that closes on an outside
    /// click). Transparent but hit-testable; a single VoiceOver button named "Dismiss menu".
    private var dismissBackdrop: some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { controller.close() }
            .accessibilityLabel(Text(verbatim: ContextMenuStrings.dismiss))
            .accessibilityAddTraits(.isButton)
    }

    /// The flipped top-leading origin for the current open, recomputed whenever the measured menu size or
    /// the container changes (web the measure-and-flip pass).
    private func origin(for presentation: ContextMenuPresentation, container: CGSize) -> CGSize {
        let point = ContextMenuProjector.place(
            anchor: presentation.anchor,
            menuSize: menuSize,
            containerSize: container
        )
        return CGSize(width: point.x, height: point.y)
    }
}

// MARK: - ContextMenuPanel (web `role="menu"` container)

/// The floating menu panel — the native peer of the web `role="menu"` container `<div>` + its `<ul>`. It
/// renders one ``ContextMenuRowView`` per open action (or the friendly empty body when asked to render with
/// no rows), over a system material clipped to the menu radius with the hairline border and elevation
/// shadow. The panel is focusable so a hardware keyboard drives it: Arrow Down / Up move the highlight
/// across enabled rows (wrapping, skipping disabled), Home / End jump to the first / last, Return / Space
/// invoke the highlighted row, and Tab / Escape close — the verbatim port of the web container key handler.
/// It is one VoiceOver container named "Context menu".
struct ContextMenuPanel: View {
    let controller: ContextMenuController
    let reduceMotion: Bool

    @FocusState private var isPanelFocused: Bool

    var body: some View {
        rows
            .padding(ContextMenuLayout.containerPadding)
            .frame(
                minWidth: ContextMenuLayout.minWidth,
                maxWidth: ContextMenuLayout.maxWidth,
                alignment: .leading
            )
            .background(
                TSMaterial.panel,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .shadow(color: .black.opacity(0.25), radius: 16, x: 0, y: 8)
            .focusable()
            .focused($isPanelFocused)
            .onAppear { isPanelFocused = true }
            .onChange(of: controller.presentation?.nonce) { _, _ in isPanelFocused = true }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: ContextMenuStrings.menuLabel))
            .onKeyPress(.downArrow) { controller.moveFocus(step: 1); return .handled }
            .onKeyPress(.upArrow) { controller.moveFocus(step: -1); return .handled }
            .onKeyPress(.home) { controller.focusFirst(); return .handled }
            .onKeyPress(.end) { controller.focusLast(); return .handled }
            .onKeyPress(.return) { controller.invokeFocused(); return .handled }
            .onKeyPress(.space) { controller.invokeFocused(); return .handled }
            .onKeyPress(.tab) { controller.close(); return .handled }
            .onKeyPress(.escape) { controller.close(); return .handled }
    }

    @ViewBuilder private var rows: some View {
        let descriptors = controller.descriptors
        if descriptors.isEmpty {
            ContextMenuEmptyView()
        } else {
            VStack(alignment: .leading, spacing: ContextMenuLayout.rowSpacing) {
                ForEach(descriptors) { descriptor in
                    ContextMenuRowView(
                        descriptor: descriptor,
                        isHighlighted: controller.focusedActionID == descriptor.id
                    ) {
                        controller.invoke(id: descriptor.id)
                    }
                }
            }
        }
    }
}

// MARK: - ContextMenuRowView (web `role="menuitem"` button)

/// One menu row — the native peer of the web `role="menuitem"` `<button>`: an optional leading SF Symbol
/// glyph (web `item.icon`), the inline label (web `item.label`), and an optional trailing shortcut hint
/// (web `item.shortcut`). A highlighted, enabled row fills with the brand accent — or the danger color when
/// destructive — and flips its content to read on the fill (the HIG menu highlight, the native peer of the
/// web hover / focus tint + the destructive rose tint); a disabled row reads muted and is non-interactive
/// (web `disabled` + `aria-disabled`). The glyphs are decorative (hidden from VoiceOver); the row is one
/// button labelled by its text, with a "Destructive" / "Unavailable" VoiceOver value where it applies.
struct ContextMenuRowView: View {
    let descriptor: ContextMenuItemDescriptor
    let isHighlighted: Bool
    let onInvoke: () -> Void

    private var isActiveHighlight: Bool {
        isHighlighted && !descriptor.isDisabled
    }

    var body: some View {
        Button(action: onInvoke) {
            HStack(spacing: ContextMenuLayout.rowContentGap) {
                leadingGlyph
                Text(verbatim: descriptor.label)
                    .font(Font.TS.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                trailingShortcut
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, ContextMenuLayout.rowPaddingH)
            .padding(.vertical, ContextMenuLayout.rowPaddingV)
            .frame(minHeight: ContextMenuLayout.rowMinHeight)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowFill, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(descriptor.isDisabled)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: descriptor.label))
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    @ViewBuilder private var leadingGlyph: some View {
        if let systemImage = descriptor.systemImage {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .medium))
                .frame(width: ContextMenuLayout.iconSide, height: ContextMenuLayout.iconSide)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder private var trailingShortcut: some View {
        if let shortcut = descriptor.shortcut {
            Text(verbatim: shortcut)
                .font(.system(size: ContextMenuLayout.shortcutFontSize, weight: .medium))
                .textCase(.uppercase)
                .foregroundStyle(shortcutColor)
                .accessibilityHidden(true)
        }
    }

    private var foreground: Color {
        if descriptor.isDisabled { return Color.TS.textMuted }
        if isActiveHighlight { return .white }
        if descriptor.isDestructive { return Color.TS.statusDanger }
        return Color.TS.textPrimary
    }

    private var rowFill: Color {
        guard isActiveHighlight else { return .clear }
        return descriptor.isDestructive ? Color.TS.statusDanger : Color.TS.accent
    }

    private var shortcutColor: Color {
        if descriptor.isDisabled { return Color.TS.textMuted }
        if isActiveHighlight { return .white.opacity(0.8) }
        return Color.TS.textMuted
    }

    private var accessibilityValue: String {
        if descriptor.isDisabled { return ContextMenuStrings.unavailable }
        if descriptor.isDestructive { return ContextMenuStrings.destructive }
        return ""
    }
}

// MARK: - ContextMenuEmptyView (native — never a blank box)

/// The friendly body shown when a menu is asked to render with no rows. The web silently refuses to open an
/// empty menu; the native HIG calls for a labelled empty body rather than a blank box. One combined
/// VoiceOver element; the leading glyph is decorative and hidden from assistive technology.
struct ContextMenuEmptyView: View {
    var body: some View {
        HStack(spacing: ContextMenuLayout.rowContentGap) {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ContextMenuStrings.empty)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, ContextMenuLayout.rowPaddingH)
        .padding(.vertical, ContextMenuLayout.rowPaddingV)
        .frame(minHeight: ContextMenuLayout.rowMinHeight)
        .accessibilityElement(children: .combine)
    }
}
