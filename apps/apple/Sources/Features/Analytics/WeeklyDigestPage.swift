import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/WeeklyDigestPage.tsx` (route
/// `/weekly-digest`). The page chrome (`PageContainer`: title + subtitle + a vehicle `Select` action),
/// the three data states (`isLoading → DigestSkeleton`, `!hasData → EmptyState`,
/// `error → PageContainer error`), and — in the success state — the full web composition in order: the
/// week selector, the summary hero cards, and the driving / charging / battery-health / alerts /
/// week-over-week sections, each reproducing every `GlassPanel` region with the same data + grouping.
///
/// Adaptive (ADR-002/006): the header reflows and every metric/card grid uses adaptive columns for
/// macOS / iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with
/// the web key names; data binds through the `@Observable` `WeeklyDigestPageModel` (no networking in
/// the view). The digest is computed in the web's display units (km / kWh / Wh / minutes / %) exactly
/// as the legacy `useWeeklyDigest` does, so this surface formats — it does not convert — to stay at
/// number-for-number parity with the web + the sibling weekly-digest feature views.
public struct WeeklyDigestPage: View {
    @State private var model: WeeklyDigestPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: WeeklyDigestPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
            await model.load()
        }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var digest: DigestComputed {
        model.computed
    }

    // MARK: - Header (web `PageContainer` title + subtitle + `Select` action)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    vehiclePicker
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    vehiclePicker
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("analytics.weeklyDigest.title")
            Text("analytics.weeklyDigest.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var vehiclePicker: some View {
        WeeklyDigestVehiclePicker(
            options: model.vehicleOptions,
            selectedID: model.selectedVehicleID,
            onSelect: { model.selectVehicle($0) }
        )
    }

    // MARK: - Phase switch (web loading / error / `!hasData` / digest)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WeeklyDigestSkeleton()
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            readyView
        }
    }

    /// Web `!hasData` → `EmptyState` (calendar icon, "No Data" / no-data message).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "analytics.weeklyDigest.noData",
                message: "analytics.weeklyDigest.noDataMessage",
                systemImage: "calendar"
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private var errorView: some View {
        TSGlassPanel {
            TSQueryError(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web `FadeIn` composing the digest sections in order)

    private var readyView: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                WeeklyDigestWeekSelector(
                    weekLabel: model.weekLabel,
                    isCurrentWeek: model.isCurrentWeek,
                    onPrev: { model.goToPreviousWeek() },
                    onNext: { model.goToNextWeek() }
                )
                WeeklyDigestSummarySection(metrics: digest.metrics, funFact: digest.funFact)
                WeeklyDigestDrivingSection(metrics: digest.metrics, dailyDistance: digest.dailyDistance)
                WeeklyDigestChargingSection(metrics: digest.metrics, dailyEnergy: digest.dailyEnergy)
                WeeklyDigestBatterySection(metrics: digest.metrics)
                WeeklyDigestAlertsSection(metrics: digest.metrics, slices: digest.alertSlices)
                WeeklyDigestWeekOverWeekSection(metrics: digest.metrics)
            }
        }
    }
}

// MARK: - Vehicle picker (web header `Select` with the `selectVehicle` prompt)

/// The vehicle dropdown (web `<Select>` whose empty-selection prompt is
/// `t('analytics.weeklyDigest.selectVehicle')`). A native `Menu` shows the selected vehicle (or the
/// `selectVehicle` prompt when none), with that string also serving as the VoiceOver label so the
/// copy always resolves from the catalog.
struct WeeklyDigestVehiclePicker: View {
    let options: [DigestVehicleOption]
    let selectedID: String
    let onSelect: (String) -> Void

    private var selectedLabel: String? {
        options.first { $0.id == selectedID }?.label
    }

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button {
                    onSelect(option.id)
                } label: {
                    if option.id == selectedID {
                        Label(option.label, systemImage: "checkmark")
                    } else {
                        Text(verbatim: option.label)
                    }
                }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "car.fill")
                if let selectedLabel {
                    Text(verbatim: selectedLabel)
                } else {
                    Text("analytics.weeklyDigest.selectVehicle")
                }
                Image(systemName: "chevron.down").font(.caption2)
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .disabled(options.isEmpty)
        .accessibilityLabel(Text("analytics.weeklyDigest.selectVehicle"))
    }
}

// MARK: - Loading skeleton (web `DigestSkeleton`)

/// Mirrors the page layout while the activity loads (web `DigestSkeleton`): a header block, a six-card
/// grid, and a chart block, all rendered as design-system skeletons.
struct WeeklyDigestSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 180, height: 18)
                    TSSkeleton(height: 14)
                }
            }
            TSGlassPanel {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.lg)],
                    spacing: TSSpacing.lg
                ) {
                    ForEach(0 ..< 6, id: \.self) { _ in
                        TSSkeleton(height: 80)
                    }
                }
            }
            TSGlassPanel {
                TSSkeleton(height: 260)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("analytics.weeklyDigest.title"))
    }
}

#if DEBUG
    #Preview("Loaded") {
        WeeklyDigestPage(model: WeeklyDigestPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        WeeklyDigestPage(model: WeeklyDigestPageModel(dataSource: EmptyWeeklyDigestDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        WeeklyDigestPage(model: WeeklyDigestPageModel(dataSource: FailingWeeklyDigestDataSource()))
            .teslaSyncTheme()
    }
#endif
