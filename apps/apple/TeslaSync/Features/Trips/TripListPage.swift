import SwiftUI

/// Native SwiftUI parity of `web/src/features/trips/pages/TripListPage.tsx` (route `/trips`). The page
/// reports multi-drive trips and reproduces every region of the web page, binding through the
/// `@Observable` `TripListPageModel` (ADR-004 — no networking in the view):
///   1. Four summary stat cards — Total Distance, Energy Used, Total Cost, Total Trips (web `MetricCard`).
///   2. The "Top Trips by Distance" chart panel (web `ChartContainer` + `BarChart`) with CSV / JSON export.
///   3. GlassPanel6 — the "All Trips" list container, holding the per-trip GlassPanel7 rows.
///
/// Adaptive across macOS / iPad (regular) and iPhone (compact) via the P2 tokens + P3 components: the
/// stat grid reflows 1→2→4 columns, the chart + list take full width, and the page scrolls. Every
/// value formats at the render boundary through `Units` / `TripListFormat` (SI in, display out —
/// ADR-005); every literal resolves from `Localizable.xcstrings` with the web key names.
public struct TripListPage: View {
    @State private var model: TripListPageModel
    @Environment(\.tsUnits) private var units

    public init(model: TripListPageModel) {
        _model = State(initialValue: model)
    }

