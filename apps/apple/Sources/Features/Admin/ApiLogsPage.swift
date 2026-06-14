import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/ApiLogsPage.tsx` (route
/// `/api-logs`). Reproduces the web page chrome (web `PageContainer`: title + subtitle), the
/// "Failed to load data" banner (web `AlertBanner`), the four stat cards (web `StatCard` —
/// Total Calls / Error Rate / Avg Duration / Last 24h), the "By Service" chip row, the
/// filter panel (web `GlassPanel` #2, in `ApiLogsPage.Filters.swift`), and the entries panel
/// with the paginated, expandable table (web `GlassPanel` #3 + the per-row request-URL /
/// error / request-body / response-body `GlassPanel`s, in `ApiLogsPage.Table.swift`).
///
/// Faithful to the web, every panel renders regardless of the list query — the stat cards
/// show "—" until stats load and the table switches state internally (loading / empty /
/// error / success). All copy resolves from `Localizable.xcstrings` with the web key names
/// (the `translation.apiLogs.*` mirror); data binds through the `@Observable`
/// `ApiLogsPageModel` (no networking in the view, ADR-004). Adaptive across macOS/iPad
/// (regular) + iPhone (compact) per ADR-002/006.
public struct ApiLogsPage: View {
    @State private var model: ApiLogsPageModel

    public init(model: ApiLogsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if let detail = model.loadFailureDetail {
                    errorBanner(detail)
                }
                statsSection
                ApiLogsFiltersPanel(model: model)
                ApiLogsEntriesPanel(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.listState { return }
            await model.load()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.apiLogs.title")
            Text("translation.apiLogs.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Error banner (web `anyError` → danger AlertBanner + detail)

    private func errorBanner(_ detail: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSAlertBanner(
                tone: .danger,
                systemImage: "exclamationmark.triangle.fill",
                title: "translation.error.loadFailed"
            )
            Text(verbatim: detail)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
        }
    }

    // MARK: - Stats (web StatCard grid + "By Service" chips)

    private var statsSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: statColumns, alignment: .leading, spacing: TSSpacing.md) {
                TSStatCard(
                    title: "translation.apiLogs.totalCalls",
                    value: model.stats.map { ApiLogsFormat.int($0.totalCalls) } ?? ApiLogsFormat.emptyValue,
                    systemImage: "doc.text.fill"
                )
                TSStatCard(
                    title: "translation.apiLogs.errorRate",
                    value: model.stats.map { ApiLogsFormat.percent($0.errorRate) } ?? ApiLogsFormat.emptyValue,
                    systemImage: "exclamationmark.triangle.fill"
                )
                TSStatCard(
                    title: "translation.apiLogs.avgDuration",
                    value: model.stats.map { ApiLogsFormat.durationMs($0.avgDurationMs) } ?? ApiLogsFormat.emptyValue,
                    systemImage: "clock.fill"
                )
                TSStatCard(
                    title: "translation.apiLogs.last24h",
                    value: model.stats.map { ApiLogsFormat.int($0.last24h) } ?? ApiLogsFormat.emptyValue,
                    systemImage: "waveform.path.ecg"
                )
            }
            if model.hasServiceBreakdown {
                serviceChips
            }
        }
    }

    private var statColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]
    }

    /// Web "By Service" chip row — a tappable badge + count per service that sets the
    /// service filter. A horizontal scroll keeps the row compact + adaptive on both idioms.
    private var serviceChips: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption("translation.apiLogs.byService")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(model.serviceBreakdown, id: \.service) { entry in
                        serviceChip(service: entry.service, count: entry.count)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func serviceChip(service: String, count: Int) -> some View {
        Button {
            Task { await model.selectService(service) }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                ApiLogsServiceBadge(service: service)
                Text(verbatim: ApiLogsFormat.int(count))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ApiLogsServiceCatalog.service(service).label))
        .accessibilityValue(Text(verbatim: ApiLogsFormat.int(count)))
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Interpolated strings (web i18next `{{token}}` → catalog template)

    /// Resolves `apiLogs.showing` ("Showing {{from}}–{{to}} of {{total}}") with the range.
    static func showingText(from: Int, to: Int, total: Int) -> String {
        ApiLogsFormat.interpolate(
            String(localized: "translation.apiLogs.showing"),
            ["from": ApiLogsFormat.int(from), "to": ApiLogsFormat.int(to), "total": ApiLogsFormat.int(total)]
        )
    }

    /// Resolves `apiLogs.pageOf` ("Page {{page}} of {{total}}") with the 1-based page.
    static func pageOfText(page: Int, total: Int) -> String {
        ApiLogsFormat.interpolate(
            String(localized: "translation.apiLogs.pageOf"),
            ["page": String(page), "total": String(total)]
        )
    }

    /// Resolves `apiLogs.noData` ("No {{label}}") with the lowercased field label.
    static func noDataText(label: String) -> String {
        ApiLogsFormat.interpolate(
            String(localized: "translation.apiLogs.noData"),
            ["label": label.lowercased()]
        )
    }

    /// Resolves `apiLogs.serviceCount` ("{{tracked}} with data · {{known}} known").
    static func serviceCountText(tracked: Int, known: Int) -> String {
        ApiLogsFormat.interpolate(
            String(localized: "translation.apiLogs.serviceCount"),
            ["tracked": String(tracked), "known": String(known)]
        )
    }
}

#if DEBUG
    #Preview("Loaded") {
        ApiLogsPage(model: ApiLogsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ApiLogsPage(model: ApiLogsPageModel(dataSource: PreviewEmptyApiLogs()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ApiLogsPage(model: ApiLogsPageModel(dataSource: PreviewFailingApiLogs()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows + zeroed stats (drives the empty state).
    private struct PreviewEmptyApiLogs: ApiLogsDataSource {
        func loadStats() async throws -> ApiCallLogStats {
            ApiCallLogStats(totalCalls: 0, errorRate: 0, errorCount: 0, avgDurationMs: 0, last24h: 0)
        }

        func loadLogs(_: ApiLogsQuery) async throws -> ApiCallLogPage {
            ApiCallLogPage(logs: [], total: 0)
        }
    }

    /// Preview seam that fails both feeds (drives the error banner + list error state).
    private struct PreviewFailingApiLogs: ApiLogsDataSource {
        func loadStats() async throws -> ApiCallLogStats {
            throw ApiLogsLoadFailure(detail: "Network unreachable")
        }

        func loadLogs(_: ApiLogsQuery) async throws -> ApiCallLogPage {
            throw ApiLogsLoadFailure(detail: "Network unreachable")
        }
    }
#endif
