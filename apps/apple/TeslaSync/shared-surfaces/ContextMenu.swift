//
//  ContextMenu.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  The public API of the app-global contextual action menu — the SwiftUI parity of
//  `components/ui/ContextMenu.tsx`. The web source exposes three things: a module-level store
//  (`useSyncExternalStore`), a portal host mounted once (`ContextMenuRoot`), and a hook callers bind to
//  triggers (`useContextMenu`). The native peers are: the `@Observable` ``ContextMenuController`` (the
//  store — see ContextMenu.Model.swift), the ``ContextMenu`` host below (mounted once over the app content,
//  the `ContextMenuRoot` parity), and the ``SwiftUI/View/teslaSyncContextMenu(_:controller:)`` trigger
//  modifier (the `useContextMenu().contextMenuProps` parity). The host binds through the controller for the
//  once-only `view.opened` telemetry (P1/S11), overlays the floating menu via ``ContextMenuOverlay``, and
//  defines the named coordinate space the triggers report their open point into so the measure-and-flip
//  placement lands the menu under the press — exactly as the web opens at the right-click `clientX` /
//  `clientY`. No networking, no Tailwind ports.
//
//  Web right-click → native press: TeslaSync had no right-click affordance on the web either (the source's
//  own preamble notes "right-click is unused"); the platform-idiomatic peer of "summon a contextual menu at
//  a point" is a long-press on touch and a secondary-click on the desktop. The trigger modifier wires that
//  press, captures its location in the host's coordinate space, and opens the controller there. Hosts that
//  resolve their items lazily (web `useContextMenu(() => buildItems())`) use the provider overload.
//

import SwiftUI

// MARK: - Coordinate space

/// The named coordinate space the ``ContextMenu`` host defines and the triggers report their open point
/// into, so a captured press location and the overlay's placement math share one origin (web the viewport
/// coordinate space the right-click `clientX` / `clientY` live in).
enum ContextMenuSpace {
    static let name = "TeslaSyncContextMenu"
}

// MARK: - ContextMenu host (web `ContextMenuRoot`)

/// The contextual-menu host — the SwiftUI parity of the web `ContextMenuRoot` mounted once near the top of
/// the tree. Wrap the app content in it once: it renders the content, overlays the floating menu whenever
/// the bound ``ContextMenuController`` has an open presentation, and defines the coordinate space triggers
/// open into. The default host binds the app-global ``ContextMenuController/shared`` (the web module-store
/// parity); previews and tests inject their own controller. Emits `view.opened` once on first appear.
@MainActor
public struct ContextMenu<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ContextMenuSurface.slug
    }

    private let controller: ContextMenuController
    private let content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Wraps app content in the contextual-menu host. `controller` defaults to the app-global shared store
    /// (the web module-level store parity); inject a dedicated instance in previews / tests.
    public init(
        controller: ContextMenuController = .shared,
        @ViewBuilder content: () -> Content
    ) {
        self.controller = controller
        self.content = content()
    }

    public var body: some View {
        content
            .overlay {
                ContextMenuOverlay(controller: controller, reduceMotion: reduceMotion)
            }
            .coordinateSpace(.named(ContextMenuSpace.name))
            .onAppear { controller.start() }
            .onDisappear { controller.stop() }
    }
}

// MARK: - Trigger modifier (web `useContextMenu().contextMenuProps`)

/// Attaches the contextual-menu trigger to a view — the native peer of spreading the web
/// `useContextMenu().contextMenuProps` (`onContextMenu`) onto an element. A long-press (touch) / secondary
/// press (desktop) captures its location in the host's coordinate space and opens the bound controller
/// there with the resolved actions. An empty action list is refused by the controller (web
/// `openContextMenu` early-return).
struct ContextMenuTrigger: ViewModifier {
    let controller: ContextMenuController
    let provider: () -> [ContextMenuAction]

    func body(content: Content) -> some View {
        content.simultaneousGesture(pressThenLocate)
    }

    private var pressThenLocate: some Gesture {
        LongPressGesture(minimumDuration: 0.4)
            .sequenced(
                before: DragGesture(minimumDistance: 0, coordinateSpace: .named(ContextMenuSpace.name))
            )
            .onEnded { value in
                if case let .second(_, drag?) = value {
                    controller.open(provider(), at: drag.location)
                }
            }
    }
}

public extension View {
    /// Opens a contextual menu of `actions` on a long-press / secondary press — the native peer of binding
    /// the web `useContextMenu(items).contextMenuProps`. The menu is hosted by the nearest enclosing
    /// ``ContextMenu`` host; `controller` defaults to the shared store.
    @MainActor
    func teslaSyncContextMenu(
        _ actions: [ContextMenuAction],
        controller: ContextMenuController = .shared
    ) -> some View {
        modifier(ContextMenuTrigger(controller: controller, provider: { actions }))
    }

    /// Opens a contextual menu whose `actions` are resolved lazily at press time — the native peer of the
    /// web `useContextMenu(() => buildItems())` getter form, for menus whose rows depend on the pressed
    /// target. `controller` defaults to the shared store.
    @MainActor
    func teslaSyncContextMenu(
        controller: ContextMenuController = .shared,
        actions provider: @escaping () -> [ContextMenuAction]
    ) -> some View {
        modifier(ContextMenuTrigger(controller: controller, provider: provider))
    }
}
