//
//  ScrollRestoration.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  The shared surface entry point — the SwiftUI parity of components/layout/ScrollRestoration.tsx. The
//  web component renders `return null`: mounted once near the router root, it listens to the current
//  location + navigation type and moves the scroll position of the layout's scroll container. SwiftUI
//  cannot reach into a global scroll view, so the surface is faithfully split across two cooperating
//  pieces that SHARE one ``ScrollRestorationModel``:
//
//    • ``ScrollRestoration`` (this file) — the transparent companion. It renders nothing visible (the
//      faithful peer of `return null`), is mounted once near the app/router root, emits `view.opened`
//      once, and drives the navigation seam: it observes the ``ScrollRestorationSource`` (the native
//      `useLocation()` + `useNavigationType()`) and runs the restore decision on every route change.
//    • ``SwiftUI/View/scrollRestoration(_:)`` (Views file) — attached to the primary `ScrollView`,
//      it performs the scroll operations: saving the live offset and applying the restore target.
//
//  Mount the companion ONCE and pass its ``restorationModel`` to the modifier on the primary scroll
//  view; mounting two companions over one model would double the navigation writes (the same caution the
//  web component documents).
//

import SwiftUI

// MARK: - ScrollRestoration (transparent companion — web `return null`)

/// The transparent scroll-restoration companion — the SwiftUI parity of `<ScrollRestoration/>`. It
/// renders nothing visible (faithful to the web `return null`), emits `view.opened` once, and drives the
/// restore decision on every navigation by observing the bound ``ScrollRestorationSource``. Pair it with
/// ``SwiftUI/View/scrollRestoration(_:)`` on the primary scroll view, passing the same model.
public struct ScrollRestoration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ScrollRestorationSurface.slug

    @State private var model: ScrollRestorationModel

    /// Designated initializer binding a pre-built model — the composition root builds one
    /// ``ScrollRestorationModel`` over the app router source and hands it to BOTH the companion and the
    /// ``SwiftUI/View/scrollRestoration(_:)`` modifier, so saves + restores share one session store + key.
    public init(model: ScrollRestorationModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<ScrollRestoration/>`. Supply the ``ScrollRestorationSource`` (the native `useLocation()` +
    /// `useNavigationType()`); the session store + telemetry default to the production implementations.
    /// Read ``restorationModel`` afterwards to share the model with the scroll-view modifier.
    public init(
        source: any ScrollRestorationSource,
        store: any ScrollPositionStore = SessionScrollPositionStore(),
        telemetry: any ScrollRestorationTelemetry = OSLogScrollRestorationTelemetry()
    ) {
        _model = State(initialValue: ScrollRestorationModel(
            source: source,
            store: store,
            telemetry: telemetry
        ))
    }

    /// The shared model this companion drives — pass it to ``SwiftUI/View/scrollRestoration(_:)`` on the
    /// primary scroll view so the saved offsets and the restore target share one session store + key.
    public var restorationModel: ScrollRestorationModel {
        model
    }

    public var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear {
                model.markAppeared()
                model.onNavigation()
            }
            .onChange(of: model.currentLocationKey) {
                model.onNavigation()
            }
    }
}
