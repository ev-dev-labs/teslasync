import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/ApiPlaygroundPage.tsx`
/// (route `/api-playground`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level loading / error) and the two-panel body: the
/// endpoint sidebar (web `GlassPanel` #1) and the detail pane (web `GlassPanel` #2)
/// whose default content is the select-an-endpoint prompt + the available-count line.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width lays the two panels side by side;
/// compact iPhone stacks them. Every data state the source produces is implemented
/// (loading / empty / error / success). All copy resolves from `Localizable.xcstrings`;
/// data binds through the `@Observable` `ApiPlaygroundPageModel` (no networking here).
public struct ApiPlaygroundPage: View {
    @State private var model: ApiPlaygroundPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Standard sidebar width on the regular (macOS / iPad) layout (web `w-72`).
    private static let sidebarWidth: CGFloat = 300
    /// Keeps the detail pane tall enough for the empty prompt to breathe (web `min-h`).
    private static let detailMinHeight: CGFloat = 320
    /// Number of shimmer rows shown while the catalog loads (web sidebar `Skeleton`).
    private static let skeletonRowCount = 8

    public init(model: ApiPlaygroundPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                stateContent
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.state { return }
            await model.load()
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("playground.title")
            Text("playground.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer loading/error + endpoints query)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case let .error(message):
            errorPanel(message)
        default:
            twoPanelLayout
        }
    }

    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "playground.errorTitle",
                message: "playground.errorMessage",
                onRetry: { Task { await model.refresh() } }
            )
            .frame(maxWidth: .infinity, minHeight: Self.detailMinHeight)
            .accessibilityValue(Text(verbatim: message))
        }
    }

    @ViewBuilder
    private var twoPanelLayout: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                sidebarPanel
                detailPanel
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                sidebarPanel.frame(width: Self.sidebarWidth)
                detailPanel.frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - GlassPanel 1 — endpoint sidebar

    private var sidebarPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSPanelTitle("playground.endpointsTitle")
                sidebarBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("playground.a11y.sidebar"))
    }

    @ViewBuilder
    private var sidebarBody: some View {
        switch model.state {
        case .loading:
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                    TSSkeleton(height: 18)
                }
            }
        case .empty:
            TSEmptyState(title: "playground.noEndpoints", systemImage: "tray")
        case .loaded:
            endpointList
        case .error:
            EmptyView()
        }
    }

    private var endpointList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(model.groupedEndpoints, id: \.tag) { group in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: group.tag)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(group.endpoints) { endpoint in
                        endpointRow(endpoint)
                    }
                }
            }
        }
    }

    private func endpointRow(_ endpoint: ApiEndpoint) -> some View {
        let isSelected = model.selected == endpoint
        return Button {
            model.select(endpoint)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                methodChip(endpoint.method)
                Text(verbatim: endpoint.path)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.vertical, TSSpacing.xs)
            .padding(.horizontal, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isSelected ? Color.TS.accent.opacity(0.15) : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(endpoint.method.rawValue) \(endpoint.path)"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: - GlassPanel 2 — detail / select-an-endpoint prompt

    private var detailPanel: some View {
        TSGlassPanel {
            detailBody
                .frame(maxWidth: .infinity, minHeight: Self.detailMinHeight, alignment: .topLeading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("playground.a11y.detail"))
    }

    @ViewBuilder
    private var detailBody: some View {
        if case .loading = model.state {
            VStack {
                Spacer(minLength: 0)
                TSSpinner(label: "playground.loading")
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)
        } else if let endpoint = model.selected {
            endpointDetail(endpoint)
        } else {
            selectPrompt
        }
    }

    private var selectPrompt: some View {
        TSEmptyState(title: "playground.selectEndpoint", systemImage: "book.closed") {
            if model.showsEndpointCount {
                Text(verbatim: Self.endpointCountText(model.endpointCount))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func endpointDetail(_ endpoint: ApiEndpoint) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                methodChip(endpoint.method)
                Text(verbatim: endpoint.path)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
            }
            if !endpoint.summary.isEmpty {
                Text(verbatim: endpoint.summary)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Divider().overlay(Color.TS.border)
            detailRow(label: "playground.detail.method", value: endpoint.method.rawValue)
            detailRow(label: "playground.detail.path", value: endpoint.path)
            detailRow(label: "playground.detail.tag", value: endpoint.tag)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func detailRow(label: LocalizedStringKey, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            TSLabel(label)
                .frame(width: 90, alignment: .leading)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Method chip

    private func methodChip(_ method: ApiEndpoint.Method) -> some View {
        Text(verbatim: method.rawValue)
            .font(Font.TS.label)
            .foregroundStyle(Self.methodColor(method))
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(
                Self.methodColor(method).opacity(0.15),
                in: Capsule()
            )
            .accessibilityHidden(true)
    }

    private static func methodColor(_ method: ApiEndpoint.Method) -> Color {
        switch method {
        case .get: Color.TS.statusInfo
        case .post: Color.TS.statusSuccess
        case .put, .patch: Color.TS.statusWarning
        case .delete: Color.TS.statusDanger
        }
    }

    /// Resolves `playground.endpointCount` ("%lld endpoints available") with the count.
    private static func endpointCountText(_ count: Int) -> String {
        let template = String(localized: "playground.endpointCount")
        return String(format: template, count)
    }
}

#if DEBUG
    #Preview("Loaded") {
        ApiPlaygroundPage(model: ApiPlaygroundPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ApiPlaygroundPage(model: ApiPlaygroundPageModel(catalog: PreviewEmptyCatalog()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ApiPlaygroundPage(model: ApiPlaygroundPageModel(catalog: PreviewFailingCatalog()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding an empty catalog (drives the empty state).
    private struct PreviewEmptyCatalog: ApiEndpointCatalogProviding {
        func load() async throws -> [ApiEndpoint] {
            []
        }
    }

    /// Preview seam that fails (drives the error state).
    private struct PreviewFailingCatalog: ApiEndpointCatalogProviding {
        struct Failure: Error {}
        func load() async throws -> [ApiEndpoint] {
            throw Failure()
        }
    }
#endif
