//
//  Toast.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The public API of the transient toast surface — the SwiftUI parity of the web `ToastProvider` in
//  `components/feedback/Toast.tsx`. The web source exposes three things: a context provider mounted once
//  (`ToastProvider`), a hook callers read to post toasts (`useToast`), and a non-throwing variant
//  (`useOptionalToast`). The native peers are: the ``ToastHost`` below (mounted once over the app content,
//  the `ToastProvider` parity — it injects the ``ToastCenter`` into the environment and overlays the toast
//  stack), `@Environment(ToastCenter.self)` (the `useToast()` parity — traps when no host is mounted, like
//  the hook throwing), and `@Environment(ToastCenter.self) var center: ToastCenter?` (the
//  `useOptionalToast()` parity — `nil` when no host is mounted). The host binds the ``ToastCenter`` for the
//  once-only `view.opened` telemetry (P1/S11) and overlays the floating stack bottom-trailing. No
//  networking, no Tailwind ports.
//
//  States (every branch the web source has renders — a transient client-only feedback layer has no fetch
//  lifecycle, so it carries no loading / stale / offline data states to fabricate):
//    • empty — no toasts → a transparent resting layer that passes touches straight through to the content
//      below (the web container's `pointer-events-none`), never a blank box.
//    • data  — one card per live toast, oldest-first, capped to five (web `toasts.map`).
//    • error — the `error`-kind card announces assertively (web `role="alert"`); the rest announce
//      politely (web `role="status"`).
//

import SwiftUI

// MARK: - ToastOverlay (web the fixed bottom-right toast container)

/// The floating toast stack — the native parity of the web fixed `bottom-4 right-4` container. Renders one
/// ``ToastRowView`` per live toast bottom-trailing, springs each in / out (fade-only under Reduce Motion),
/// and stays transparent to touches where there is no card so the content below remains interactive (web
/// `pointer-events-none` on the container, `pointer-events-auto` on each toast).
public struct ToastOverlay: View {
    private let center: ToastCenter
    private let onNavigate: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(center: ToastCenter, onNavigate: @escaping (String) -> Void = { _ in }) {
        self.center = center
        self.onNavigate = onNavigate
    }

    public var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.clear.allowsHitTesting(false)
            if !center.items.isEmpty {
                stack
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: center.items.count)
        .accessibilityElement(children: .contain)
    }

    /// The data render — one card per live toast, oldest-first (web `toasts.map`).
    private var stack: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.md) {
            ForEach(center.items) { item in
                ToastRowView(
                    item: item,
                    onNavigate: onNavigate,
                    onDismiss: { center.dismiss(id: item.id) }
                )
                .transition(transition)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .trailing)
    }

    private var transition: AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .trailing).combined(with: .opacity)
        )
    }
}

// MARK: - ToastHost (web `ToastProvider`)

/// The toast host — the SwiftUI parity of the web `ToastProvider` mounted once near the top of the tree.
/// Wrap the app content in it once: it injects the ``ToastCenter`` into the environment (so descendants
/// post toasts via `@Environment(ToastCenter.self)`, the `useToast()` parity), overlays the floating stack,
/// and emits `view.opened` once on first appear. The default host binds the app-global ``ToastCenter/shared``
/// (the single-provider parity); previews and tests inject their own center. `onNavigate` is the embedder's
/// router for a toast action's navigation path (the native peer of react-router resolving `<Link to=>`).
public struct ToastHost<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ToastSurface.slug
    }

    private let center: ToastCenter
    private let onNavigate: (String) -> Void
    private let content: Content

    public init(
        center: ToastCenter = .shared,
        onNavigate: @escaping (String) -> Void = { _ in },
        @ViewBuilder content: () -> Content
    ) {
        self.center = center
        self.onNavigate = onNavigate
        self.content = content()
    }

    public var body: some View {
        content
            .environment(center)
            .overlay {
                ToastOverlay(center: center, onNavigate: onNavigate)
            }
            .onAppear { center.start() }
            .onDisappear { center.stop() }
    }
}

// MARK: - Host modifier (web wrapping the app in `<ToastProvider>`)

public extension View {
    /// Mounts the toast host over this view — the native peer of wrapping the app in `<ToastProvider>`.
    /// Descendants post toasts through `@Environment(ToastCenter.self)` (the `useToast()` parity); the
    /// floating stack overlays bottom-trailing. `center` defaults to the app-global shared store, and
    /// `onNavigate` resolves a toast action's navigation path (web `<Link to=>`).
    func toastHost(
        center: ToastCenter = .shared,
        onNavigate: @escaping (String) -> Void = { _ in }
    ) -> some View {
        ToastHost(center: center, onNavigate: onNavigate) { self }
    }
}
