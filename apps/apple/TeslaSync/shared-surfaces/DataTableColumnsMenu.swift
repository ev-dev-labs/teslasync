//
//  DataTableColumnsMenu.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  The public API of the table column-visibility menu — the SwiftUI parity of
//  `components/ui/DataTableColumnsMenu.tsx`. The web source is an icon-button trigger plus a popover that
//  opens on click and dismisses on click-outside / Escape; the native peer is ``DataTableColumnsMenu``: the
//  trigger view bound to the ``DataTableColumnsMenuController`` (the web `open` state + `onChange` callback),
//  presenting the floating ``DataTableColumnsMenuPanel`` through a `.popover` — the HIG-idiomatic peer of the
//  web absolute-positioned dropdown, which dismisses on tap-outside / Escape for free on both idioms and
//  stays a popover (not a sheet) in compact width via `.presentationCompactAdaptation(.popover)`. The default
//  trigger is the web "Columns" chip (a split-rectangle glyph + the label); callers that pass a custom
//  trigger get the web `trigger?: (open) => ReactNode` escape hatch. The surface binds through the controller
//  for the once-only `view.opened` telemetry (P1/S11). No networking, no Tailwind ports.
//

import SwiftUI

// MARK: - DataTableColumnsMenu (web component root)

/// The column-visibility menu — the SwiftUI parity of the web `<DataTableColumnsMenu>`. It renders a trigger
/// (the default "Columns" chip, or a caller-supplied one — the web `trigger` prop) and presents the floating
/// ``DataTableColumnsMenuPanel`` in a `.popover` when the bound ``DataTableColumnsMenuController`` is open.
/// The controller owns the selection + popover state and mirrors changes to the host; this view is
/// presentation only. Emits `view.opened` once on first appear.
@MainActor
public struct DataTableColumnsMenu<Trigger: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DataTableColumnsMenuSurface.slug
    }

    private let controller: DataTableColumnsMenuController
    private let trigger: (DataTableColumnsMenuController) -> Trigger

    /// Creates the menu with a caller-supplied trigger — the native peer of the web `trigger?: (open) =>
    /// ReactNode` prop. The trigger receives the controller so it can toggle the popover
    /// (``DataTableColumnsMenuController/toggleMenu()``) and reflect its label.
    public init(
        controller: DataTableColumnsMenuController,
        @ViewBuilder trigger: @escaping (DataTableColumnsMenuController) -> Trigger
    ) {
        self.controller = controller
        self.trigger = trigger
    }

    public var body: some View {
        @Bindable var bindable = controller
        return trigger(controller)
            .popover(isPresented: $bindable.isOpen, attachmentAnchor: .point(.bottom), arrowEdge: .top) {
                DataTableColumnsMenuPanel(controller: controller)
                    .presentationCompactAdaptation(.popover)
            }
            .onAppear { controller.start() }
            .onDisappear { controller.stop() }
    }
}

// MARK: - Default trigger (web "Columns" chip)

public extension DataTableColumnsMenu where Trigger == DataTableColumnsMenuTriggerButton {
    /// Creates the menu with the default "Columns" trigger chip — the web default `<button>` (a
    /// split-rectangle glyph + the "Columns" label, accessible-named "Show or hide columns").
    init(controller: DataTableColumnsMenuController) {
        self.init(controller: controller) { DataTableColumnsMenuTriggerButton(controller: $0) }
    }
}

/// The default trigger chip — the native peer of the web default `<button>`: a leading split-rectangle
/// "columns" glyph (web `Columns3`, decorative) + the visible "Columns" label (web `t('table.columns.button',
/// 'Columns')`), over a hairline-bordered glass chip. Toggling it opens / closes the popover (web
/// `onClick={() => setOpen((v) => !v)}`). One VoiceOver button named "Show or hide columns" (web
/// `aria-label={t('table.columns.menu', …)}`).
public struct DataTableColumnsMenuTriggerButton: View {
    let controller: DataTableColumnsMenuController

    public init(controller: DataTableColumnsMenuController) {
        self.controller = controller
    }

    public var body: some View {
        Button(action: controller.toggleMenu) {
            HStack(spacing: DataTableColumnsMenuLayout.triggerGap) {
                Image(systemName: "rectangle.split.3x1")
                    .font(.system(size: DataTableColumnsMenuLayout.iconSide, weight: .medium))
                    .accessibilityHidden(true)
                Text(verbatim: DataTableColumnsMenuStrings.button)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, DataTableColumnsMenuLayout.triggerPaddingH)
            .padding(.vertical, DataTableColumnsMenuLayout.triggerPaddingV)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: controller.menuLabel))
    }
}
