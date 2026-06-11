//
//  ChartContainer.Surface.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The reusable chart-framing surface — the SwiftUI parity of `components/charts/ChartContainer.tsx`.
//  Frames an arbitrary chart in a bordered figure with a title / subtitle header, a trailing action
//  toolbar (caller action slot + annotation add / show-hide + export menu + fullscreen), the collapsed
//  annotation marker row, the body state machine (loading / empty / error / chart), the accessible
//  data-table fallback, the annotation footer list, and the add-annotation sheet — plus the P4 leaf
//  connectivity axis (freshness chip + banner with a one-shot stale auto-refresh). Parameterised by
//  the per-chart `ChartContainerContent` and bound through `ChartContainerModel` (P1/S8); no
//  networking lives here. The chart `content` is a render closure receiving the visible annotations
//  (the native port of the web function-children), so the caller can draw reference overlays.
//
//  Every state renders — no hidden surface:
//    • loading — initial fetch → the centred spinner.
//    • empty   — data resolved, no rows → the "No data available" empty state (never a blank box).
//    • error   — the chart's error boundary tripped → the failed-chart row + retry.
//    • ready    — the caller's chart inside the figure.
//    • stale/offline — the orthogonal connectivity axis → freshness chip + banner with a one-shot
//                      auto-refresh on the stale edge.
//

import SwiftUI

// MARK: - Render context (web function-children `{ annotations, hidden }`)

/// The context handed to the chart `content` closure — the native port of the web
/// `ChartContainerRenderProps`: the currently-visible annotations (empty while the overlay is hidden)
/// and the hidden flag, so the caller can draw reference overlays that follow the toggle.
public struct ChartContainerRenderContext: Equatable, Sendable {
    public let annotations: [ChartContainerAnnotation]
    public let hidden: Bool

    public init(annotations: [ChartContainerAnnotation], hidden: Bool) {
        self.annotations = annotations
        self.hidden = hidden
    }
}

// MARK: - Image export (web `useChartExport` PNG / copy-image)

/// Renders a chart view to a platform image for the export menu's copy action — the native parity of
/// the web `useChartExport` canvas capture. Best-effort: returns `nil` when the renderer cannot
/// produce a bitmap (the menu then copies nothing rather than crashing).
@MainActor
enum ChartContainerImageExport {
    static func render(_ view: some View) -> ChartContainerPlatformImage? {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        #if canImport(UIKit)
            return renderer.uiImage
        #elseif canImport(AppKit)
            return renderer.nsImage
        #else
            return nil
        #endif
    }
}

// MARK: - ChartContainer (the reusable shared surface)

