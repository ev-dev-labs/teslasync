import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/DiskForecastPage.tsx`
/// (route `/admin/disk-forecast`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level loading / error), the subsystem-unavailable banner
/// (web `subsystemMissing` → `AlertBanner`), the four fleet stat cards (web `StatCard`
/// grid, shown only when there are hypertables), and the hypertables panel (web
/// `GlassPanel` + `DataTable` / `EmptyState`). The adaptive table itself lives in
/// `DiskForecastPage.Table.swift`.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width renders a columnar table; compact
/// iPhone renders per-hypertable cards. Every data state the source produces is
/// implemented (loading / empty / error / success, plus the 503 unavailable variant).
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds
/// through the `@Observable` `DiskForecastPageModel` (no networking in the view).
public struct DiskForecastPage: View {
    @State private var model: DiskForecastPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Number of shimmer rows shown while the report loads (web table `Skeleton`).
    private static let skeletonRowCount = 6

    public init(model: DiskForecastPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
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
            TSPageTitle("admin.diskForecast.pageTitle")
            Text("admin.diskForecast.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer loading/error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case let .error(message):
            errorPanel(message)
        default:
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                if model.isSubsystemUnavailable {
                    subsystemBanner
                }
                if model.showsFleetStats {
                    fleetStatsGrid
                }
                hypertablesPanel
            }
        }
    }

    /// Web generic PageContainer error (non-503): a panel-level error with retry.
    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Subsystem-unavailable banner (web `subsystemMissing` AlertBanner)

    private var subsystemBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.subsystem.unavailableTitle",
            message: "admin.diskForecast.notConfigured"
        )
    }

    // MARK: - Fleet stat cards (web `StatCard` grid — Total / Uncompressed / Compressed / Growth)

    private var fleetStatsGrid: some View {
        let totals = model.fleetTotals
        return LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            TSMetricCard(
                title: "admin.diskForecast.fleetTotal",
                value: DiskForecastFormat.bytes(totals.totalBytes),
                caption: tableCountCaption
            )
            TSMetricCard(
                title: "admin.diskForecast.fleetUncompressed",
                value: DiskForecastFormat.bytes(totals.uncompressedBytes),
                caption: percentCaption(totals.uncompressedBytes, of: totals.totalBytes)
            )
            TSMetricCard(
                title: "admin.diskForecast.fleetCompressed",
                value: DiskForecastFormat.bytes(totals.compressedBytes),
                caption: percentCaption(totals.compressedBytes, of: totals.totalBytes)
            )
            TSMetricCard(
                title: "admin.diskForecast.fleetGrowth",
                value: "\(DiskForecastFormat.bytes(totals.growthBytesPerDay))/d",
                caption: "admin.diskForecast.growthSub"
            )
        }
    }

    private var statColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    /// Web `{{count}} hypertables` sublabel (rendered verbatim through the catalog).
    private var tableCountCaption: LocalizedStringKey {
        "\(Self.tableCountText(model.rows.count))"
    }

    /// Web `{{pct}}% of total` sublabel, or the em-dash when there is no total.
    private func percentCaption(_ part: Int64, of total: Int64) -> LocalizedStringKey {
        guard total > 0 else { return "\(DiskForecastFormat.emptyValue)" }
        return "\(Self.percentSubText(DiskForecastFormat.percent(part, of: total)))"
    }

    // MARK: - Hypertables panel (web `GlassPanel` #5 — PanelTitle + DataTable / EmptyState)

    private var hypertablesPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("admin.diskForecast.tableTitle")
                hypertablesContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.diskForecast.tableTitle"))
    }

    @ViewBuilder
    private var hypertablesContent: some View {
        switch model.state {
        case .loading:
            skeletonRows
        case .empty:
            TSEmptyState(
                title: "admin.diskForecast.emptyTitle",
                message: "admin.diskForecast.emptyMessage",
                systemImage: "internaldrive"
            )
            .frame(maxWidth: .infinity)
        case .unavailable:
            emptyTableNote
        case let .loaded(rows):
            DiskForecastTable(rows: rows)
        case .error:
            EmptyView()
        }
    }

    private var skeletonRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("admin.diskForecast.tableTitle"))
    }

    /// Web `DataTable` empty message (shown in the 503 unavailable branch).
    private var emptyTableNote: some View {
        Text("admin.diskForecast.emptyTable")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Interpolated stat-card strings (web i18next `{{token}}` → catalog `%lld`/`%@`)

    /// Resolves `admin.diskForecast.tableCount` ("%lld hypertables") with the count.
    static func tableCountText(_ count: Int) -> String {
        String(format: String(localized: "admin.diskForecast.tableCount"), count)
    }

    /// Resolves `admin.diskForecast.percentSub` ("%@%% of total") with the percentage.
    static func percentSubText(_ pct: String) -> String {
        String(format: String(localized: "admin.diskForecast.percentSub"), pct)
    }
}

#if DEBUG
    #Preview("Loaded") {
        DiskForecastPage(model: DiskForecastPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        DiskForecastPage(model: DiskForecastPageModel(dataSource: PreviewEmptyDiskForecast()))
            .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        DiskForecastPage(model: DiskForecastPageModel(dataSource: PreviewUnavailableDiskForecast()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        DiskForecastPage(model: DiskForecastPageModel(dataSource: PreviewFailingDiskForecast()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero hypertables (drives the empty state).
    private struct PreviewEmptyDiskForecast: DiskForecastDataSource {
        func load() async throws -> DiskForecastReport {
            DiskForecastReport(hypertables: [])
        }
    }

    /// Preview seam that reports the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableDiskForecast: DiskForecastDataSource {
        func load() async throws -> DiskForecastReport {
            throw DiskForecastSubsystemUnavailable()
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingDiskForecast: DiskForecastDataSource {
        struct Failure: Error {}
        func load() async throws -> DiskForecastReport {
            throw Failure()
        }
    }
#endif
