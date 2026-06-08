//
//  DashboardGrid.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  The SwiftUI parity of web/src/features/dashboard/components/DashboardGrid.tsx —
//  the composition surface that lays a saved dashboard's widgets onto a responsive
//  grid. Its only data source is the container width (web `useContainerWidth`),
//  natively a `GeometryReader`; it performs no I/O and renders each widget through
//  a parent-supplied builder (web `getWidgetDef(...).component`). It reproduces the
//  web breakpoint behaviour (absolute desktop grid ↔ full-width mobile stack), the
//  edit-mode chrome + dot-grid backing, the view-mode fullscreen presentation, the
//  kiosk/compact/border options, and the live stale/offline chip — and on appear it
//  emits the P1/S11 `view.opened` diagnostics event.
//
//  Every P4 state renders: `loading` (skeleton grid), `empty` (friendly state),
//  `error` (message + retry), `stale`/`offline` (cached widgets + freshness chip),
//  and `loaded` (the responsive grid). No surface is ever hidden behind a null check.
//

import SwiftUI

public struct DashboardGrid<WidgetBody: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        DashboardGridSurface.slug
    }

    private let state: DashboardGridState
    private let connection: DashboardGridConnection
    private let options: DashboardGridOptions
    private let actions: DashboardGridActions
    private let localize: DashboardGridLocalizer
    private let telemetry: any DashboardGridTelemetry
    private let widgetContent: (DashboardWidgetRenderContext) -> WidgetBody

    @State private var fullscreenWidgetID: String?
    @State private var activeBreakpoint: DashboardBreakpoint = .lg

    /// Designated initialiser (explicit state — used by the load/empty/error callers
    /// and the previews/tests). `widget` is the parent's registry-backed renderer for
    /// one tile's body (web `def.component`).
    public init(
        state: DashboardGridState,
        connection: DashboardGridConnection = .live,
        options: DashboardGridOptions = DashboardGridOptions(),
        actions: DashboardGridActions,
        localize: DashboardGridLocalizer = .bundle,
        telemetry: any DashboardGridTelemetry = OSLogDashboardGridTelemetry(),
        @ViewBuilder widget: @escaping (DashboardWidgetRenderContext) -> WidgetBody
    ) {
        self.state = state
        self.connection = connection
        self.options = options
        self.actions = actions
        self.localize = localize
        self.telemetry = telemetry
        widgetContent = widget
    }

    /// Web-parity convenience: the grid for one resolved dashboard (web prop
    /// `dashboard`), threaded onto the `loaded` state.
    public init(
        dashboard: DashboardGridData,
        connection: DashboardGridConnection = .live,
        options: DashboardGridOptions = DashboardGridOptions(),
        actions: DashboardGridActions,
        localize: DashboardGridLocalizer = .bundle,
        telemetry: any DashboardGridTelemetry = OSLogDashboardGridTelemetry(),
        @ViewBuilder widget: @escaping (DashboardWidgetRenderContext) -> WidgetBody
    ) {
        self.init(
            state: .loaded(dashboard),
            connection: connection,
            options: options,
            actions: actions,
            localize: localize,
            telemetry: telemetry,
            widget: widget
        )
    }

    public var body: some View {
        content
            .task { DashboardGridSurface.reportOpen(to: telemetry) }
            .sheet(item: fullscreenBinding) { fullscreenContext in
                DashboardFullscreenView(
                    context: fullscreenContext,
                    localize: localize,
                    onClose: { fullscreenWidgetID = nil },
                    content: { widgetContent(fullscreenContext) }
                )
            }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            loadingGrid
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case let .loaded(data):
            loadedGrid(data)
        }
    }

    // MARK: Loaded grid (web responsive grid ↔ mobile stack)

    private func loadedGrid(_ data: DashboardGridData) -> some View {
        GeometryReader { proxy in
            let breakpoint = DashboardBreakpoint.resolve(width: proxy.size.width)
            let spacing = DashboardGridMetrics.margin(compactMode: options.compactMode)
            ScrollView {
                gridBody(data, breakpoint: breakpoint, spacing: spacing)
                    .padding(.horizontal, spacing)
                    .padding(.vertical, spacing)
            }
            .onChange(of: breakpoint, initial: true) { _, newValue in
                activeBreakpoint = newValue
            }
        }
        .overlay(alignment: .topTrailing) { freshnessChip }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.gridLabel(localize)))
    }

    @ViewBuilder
    private func gridBody(
        _ data: DashboardGridData,
        breakpoint: DashboardBreakpoint,
        spacing: CGFloat
    ) -> some View {
        if breakpoint.isMobileStack {
            mobileStack(data, breakpoint: breakpoint, spacing: spacing)
        } else {
            desktopGrid(data, breakpoint: breakpoint, spacing: spacing)
        }
    }

    private func mobileStack(
        _ data: DashboardGridData,
        breakpoint: DashboardBreakpoint,
        spacing: CGFloat
    ) -> some View {
        let widgets = DashboardGridLayoutMath.orderedWidgets(
            data.widgets,
            layouts: data.layouts,
            isMobileStack: true
        )
        return LazyVStack(spacing: spacing) {
            ForEach(widgets) { widget in
                tile(for: widget, data: data, breakpoint: breakpoint)
                    .frame(minHeight: DashboardGridMetrics.mobileMinHeight)
            }
        }
        .accessibilityIdentifier("dashboard-mobile-stack")
    }

    private func desktopGrid(
        _ data: DashboardGridData,
        breakpoint: DashboardBreakpoint,
        spacing: CGFloat
    ) -> some View {
        let placements = DashboardGridLayoutMath.placements(
            for: data.widgets,
            layouts: data.layouts,
            breakpoint: breakpoint
        )
        return DashboardGridFlowLayout(
            columns: breakpoint.columns,
            rowHeight: DashboardGridMetrics.rowHeight,
            spacing: spacing
        ) {
            ForEach(data.widgets) { widget in
                tile(for: widget, data: data, breakpoint: breakpoint)
                    .layoutValue(key: DashboardGridCellKey.self, value: placements[widget.id] ?? fallbackItem(widget))
            }
        }
        .background {
            if options.editMode {
                DashboardDotGridBackground()
            }
        }
    }

    private func tile(
        for widget: DashboardWidgetInstance,
        data: DashboardGridData,
        breakpoint: DashboardBreakpoint
    ) -> some View {
        let context = DashboardGridLayoutMath.renderContext(
            for: widget,
            layouts: data.layouts,
            breakpoint: breakpoint,
            widgets: data.widgets,
            dashboardVehicleID: options.dashboardVehicleId
        )
        return DashboardWidgetTile(
            context: context,
            editMode: options.editMode,
            showBorder: options.showWidgetBorders,
            kioskStyle: DashboardKioskStyle.resolve(opacity: options.kioskWidgetOpacity),
            localize: localize,
            onRemove: { actions.onRemoveWidget(widget.id) },
            onOpenSettings: { actions.onOpenSettings(widget.id) },
            onExpand: { fullscreenWidgetID = widget.id },
            content: { widgetContent(context) }
        )
    }

    private func fallbackItem(_ widget: DashboardWidgetInstance) -> DashboardGridLayoutItem {
        DashboardGridLayoutItem(
            id: widget.id,
            x: 0,
            y: 0,
            columnSpan: widget.defaultSize.cols,
            rowSpan: widget.defaultSize.rows
        )
    }

    // MARK: Freshness chip (stale / offline)

    @ViewBuilder
    private var freshnessChip: some View {
        if let chip = DashboardGridFreshnessChip.project(connection) {
            DashboardGridConnectionChip(chip: chip, localize: localize)
                .padding(TSSpacing.md)
        }
    }

    // MARK: Loading / empty / error chrome (every state renders)

    private var loadingGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg)],
                spacing: TSSpacing.lg
            ) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    DashboardWidgetSkeletonTile()
                        .frame(height: 200)
                }
            }
            .padding(TSSpacing.lg)
        }
        .accessibilityLabel(Text(verbatim: localize.string("dashboard.grid.loading", "Loading dashboard…")))
    }

    private var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey("dashboard.grid.empty.title"),
            message: LocalizedStringKey("dashboard.grid.empty.message"),
            systemImage: "square.grid.2x2"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String?) -> some View {
        TSErrorDisplay(
            title: LocalizedStringKey("dashboard.grid.error.title"),
            message: message.map { LocalizedStringKey($0) }
                ?? LocalizedStringKey("dashboard.grid.error.message"),
            onRetry: actions.onRetry
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Fullscreen presentation (web `FullscreenOverlay`)

    private var fullscreenBinding: Binding<DashboardWidgetRenderContext?> {
        Binding(
            get: { resolvedFullscreenContext() },
            set: { newValue in
                if newValue == nil { fullscreenWidgetID = nil }
            }
        )
    }

    private func resolvedFullscreenContext() -> DashboardWidgetRenderContext? {
        guard
            let id = fullscreenWidgetID,
            let data = state.dashboard,
            let widget = data.widgets.first(where: { $0.id == id })
        else {
            return nil
        }
        return DashboardGridLayoutMath.fullscreenContext(
            for: widget,
            layouts: data.layouts,
            breakpoint: activeBreakpoint,
            widgets: data.widgets,
            dashboardVehicleID: options.dashboardVehicleId
        )
    }
}
