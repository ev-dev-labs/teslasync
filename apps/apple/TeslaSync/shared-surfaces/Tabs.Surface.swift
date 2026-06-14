//
//  Tabs.Surface.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  The public API of the accessible tab strip — the SwiftUI parity of `components/ui/Tabs.tsx`. Like the
//  web component it is driven entirely by its props (`tabs`, `activeTab`, `onChange`, `ariaLabel`); there
//  is no fetcher. It renders a horizontal strip of tabs with a hairline baseline and an accent underline on
//  the active tab, reports activation through `onChange` (the parent owns the active-tab state), and — like
//  the web — does NOT own the tab panels: a consumer renders its content beside the strip and can wire it
//  back to the active tab through ``TabsController/panelID(forKey:)``. The view binds through
//  ``TabsController`` for the once-only `view.opened` telemetry (P1/S11), composes the token-driven chrome
//  via ``TabsStrip`` (P1/S9), and pushes prop changes into the controller via `.onChange` so a reused
//  control re-renders faithfully. No networking and no Tailwind ports live in the view.
//

import SwiftUI

/// The accessible tab strip — the SwiftUI parity of `components/ui/Tabs.tsx`. Renders the tabs as a
/// horizontal strip (selected tab in the accent tone with a 2pt underline; others muted with a hover
/// brighten; disabled tabs dimmed and non-interactive), reports activation through `onChange`, and supports
/// roving focus with automatic-activation Left/Right/Home/End keyboard navigation. An empty `tabs` array
/// renders a friendly localized empty-state message rather than a blank box. Reusable wherever a controlled tab
/// strip is needed; the consumer renders the matching panel content separately.
public struct Tabs: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        TabsSurface.slug
    }

    private let input: TabsInput
    @State private var controller: TabsController

    /// The prop-style initializer — the parity of `<Tabs tabs activeTab onChange ariaLabel />`. `tabs` are
    /// the ordered descriptors; `activeTab` is the selected key; `ariaLabel` names the tablist for
    /// VoiceOver; `onChange` reports an activation (tap or keyboard).
    public init(
        tabs: [TabItem],
        activeTab: String,
        ariaLabel: String? = nil,
        onChange: @escaping (String) -> Void,
        telemetry: any TabsTelemetry = OSLogTabsTelemetry()
    ) {
        let resolved = TabsInput(tabs: tabs, activeTab: activeTab, ariaLabel: ariaLabel)
        input = resolved
        _controller = State(initialValue: TabsController(
            input: resolved,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built controller — the host / preview / test seam (a spy telemetry, a deterministic
    /// resolver, a seeded input + recording `onChange`).
    public init(controller: TabsController) {
        input = controller.input
        _controller = State(initialValue: controller)
    }

    public var body: some View {
        TabsStrip(controller: controller)
            .onAppear { controller.start() }
            .onDisappear { controller.stop() }
            .onChange(of: input) { _, newInput in
                controller.update(newInput)
            }
    }
}
