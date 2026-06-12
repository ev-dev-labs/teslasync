//
//  DataTableColumnMenu.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  The public API of the table column visibility + reorder menu — the SwiftUI parity of
//  `components/ui/DataTableColumnMenu.tsx`. The web source is an icon-button trigger plus a popover that
//  opens on click and dismisses on click-outside / Escape; the native peer is ``DataTableColumnMenu``: the
//  trigger view bound to the ``DataTableColumnMenuController`` (the web `open` state + `onChange` / `onReset`
//  callbacks), presenting the floating ``DataTableColumnMenuPanel`` through a `.popover` — the HIG-idiomatic
//  peer of the web absolute-positioned dropdown, which dismisses on tap-outside / Escape for free on both
//  idioms and stays a popover (not a sheet) in compact width via `.presentationCompactAdaptation(.popover)`.
//  The default trigger is the web "Columns" chip (a split-rectangle glyph + the label); callers that pass a
//  custom trigger get the web `trigger?: (open) => ReactNode` escape hatch. The surface binds through the
//  controller for the once-only `view.opened` telemetry (P1/S11). No networking, no Tailwind ports.
//

import SwiftUI

// MARK: - DataTableColumnMenu (web component root)

/// The column visibility + reorder menu — the SwiftUI parity of the web `<DataTableColumnMenu>`. It renders
/// a trigger (the default "Columns" chip, or a caller-supplied one — the web `trigger` prop) and presents
/// the floating ``DataTableColumnMenuPanel`` in a `.popover` when the bound ``DataTableColumnMenuController``
/// is open. The controller owns the layout + popover state and mirrors changes to the host; this view is
/// presentation only. Emits `view.opened` once on first appear.
@MainActor
public struct DataTableColumnMenu<Trigger: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DataTableColumnMenuSurface.slug
    }

    private let controller: DataTableColumnMenuController
    private let trigger: (DataTableColumnMenuController) -> Trigger

    /// Creates the menu with a caller-supplied trigger — the native peer of the web `trigger?: (open) =>
    /// ReactNode` prop. The trigger receives the controller so it can toggle the popover
    /// (``DataTableColumnMenuController/toggleMenu()``) and reflect its label.
    public init(
        controller: DataTableColumnMenuController,
        @ViewBuilder trigger: @escaping (DataTableColumnMenuController) -> Trigger
    ) {
        self.controller = controller
        self.trigger = trigger
    }

    public var body: some View {
        @Bindable var bindable = controller
        return trigger(controller)
            .popover(isPresented: $bindable.isOpen, attachmentAnchor: .point(.bottom), arrowEdge: .top) {
                DataTableColumnMenuPanel(controller: controller)
                    .presentationCompactAdaptation(.popover)
            }
            .onAppear { controller.start() }
            .onDisappear { controller.stop() }
    }
}

// MARK: - Default trigger (web "Columns" chip)

public extension DataTableColumnMenu where Trigger == DataTableColumnMenuTriggerButton {
    /// Creates the menu with the default "Columns" trigger chip — the web default `<button>` (a
    /// split-rectangle glyph + the "Columns" label, accessible-named by the reorder-aware trigger label).
    init(controller: DataTableColumnMenuController) {
        self.init(controller: controller) { DataTableColumnMenuTriggerButton(controller: $0) }
    }
}

/// The default trigger chip — the native peer of the web default `<button>`: a leading split-rectangle
/// "columns" glyph (web `Columns3`, decorative) + the visible "Columns" label (web `t('table.columns.button',
/// 'Columns')`), over a hairline-bordered glass chip. Toggling it opens / closes the popover (web
/// `onClick={() => setOpen((v) => !v)}`). One VoiceOver button named by the reorder-aware trigger label (web
/// `aria-label={triggerLabel}`).
public struct DataTableColumnMenuTriggerButton: View {
    let controller: DataTableColumnMenuController

    public init(controller: DataTableColumnMenuController) {
        self.controller = controller
    }

    public var body: some View {
        Button(action: controller.toggleMenu) {
            HStack(spacing: DataTableColumnMenuLayout.triggerGap) {
                Image(systemName: "rectangle.split.3x1")
                    .font(.system(size: DataTableColumnMenuLayout.iconSide, weight: .medium))
                    .accessibilityHidden(true)
                Text(verbatim: DataTableColumnMenuStrings.button)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, DataTableColumnMenuLayout.triggerPaddingH)
            .padding(.vertical, DataTableColumnMenuLayout.triggerPaddingV)
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
        .accessibilityLabel(Text(verbatim: controller.triggerLabel))
    }
}