    public init(
        query: TripListQuery = TripListQuery(),
        currencySymbol: String = CurrencyMeta.defaultCurrencySymbol,
        locale: Locale = .autoupdatingCurrent,
        dataSource: any TripListDataSource = SampleTripListDataSource()
    ) {
        _model = State(initialValue: TripListPageModel(
            query: query,
            currencySymbol: currencySymbol,
            locale: locale,
            dataSource: dataSource
        ))
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                subtitle
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(TripListStrings.title))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
    }

    /// Web `PageContainer subtitle`: "Multi-drive trip reports with distance and cost tracking".
    private var subtitle: some View {
        Text(TripListStrings.subtitle)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Top-level status switch (web `loading ? skeletons : body`)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            TripListPageSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    // MARK: - Ready (web PageContainer body)

    @ViewBuilder
    private var readyView: some View {
        TSFadeIn(delay: 0.05) {
            statsGrid
        }
        TSFadeIn(delay: 0.1) {
            TripListChartPanel(model: model, units: units)
        }
        TSFadeIn(delay: 0.15) {
            tripListPanel
        }
    }

    // MARK: Stat cards (web 4× `MetricCard`)

    private var statsGrid: some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            MetricCard(
                label: TripListStrings.statsDistance,
                value: TripListFormat.distanceText(meters: model.totalDistanceM, units: units),
                iconSystemName: "mappin.and.ellipse",
                color: .cyan,
                subtitle: TripListStrings.statsTripCount(model.tripCount)
            )
            MetricCard(
                label: TripListStrings.statsEnergy,
                value: TripListFormat.energy(wattHours: model.totalEnergyWh, units: units),
                iconSystemName: "bolt.fill",
                color: .amber,
                subtitle: TripListStrings.statsDriveCount(model.totalDrives)
            )
            MetricCard(
                label: TripListStrings.statsCost,
                value: TripListFormat.currency(model.totalCost, symbol: model.currencySymbol, locale: model.locale),
                iconSystemName: "dollarsign.circle",
                color: .green,
                subtitle: costSubtitle
            )
            MetricCard(
                label: TripListStrings.statsTotal,
                value: "\(model.tripCount)",
                iconSystemName: "point.topleft.down.to.point.bottomright.curvepath",
                color: .purple,
                subtitle: TripListStrings.statsTotalDrives(model.totalDrives)
            )
        }
    }

    /// Web Total-Cost subtitle: `${formatCurrency((totalCost / totalDistDisplay) * 100)}/100${unit}`.
    private var costSubtitle: String {
        TripListFormat.costPerHundred(
            totalCost: model.totalCost,
            totalDistanceDisplay: TripListFormat.distanceValue(meters: model.totalDistanceM, units: units),
            symbol: model.currencySymbol,
            unit: units.distance,
            locale: model.locale
        )
    }

    private var statColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]
    }

    // MARK: GlassPanel6 — All Trips list (web `GlassPanel`)

    private var tripListPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(TripListStrings.listHeading)
                if model.hasTrips {
                    tripRows
                } else {
                    listEmptyState
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var tripRows: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(model.trips) { trip in
                TripListRow(
                    trip: trip,
                    units: units,
                    currencySymbol: model.currencySymbol,
                    locale: model.locale
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(TripListStrings.listHeading))
    }

    /// Web list empty state (`allTrips.length === 0`): trips populate automatically, so no action
    /// button (matching the web `EmptyState`).
    private var listEmptyState: some View {
        TSEmptyState(
            title: TripListStrings.listEmpty,
            systemImage: "point.topleft.down.to.point.bottomright.curvepath"
        )
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    // MARK: Error (web `PageContainer error`)

    /// Retryable failure of the trips fetch with the HIG retry affordance (ADR-011).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

// MARK: - Trip row (web `TripRow` — GlassPanel7)

/// One trip in the "All Trips" list (web `TripRow`, itself a `GlassPanel`). The leading block shows
/// the route avatar, the trip name (or the `Trip #{id}` fallback), and the date / duration /
/// drive-count / charge-count inline metrics; the trailing block shows the SI-converted distance, the
/// unit-aware energy with its efficiency line, and — when present — the trip cost. Adapts to a
/// stacked layout in compact width.
struct TripListRow: View {
    let trip: TripListItem
    let units: UnitPreferences
    let currencySymbol: String
    let locale: Locale

    var body: some View {
        TSGlassPanel {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: TSSpacing.lg) {
                    leading
                    Spacer(minLength: TSSpacing.md)
                    trailing
                }
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    leading
                    trailing
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    private var leading: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            avatar
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                metricsRow
            }
        }
    }

    private var title: String {
        trip.name ?? TripListStrings.tripFallback(id: trip.id)
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(Color.TS.accent.opacity(0.12))
            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
        }
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    }

    private var metricsRow: some View {
        HStack(spacing: TSSpacing.md) {
            inlineMetric(systemImage: "calendar", text: TripListFormat.date(trip.startDate))
            inlineMetric(
                systemImage: "clock",
                text: TripListFormat.duration(start: trip.startDate, end: trip.endDate)
            )
            Text(verbatim: TripListStrings.rowDrives(trip.driveCount))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if trip.chargeCount > 0 {
                Text(verbatim: TripListStrings.rowCharges(trip.chargeCount))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var trailing: some View {
        HStack(alignment: .center, spacing: TSSpacing.lg) {
            distanceColumn
            energyColumn
            if trip.totalCost > 0 {
                costColumn
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var distanceColumn: some View {
        statColumn(
            value: TripListFormat.distanceText(meters: trip.totalDistanceM, units: units),
            valueTint: Color.TS.textPrimary,
            caption: Text(verbatim: TripListStrings.rowDrives(trip.driveCount))
        )
    }

    private var energyColumn: some View {
        statColumn(
            value: TripListFormat.energy(wattHours: trip.totalEnergyWh, units: units),
            valueTint: Color.TS.statusWarning,
            caption: Text(verbatim: TripListFormat.efficiencyText(
                energyWh: trip.totalEnergyWh,
                distanceM: trip.totalDistanceM,
                units: units
            ))
        )
    }

    private var costColumn: some View {
        statColumn(
            value: TripListFormat.currency(trip.totalCost, symbol: currencySymbol, locale: locale),
            valueTint: Color.TS.statusSuccess,
            caption: Text(TripListStrings.rowCost)
        )
    }

    private func statColumn(value: String, valueTint: Color, caption: Text) -> some View {
        VStack(alignment: .trailing, spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(valueTint)
            caption
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func inlineMetric(systemImage: String, text: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.system(size: 10)).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: text).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Skeleton (web loading state)

/// The initial loading state: redacted stat-card, chart, and list shapes so the page structure is
/// recognizable while the trips load (ADR-011 — never a blank screen). Mirrors the web `Skeleton`
/// grid + the chart container + the list panel.
struct TripListPageSkeleton: View {
    private var statColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 96, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 320, cornerRadius: TSRadius.lg)
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSPanelTitle(TripListStrings.listHeading)
                    ForEach(0 ..< 3, id: \.self) { _ in
                        TSSkeleton(height: 72, cornerRadius: TSRadius.md)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityLabel(Text("loading"))
    }
}