/// The reusable chart-framing surface, generic over the chart `content` (a render closure) and the
/// optional `action` slot. Renders every state from the web source plus the P4 leaf states, binding
/// through `ChartContainerModel`.
public struct ChartContainer<Content: View, Action: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ChartContainerMeta.surfaceSlug
    }

    @State private var model: ChartContainerModel
    @State private var expanded = false

    private let loading: Bool
    private let empty: Bool
    private let hasError: Bool
    private let height: CGFloat
    private let data: [ChartContainerDataRow]
    private let dataColumns: [ChartContainerDataColumn]
    private let content: (ChartContainerRenderContext) -> Content
    private let action: Action

    public init(
        model: ChartContainerModel,
        loading: Bool = false,
        empty: Bool = false,
        hasError: Bool = false,
        height: CGFloat = 280,
        data: [ChartContainerDataRow] = [],
        dataColumns: [ChartContainerDataColumn] = [],
        @ViewBuilder content: @escaping (ChartContainerRenderContext) -> Content,
        @ViewBuilder action: () -> Action
    ) {
        _model = State(initialValue: model)
        self.loading = loading
        self.empty = empty
        self.hasError = hasError
        self.height = height
        self.data = data
        self.dataColumns = dataColumns
        self.content = content
        self.action = action()
    }

    public var body: some View {
        let resolved = model.resolved(
            loading: loading,
            empty: empty,
            hasError: hasError,
            rowCount: data.count,
            columnCount: dataColumns.count
        )
        let context = ChartContainerRenderContext(
            annotations: resolved.visibleAnnotations,
            hidden: resolved.hidden
        )
        figure(resolved: resolved, context: context)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .sheet(isPresented: addFormBinding) {
                ChartContainerAddAnnotationForm(
                    onAdd: { label, category, description, occurredAt in
                        model.addAnnotation(
                            label: label,
                            category: category,
                            description: description,
                            occurredAt: occurredAt
                        )
                    },
                    onCancel: { model.setAddFormOpen(false) }
                )
            }
            .sheet(isPresented: $expanded) { fullscreenSheet(context: context) }
    }

    // MARK: Figure

    private func figure(resolved: ChartContainerResolved, context: ChartContainerRenderContext) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                Spacer(minLength: 0)
                ChartContainerConnectivityChip(connection: resolved.connection) { model.refresh() }
            }
            if !resolved.isLive {
                ChartContainerConnectivityBanner(connection: resolved.connection)
            }
            ChartContainerHeader(
                model: model,
                resolved: resolved,
                expanded: $expanded,
                renderImage: { ChartContainerImageExport.render(exportView(context: context)) },
                csv: { ChartContainerCsv.serialize(columns: dataColumns, rows: data) },
                action: action
            )
            if resolved.showMarkerRow {
                ChartContainerMarkerRow(annotations: resolved.visibleAnnotations)
            }
            ChartContainerBody(
                status: resolved.status,
                height: height,
                ariaLabel: figureLabel(resolved: resolved),
                onRetry: { model.refresh() },
                content: content(context)
            )
            ChartContainerFallbackTable(
                title: model.content.title,
                ariaDescription: model.content.ariaDescription,
                columns: dataColumns,
                rows: data
            )
            if resolved.showAnnotationList {
                ChartContainerAnnotationList(
                    annotations: resolved.fetchedAnnotations,
                    onRemove: { model.removeAnnotation(id: $0) }
                )
            }
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    /// The figure's accessible name — web `ariaLabel`, freshness-suffixed off-live.
    private func figureLabel(resolved: ChartContainerResolved) -> String {
        ChartContainerAccessibility.figureLabel(
            ariaLabel: model.content.ariaLabel,
            freshnessNote: ChartContainerFreshness.note(for: resolved.connection),
            isLive: resolved.isLive
        )
    }

    /// The off-screen chart used for the copy-image export (chart + surface backdrop).
    private func exportView(context: ChartContainerRenderContext) -> some View {
        content(context)
            .frame(width: 640, height: height)
            .padding(TSSpacing.lg)
            .background(Color.TS.surface)
    }

    private var addFormBinding: Binding<Bool> {
        Binding(get: { model.addFormOpen }, set: { model.setAddFormOpen($0) })
    }

    // MARK: Fullscreen (web Fullscreen API)

    private func fullscreenSheet(context: ChartContainerRenderContext) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                Text(verbatim: model.content.title)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                TSButton(variant: .secondary, size: .small) {
                    expanded = false
                } label: {
                    Text(verbatim: ChartContainerStrings.string("chart.fullscreen.exit", "Exit fullscreen"))
                        .font(Font.TS.label)
                }
            }
            content(context)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: model.content.ariaLabel))
        }
        .padding(TSSpacing.lg)
        .frame(minWidth: 320, minHeight: 320)
        .background(Color.TS.bg)
    }
}

// MARK: - Convenience initialisers

public extension ChartContainer where Action == EmptyView {
    /// A chart that does not need a custom action slot (the common case).
    init(
        model: ChartContainerModel,
        loading: Bool = false,
        empty: Bool = false,
        hasError: Bool = false,
        height: CGFloat = 280,
        data: [ChartContainerDataRow] = [],
        dataColumns: [ChartContainerDataColumn] = [],
        @ViewBuilder content: @escaping (ChartContainerRenderContext) -> Content
    ) {
        self.init(
            model: model,
            loading: loading,
            empty: empty,
            hasError: hasError,
            height: height,
            data: data,
            dataColumns: dataColumns,
            content: content,
            action: { EmptyView() }
        )
    }

    /// Mounts a chart directly over a content config + an annotation snapshot, building the
    /// production source-backed model — the parity of `<ChartContainer …>` at a call site. The
    /// create / delete handlers wire the web `useCreateAnnotation` / `useDeleteAnnotation` mutations.
    init(
        content config: ChartContainerContent,
        input: ChartContainerInput = ChartContainerInput(),
        loading: Bool = false,
        empty: Bool = false,
        hasError: Bool = false,
        height: CGFloat = 280,
        data: [ChartContainerDataRow] = [],
        dataColumns: [ChartContainerDataColumn] = [],
        onCreate: @escaping @MainActor (ChartContainerAnnotationDraft) -> Void = { _ in },
        onDelete: @escaping @MainActor (Int64) -> Void = { _ in },
        @ViewBuilder content: @escaping (ChartContainerRenderContext) -> Content
    ) {
        let source = LiveChartContainerSource(input: input, onCreate: onCreate, onDelete: onDelete)
        self.init(
            model: ChartContainerModel(content: config, source: source),
            loading: loading,
            empty: empty,
            hasError: hasError,
            height: height,
            data: data,
            dataColumns: dataColumns,
            content: content
        )
    }
}
