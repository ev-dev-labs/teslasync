//
//  Layout.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The public API of the app shell — the SwiftUI parity of `components/layout/Layout.tsx`. The web `Layout`
//  is the application chrome: a grouped navigation sidebar (the `navSections` catalog with pinned / recent /
//  active-card / collapsible sections + per-item count badges), a header (brand + quick theme switcher +
//  notification bell), the routed `<Outlet>` content region, and the status-bar + banner/modal composition
//  slots (each its own surface). The native peer reproduces the shell's unique responsibility — the
//  navigation chrome + header + content region + every P4 leaf state — and binds through ``LayoutModel``
//  (P1/S8); no networking lives in the view.
//
//  Adaptive layout: at regular width the sidebar is a permanent column beside the content (iPad/macOS HIG);
//  at compact width it collapses behind the header bar's menu toggle as a drawer (iPhone HIG). Every state
//  renders — loading skeleton chrome, the navigation body, the empty-navigation state, the error retry tile —
//  plus the orthogonal freshness chip (stale auto-refresh once / offline keeps the cached chrome).
//

import SwiftUI

// MARK: - Layout (the shared surface)

/// The app-shell surface — the SwiftUI parity of `Layout.tsx`. Renders every state, binding through
/// ``LayoutModel``. The routed content (web `<Outlet>`) is supplied by the host as the `content` slot.
public struct LayoutShell<DetailContent: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LayoutSurface.slug
    }

    @State private var model: LayoutModel
    @State private var sidebarVisible = false
    private let onCustomizeTheme: () -> Void
    private let onOpenNotifications: () -> Void
    private let detail: () -> DetailContent

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    public init(
        model: LayoutModel,
        onCustomizeTheme: @escaping () -> Void = {},
        onOpenNotifications: @escaping () -> Void = {},
        @ViewBuilder content: @escaping () -> DetailContent
    ) {
        _model = State(initialValue: model)
        self.onCustomizeTheme = onCustomizeTheme
        self.onOpenNotifications = onOpenNotifications
        detail = content
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting `<Layout>`
    /// with the production shell source + a navigation callback. The host implements `source` over the shared
    /// shell state holders and routes `onSelect` to the navigation stack (the native peer of `<NavLink to>`).
    public init(
        source: any LayoutSource,
        onSelect: @escaping @MainActor (String) -> Void = { _ in },
        onCustomizeTheme: @escaping () -> Void = {},
        onOpenNotifications: @escaping () -> Void = {},
        telemetry: any LayoutTelemetry = OSLogLayoutTelemetry(),
        @ViewBuilder content: @escaping () -> DetailContent
    ) {
        _model = State(initialValue: LayoutModel(source: source, onSelect: onSelect, telemetry: telemetry))
        self.onCustomizeTheme = onCustomizeTheme
        self.onOpenNotifications = onOpenNotifications
        detail = content
    }

    public var body: some View {
        GeometryReader { geo in
            Group {
                if geo.size.width < 700 {
                    compactLayout
                } else {
                    regularLayout
                }
            }
        }
        .background(Color.TS.bg)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Layouts

    private var regularLayout: some View {
        HStack(spacing: 0) {
            sidebarColumn
                .frame(width: 280)
            Divider().overlay(Color.TS.border)
            contentRegion
        }
    }

    private var compactLayout: some View {
        VStack(spacing: 0) {
            LayoutHeaderBar(
                unread: model.unreadAlerts,
                onOpenSidebar: { sidebarVisible = true },
                onCustomizeTheme: onCustomizeTheme,
                onOpenNotifications: onOpenNotifications
            )
            contentRegion
        }
        .overlay { compactDrawer }
    }

    @ViewBuilder private var compactDrawer: some View {
        if sidebarVisible {
            ZStack(alignment: .leading) {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture { sidebarVisible = false }
                    .accessibilityLabel(Text(verbatim: LayoutStrings.navCloseSidebar))
                sidebarColumn
                    .frame(width: 280)
                    .transition(.move(edge: .leading))
            }
        }
    }

    // MARK: Regions

    private var sidebarColumn: some View {
        VStack(spacing: 0) {
            LayoutSidebarHeader(
                unread: model.unreadAlerts,
                onCustomizeTheme: onCustomizeTheme,
                onOpenNotifications: onOpenNotifications
            )
            ScrollView { phaseContent }
            if model.connection != .live {
                LayoutShellFreshnessChip(connection: model.connection) { model.refresh() }
                    .padding(TSSpacing.sm)
            }
        }
        .background(Color.TS.surface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LayoutStrings.a11yPrimaryNav))
    }

    private var contentRegion: some View {
        LayoutContentRegion(showHint: model.projection.activeEntry != nil) {
            detail()
        }
    }

    @ViewBuilder private var phaseContent: some View {
        switch model.phase {
        case .loading:
            LayoutLoadingView()
        case .content:
            LayoutSidebarBody(model: model)
        case .empty:
            LayoutEmptyView()
        case let .error(message):
            LayoutErrorView(message: message) { model.refresh() }
        }
    }
}

// MARK: - Default content slot

/// A self-contained content slot for standalone use (previews / tests) — the host normally supplies the
/// routed page here (web `<Outlet>`).
public struct LayoutContentSlot: View {
    public init() {}

    public var body: some View {
        TSGlassPanel {
            Text(verbatim: LayoutStrings.contentSlot)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

public extension LayoutShell where DetailContent == LayoutContentSlot {
    /// Injected-model convenience that renders the default content slot.
    init(
        model: LayoutModel,
        onCustomizeTheme: @escaping () -> Void = {},
        onOpenNotifications: @escaping () -> Void = {}
    ) {
        self.init(
            model: model,
            onCustomizeTheme: onCustomizeTheme,
            onOpenNotifications: onOpenNotifications
        ) { LayoutContentSlot() }
    }

    /// Source convenience that renders the default content slot.
    init(
        source: any LayoutSource,
        onSelect: @escaping @MainActor (String) -> Void = { _ in },
        onCustomizeTheme: @escaping () -> Void = {},
        onOpenNotifications: @escaping () -> Void = {},
        telemetry: any LayoutTelemetry = OSLogLayoutTelemetry()
    ) {
        self.init(
            source: source,
            onSelect: onSelect,
            onCustomizeTheme: onCustomizeTheme,
            onOpenNotifications: onOpenNotifications,
            telemetry: telemetry
        ) { LayoutContentSlot() }
    }
}
