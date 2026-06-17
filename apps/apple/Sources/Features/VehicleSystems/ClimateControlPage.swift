import SwiftUI

/// Native SwiftUI parity of `web/src/features/vehicle-systems/pages/ClimateControlPage.tsx`
/// (route `/climate`). Reproduces the web page chrome (`PageContainer`: title +
/// subtitle + page-level loading / error + Refresh action), the HVAC status banner,
/// the three temperature `RadialGauge`s, the climate-status + protection metric
/// grids, the Thermal Comfort + Climate Efficiency panels, the Seat Heaters grid,
/// the Temperature History `LineChart`, the AC State & Fan Speed `AreaChart`, and
/// the Climate History table.
///
/// Adaptive (ADR-002/006): macOS / iPad regular width uses multi-column grids +
/// a columnar table; compact iPhone collapses to single/two-column grids + cards.
/// Every data state (loading / empty / error / success) is implemented; each
/// section additionally guards its own nil fields + empty history. All copy
/// resolves from `Localizable.xcstrings` with the web key names; temperatures are
/// stored SI °C and converted to the user's unit only at this boundary (P1/S5).
/// Data binds through the `@Observable` `ClimateControlPageModel` (no networking
/// in the view, ADR-004).
public struct ClimateControlPage: View {
    @State private var model: ClimateControlPageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    init(model: ClimateControlPageModel) {
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
        .refreshable {
            await model.refresh()
        }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var fahrenheit: Bool {
        units.temperature == "°F"
    }

    private var unitLabel: String {
        units.temperature
    }

    // MARK: - Header (web PageContainer title + subtitle + Refresh action)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                TSPageTitle("Climate Control")
                Spacer(minLength: TSSpacing.lg)
                TSButton("Refresh", variant: .ghost, size: .small) {
                    Task { await model.refresh() }
                }
            }
            Text("HVAC status, temperatures, and seat heaters")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer loading / error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            loadingView
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case let .loaded(data):
            loadedContent(data)
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(height: 72, cornerRadius: TSRadius.lg)
            LazyVGrid(columns: gridColumns(minimum: 150), spacing: TSSpacing.md) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    TSSkeleton(height: 120, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 280, cornerRadius: TSRadius.lg)
        }
        .accessibilityLabel(Text("Climate Control"))
    }

    private var emptyView: some View {
        TSEmptyState(
            title: "Climate Control",
            message: "No history records found.",
            systemImage: "thermometer.medium"
        )
        .frame(maxWidth: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Success body (every section; each guards its own nil/empty)

    private func loadedContent(_ data: ClimateData) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ClimateHvacBanner(
                latest: data.latest,
                notEnoughPowerToHeat: data.notEnoughPowerToHeat,
                isCompact: isCompact
            )
            ClimateTemperatureGauges(latest: data.latest, fahrenheit: fahrenheit, unitLabel: unitLabel)
            ClimateStatusCards(latest: data.latest, isCompact: isCompact)
            ClimateProtectionRow(
                latest: data.latest,
                fahrenheit: fahrenheit,
                unitLabel: unitLabel,
                isCompact: isCompact
            )
            ClimateThermalComfort(latest: data.latest, isCompact: isCompact)
            ClimateEfficiencySection(history: data.history, latest: data.latest, isCompact: isCompact)
            ClimateSeatHeaters(latest: data.latest)
            temperatureHistoryPanel(data.history)
            hvacHistoryPanel(data.history)
            historyTablePanel(data.history)
        }
    }

    // MARK: - Chart + table panels (web GlassPanel + chart / EmptyState)

    private func temperatureHistoryPanel(_ history: [ClimateSnapshot]) -> some View {
        ClimateSectionPanel(systemImage: "thermometer.medium", title: "Temperature History") {
            if history.isEmpty {
                TSEmptyState(title: "No temperature history available.", systemImage: "thermometer.medium")
                    .frame(maxWidth: .infinity)
            } else {
                ClimateTemperatureHistoryChart(history: chronological(history), fahrenheit: fahrenheit)
            }
        }
    }

    private func hvacHistoryPanel(_ history: [ClimateSnapshot]) -> some View {
        ClimateSectionPanel(systemImage: "wind", title: "AC State & Fan Speed") {
            if history.isEmpty {
                TSEmptyState(title: "No HVAC history available.", systemImage: "wind")
                    .frame(maxWidth: .infinity)
            } else {
                ClimateHvacHistoryChart(history: chronological(history))
            }
        }
    }

    private func historyTablePanel(_ history: [ClimateSnapshot]) -> some View {
        ClimateSectionPanel(systemImage: "gauge.medium", title: "Climate History") {
            if history.isEmpty {
                TSEmptyState(title: "No history records found.", systemImage: "tablecells")
                    .frame(maxWidth: .infinity)
            } else {
                ClimateHistoryTable(rows: history, fahrenheit: fahrenheit, unitLabel: unitLabel)
            }
        }
    }

    private func chronological(_ history: [ClimateSnapshot]) -> [ClimateSnapshot] {
        history.sorted { lhs, rhs in
            (lhs.timestamp ?? .distantPast) < (rhs.timestamp ?? .distantPast)
        }
    }

    private func gridColumns(minimum: CGFloat) -> [GridItem] {
        [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)]
    }
}

// MARK: - Section panel (web GlassPanel with an icon + title header)

/// A titled glass panel (web `GlassPanel` with the `mb-4 flex items-center gap-2`
/// icon + heading header) wrapping arbitrary content.
struct ClimateSectionPanel<Content: View>: View {
    private let systemImage: String
    private let title: LocalizedStringKey
    private let content: () -> Content

    init(systemImage: String, title: LocalizedStringKey, @ViewBuilder content: @escaping () -> Content) {
        self.systemImage = systemImage
        self.title = title
        self.content = content
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: systemImage)
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle(title)
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationStack {
            ClimateControlPage(model: ClimateControlPageModel())
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("Loaded · Imperial") {
        NavigationStack {
            ClimateControlPage(model: ClimateControlPageModel())
        }
        .tsUnits(.imperial)
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            ClimateControlPage(model: ClimateControlPageModel(dataSource: PreviewEmptyClimate()))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            ClimateControlPage(model: ClimateControlPageModel(dataSource: PreviewFailingClimate()))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    /// Preview seam yielding no climate data (drives the empty state).
    private struct PreviewEmptyClimate: ClimateControlDataSource {
        func load(vehicleID _: Int64?) async throws -> ClimateData {
            ClimateData()
        }
    }

    /// Preview seam that fails (drives the error state).
    private struct PreviewFailingClimate: ClimateControlDataSource {
        struct Failure: Error {}
        func load(vehicleID _: Int64?) async throws -> ClimateData {
            throw Failure()
        }
    }
#endif
