//
//  ChartExportMenu.swift
//  TeslaSync — P4 shared surface · 0066 · ChartExportMenu (Apple)
//
//  The chart-export overflow menu — the SwiftUI parity of `components/charts/ChartExportMenu.tsx`.
//  A single Download-icon trigger that opens a native `Menu` of export actions ("Download data as
//  CSV" / "Save as PNG" / "Save as SVG" / "Copy image to clipboard"), for embedding in a chart
//  container's title-bar action area. The web component hand-rolls a popover with outside-click /
//  Escape dismissal and `role="menu"` semantics; the native parity uses SwiftUI's `Menu`, which is
//  the HIG-idiomatic counterpart — it provides the pop-up button trait, keyboard activation, and
//  outside-tap / Escape dismissal for free, so we reproduce the behaviour without porting the web
//  open-state plumbing.
//
//  Binds through `ChartExportMenuModel` (the `@MainActor` owner of the host export callbacks +
//  optional toast); no networking and no side-effecting `Task` plumbing live in the view. Renders
//  every web branch: the disabled trigger (label switches + the menu cannot open), the `busy`
//  gating of the snapshot-dependent items, and the optional CSV lead item. Emits `view.opened`
//  once on first appearance (P1/S11).
//

import SwiftUI

// MARK: - ChartExportMenu (the shared surface)

/// The chart-export overflow menu — the SwiftUI parity of `components/charts/ChartExportMenu.tsx`.
/// A Download-icon `Menu` trigger over the export actions, binding through `ChartExportMenuModel`.
public struct ChartExportMenu: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChartExportMenuMeta.surfaceSlug

    @State private var model: ChartExportMenuModel
    private let disabled: Bool
    private let busy: Bool

    /// Designated initializer binding a pre-built action model. `disabled` makes the trigger inert
    /// (the menu cannot open); `busy` disables the snapshot-dependent items while a capture is in
    /// flight (web `disabled` / `busy` props).
    public init(model: ChartExportMenuModel, disabled: Bool = false, busy: Bool = false) {
        _model = State(initialValue: model)
        self.disabled = disabled
        self.busy = busy
    }

    /// Convenience initializer wiring the host export callbacks directly — the parity of mounting
    /// `<ChartExportMenu onExportPNG={…} onExportSVG={…} onCopyImage={…} onExportCsv={…} />`. Supply
    /// a `toast` presenter (the native `useOptionalToast`) to announce copy outcomes; pass `nil` to
    /// degrade gracefully. `onExportCsv` is optional — when present the CSV item leads the menu.
    public init(
        onExportPNG: @escaping @MainActor () async -> Void,
        onExportSVG: @escaping @MainActor () async -> Void,
        onCopyImage: @escaping @MainActor () async -> ChartExportClipboardOutcome,
        onExportCsv: (@MainActor () -> Void)? = nil,
        disabled: Bool = false,
        busy: Bool = false,
        toast: (any ChartExportMenuToastPresenter)? = nil,
        telemetry: any ChartExportMenuTelemetry = OSLogChartExportMenuTelemetry()
    ) {
        _model = State(initialValue: ChartExportMenuModel(
            onExportPNG: onExportPNG,
            onExportSVG: onExportSVG,
            onCopyImage: onCopyImage,
            onExportCsv: onExportCsv,
            toast: toast,
            telemetry: telemetry
        ))
        self.disabled = disabled
        self.busy = busy
    }

    private var items: [ChartExportMenuItem] {
        ChartExportMenuLogic.menuItems(hasCsv: model.hasCsv, busy: busy)
    }

    private var triggerLabel: String {
        ChartExportMenuStrings.triggerLabel(disabled: disabled)
    }

    public var body: some View {
        Menu {
            ForEach(items) { item in
                ChartExportMenuItemButton(item: item) {
                    model.perform(item.action)
                }
            }
        } label: {
            ChartExportMenuTriggerLabel(disabled: disabled)
        }
        .menuIndicator(.hidden)
        .disabled(disabled)
        .accessibilityLabel(Text(verbatim: triggerLabel))
        .onAppear { model.markAppeared() }
    }
}
