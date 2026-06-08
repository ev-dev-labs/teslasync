import SwiftUI

/// Drivetrain Health dashboard widget — motor / stator / inverter temperatures and
/// an overall powertrain score, at parity with the web
/// `features/dashboard/widgets/DrivetrainHealthWidget.tsx`.
public struct DrivetrainHealthWidget: View {
    /// Registry metadata mirroring `registry/vehicle.ts` (`drivetrain-health`).
    public static let descriptor = DashboardWidgetDescriptor(
        id: "drivetrain-health",
        displayNameKey: DrivetrainHealthStrings.displayName,
        descriptionKey: DrivetrainHealthStrings.description,
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    /// Stable surface slug for diagnostics.
    public static let surfaceSlug = "DrivetrainHealthWidget"

    private let size: DashboardWidgetSize
    private let unit: DrivetrainTemperatureUnit
    private let telemetry: DashboardWidgetTelemetry
    @State private var model: DrivetrainHealthWidgetModel

    public init(
        model: DrivetrainHealthWidgetModel,
        size: DashboardWidgetSize,
        unit: DrivetrainTemperatureUnit,
        telemetry: DashboardWidgetTelemetry = OSLogDashboardWidgetTelemetry()
    ) {
        _model = State(initialValue: model)
        self.size = size
        self.unit = unit
        self.telemetry = telemetry
    }

    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Freshness for the chip, when the current state carries one.
    var currentFreshness: WidgetFreshness? {
        switch model.state {
        case let .loaded(_, freshness): freshness
        case let .empty(freshness): freshness
        case .loading, .failed: nil
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                header
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .overlay(alignment: .topTrailing) {
            if isCompact, let freshness = currentFreshness {
                compactFreshnessDot(freshness)
            }
        }
        .onAppear {
            telemetry.viewOpened(surface: Self.surfaceSlug)
            model.start()
        }
        .onDisappear {
            model.stop()
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "gearshape.2.fill")
                .font(.caption)
                .foregroundStyle(Color.TS.statusSuccess)
            Text(LocalizedStringKey(DrivetrainHealthStrings.title))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            if let freshness = currentFreshness {
                freshnessChip(freshness)
            }
            refreshButton
        }
        .accessibilityElement(children: .contain)
    }

    private func freshnessChip(_ freshness: WidgetFreshness) -> some View {
        let info = DrivetrainHealthFreshness.info(for: freshness)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: info.iconName).font(.caption2)
            Text(LocalizedStringKey(info.labelKey)).font(Font.TS.caption)
        }
        .foregroundStyle(info.tone.color)
        .accessibilityElement(children: .combine)
    }

    private func compactFreshnessDot(_ freshness: WidgetFreshness) -> some View {
        let info = DrivetrainHealthFreshness.info(for: freshness)
        return Image(systemName: info.iconName)
            .font(.caption2)
            .foregroundStyle(info.tone.color)
            .padding(TSSpacing.xs)
            .accessibilityLabel(Text(LocalizedStringKey(info.labelKey)))
    }

    private var refreshButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.refresh() },
            label: { Image(systemName: "arrow.clockwise") }
        )
        .accessibilityLabel(Text(LocalizedStringKey(DrivetrainHealthStrings.refreshAccessibility)))
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch model.state {
        case let .loading(cached):
            if let cached, cached.hasData {
                gaugeHero(cached)
            } else {
                loadingState
            }
        case let .loaded(projection, _):
            if projection.hasData {
                gaugeHero(projection)
            } else {
                emptyState
            }
        case .empty:
            emptyState
        case let .failed(_, cached):
            if let cached, cached.hasData {
                gaugeHero(cached)
            } else {
                failedState
            }
        }
    }

    private var loadingState: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: isCompact ? 76 : 100, height: isCompact ? 76 : 100, cornerRadius: TSRadius.pill)
            if !isCompact {
                TSStatGridSkeleton(count: 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(Text("loading"))
    }

    private var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(DrivetrainHealthStrings.noData),
            systemImage: "gearshape.2"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var failedState: some View {
        TSQueryError(onRetry: { model.refresh() })
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func gaugeHero(_ projection: DrivetrainHealthProjection) -> some View {
        VStack(spacing: TSSpacing.md) {
            DrivetrainHealthGauge(score: projection.score, tone: projection.tone, compact: isCompact)
            if !isCompact {
                statGrid(projection)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func statGrid(_ projection: DrivetrainHealthProjection) -> some View {
        let stats = drivetrainStats(projection, unit: unit)
        let columns = [
            GridItem(.flexible(), spacing: TSSpacing.sm),
            GridItem(.flexible(), spacing: TSSpacing.sm)
        ]
        return LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
            ForEach(stats) { stat in
                DrivetrainStatCell(stat: stat)
            }
        }
    }
}

// MARK: - Subviews

/// Health-score ring (web `RadialGauge` inside `WidgetGaugeHero`). Uses the
/// score-derived status color rather than a palette index so green/amber/red map
/// to the web thresholds exactly.
private struct DrivetrainHealthGauge: View {
    let score: Int
    let tone: TSTone
    let compact: Bool

    private var fraction: Double {
        min(max(Double(score) / 100, 0), 1)
    }

    private var diameter: CGFloat {
        compact ? 76 : 104
    }

    private var lineWidth: CGFloat {
        compact ? 7 : 9
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border.opacity(0.4), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(tone.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(verbatim: "\(score)")
                    .font(compact ? Font.TS.section : Font.TS.title)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(LocalizedStringKey(DrivetrainHealthStrings.score))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(width: diameter, height: diameter)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(LocalizedStringKey(DrivetrainHealthStrings.title)))
        .accessibilityValue(Text(verbatim: "\(score)"))
    }
}

/// A single labeled stat cell under the gauge.
private struct DrivetrainStatCell: View {
    let stat: DrivetrainStat

    var body: some View {
        VStack(spacing: 2) {
            Text(LocalizedStringKey(stat.labelKey))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(verbatim: stat.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit = stat.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Previews

#if DEBUG
    @MainActor
    private final class PreviewDrivetrainHealthProvider: DrivetrainHealthProvider {
        private let fixed: DrivetrainHealthViewState
        init(_ fixed: DrivetrainHealthViewState) {
            self.fixed = fixed
        }

        func start(onState: @escaping (DrivetrainHealthViewState) -> Void) {
            onState(fixed)
        }

        func stop() {}
        func refresh() {}
    }

    @MainActor
    private func previewModel(_ state: DrivetrainHealthViewState) -> DrivetrainHealthWidgetModel {
        DrivetrainHealthWidgetModel(provider: PreviewDrivetrainHealthProvider(state), initialState: state)
    }

    private func previewProjection(_ overall: String) -> DrivetrainHealthProjection {
        DrivetrainHealthProjection(
            health: DrivetrainHealthReading(
                frontMotorTempC: 64,
                rearMotorTempC: 58,
                inverterTempC: 49,
                batteryTempC: 31,
                motorStatus: "drive",
                overallHealth: overall
            ),
            motor: DrivetrainMotorReading(
                motorTempCFront: 64,
                diStatorTemp: 71,
                inverterTempC: 49,
                stateFront: "drive"
            )
        )
    }

    private func previewCard(
        _ state: DrivetrainHealthViewState,
        size: DashboardWidgetSize = DashboardWidgetSize(cols: 2, rows: 4),
        unit: DrivetrainTemperatureUnit = .celsius
    ) -> some View {
        TSCard {
            DrivetrainHealthWidget(model: previewModel(state), size: size, unit: unit)
                .frame(height: size.cols <= 1 ? 120 : 240)
        }
        .padding()
    }

    #Preview("Loaded · good") {
        previewCard(.loaded(previewProjection("good"), freshness: .fresh))
    }

    #Preview("Loaded · warning") {
        previewCard(.loaded(previewProjection("warning"), freshness: .fresh))
    }

    #Preview("Loaded · critical (°F)") {
        previewCard(.loaded(previewProjection("critical"), freshness: .fresh), unit: .fahrenheit)
    }

    #Preview("Stale") {
        previewCard(.loaded(previewProjection("good"), freshness: .stale))
    }

    #Preview("Offline") {
        previewCard(.empty(freshness: .offline))
    }

    #Preview("Loading") {
        previewCard(.loading(cached: nil))
    }

    #Preview("Empty") {
        previewCard(.empty(freshness: .fresh))
    }

    #Preview("Error") {
        previewCard(.failed(message: nil, cached: nil))
    }

    #Preview("Compact") {
        previewCard(
            .loaded(previewProjection("good"), freshness: .fresh),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
    }
#endif
