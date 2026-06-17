//
//  SpeedProfilePage.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple)
//
//  Native SwiftUI / HIG parity of web/src/features/driving/pages/SpeedProfilePage.tsx
//  (route `/speed-profile`): the page chrome (web `PageContainer` title + subtitle +
//  the global `VehicleSelect` and the `RangePicker`), the hero speed gauges, the
//  speed-distribution bar chart, the per-bucket detail cards, the efficiency-vs-speed
//  scatter, and the efficiency insight. Every data state the source produces is
//  implemented (loading / empty / error / success).
//
//  Adaptive (ADR-002/006): the header + gauges + bucket-card grid reflow for macOS /
//  iPad regular width vs. compact iPhone; the charts get full width and the page
//  scrolls. All copy resolves from `Localizable.xcstrings` with the web key names;
//  data binds through the `@Observable` `SpeedProfilePageModel` (no networking in the
//  view). Speeds (m/s) and consumption (Wh/km) convert to the user's unit only here,
//  at the render boundary, via the shared `Units` facade (P1/S5, ADR-005).
//

import SwiftUI

struct SpeedProfilePage: View {
    @State private var model: SpeedProfilePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    init(model: SpeedProfilePageModel = SpeedProfilePageModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("translation.speedProfile.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard model.loadState == .loading, model.summary == nil else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect + RangePicker)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    controls
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    controls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.speedProfile.title")
            Text("translation.speedProfile.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `actions`: the global `VehicleSelect` plus the date `RangePicker`.
    @ViewBuilder
    private var controls: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if !model.vehicles.isEmpty { vehiclePicker }
                rangePicker
            }
        } else {
            HStack(spacing: TSSpacing.md) {
                if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 220) }
                rangePicker
            }
        }
    }

    /// Web global `VehicleSelect`.
    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .accessibilityLabel(Text("translation.common.vehicle"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    /// Web date `RangePicker` (preset window menu, default `all`).
    private var rangePicker: some View {
        Picker(selection: rangeBinding) {
            ForEach(SpeedProfileRange.allCases) { range in
                Text(range.label).tag(range)
            }
        } label: {
            Label(
                model.selectedRange.label,
                systemImage: "calendar"
            )
        }
        .pickerStyle(.menu)
        .tint(Color.TS.accent)
        .accessibilityLabel(Text("translation.common.dateRange"))
    }

    private var rangeBinding: Binding<SpeedProfileRange> {
        Binding(
            get: { model.selectedRange },
            set: { newRange in Task { await model.selectRange(newRange) } }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SpeedProfileSkeleton()
        case let .error(message):
            errorView(message)
        case .empty:
            emptyView
        case .ready:
            if let summary = model.summary {
                sections(summary)
            }
        }
    }

    /// Web main `PageContainer` body — the five parity panels, always present.
    private func sections(_ summary: SpeedProfileSummary) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            SpeedProfileHeroSection(summary: summary, units: units, isCompact: isCompact)
            SpeedDistributionSection(buckets: summary.distribution)
            SpeedBucketCardsSection(
                buckets: summary.distribution,
                drives: model.windowedDrives,
                totalReadings: summary.totalReadings,
                units: units
            )
            SpeedEfficiencySection(
                samples: model.scatterSamples,
                hasScatter: model.hasScatter,
                units: units
            )
            SpeedInsightSection(
                optimalSpeedMps: summary.optimalSpeedMps,
                hasInsight: model.hasInsight,
                units: units
            )
        }
    }

    /// Web `data` falsy → `EmptyState message={t('speedProfile.noData')}`.
    private var emptyView: some View {
        TSEmptyState(
            title: "translation.speedProfile.noData",
            systemImage: "speedometer"
        )
        .frame(maxWidth: .infinity, minHeight: 280)
    }

    /// Web `PageContainer error` region — message plus a Retry affordance (ADR-011).
    private func errorView(_ message: String) -> some View {
        let prefix = String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
        return ContentUnavailableView {
            Label(
                String(localized: "translation.speedProfile.title", defaultValue: "Speed Profile"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text(verbatim: "\(prefix): \(message)")
        } actions: {
            Button(String(localized: "translation.common.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 280)
    }
}

// MARK: - Loading skeleton (web PageContainer `loading`)

/// The redacted loading scaffold (web `PageContainer loading` → Skeleton): blocks
/// mirroring the hero gauges, distribution chart, bucket-card grid, scatter and
/// insight panels (ADR-011 — never a blank screen).
struct SpeedProfileSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            block(height: 160)
            block(height: 300)
            grid(count: 5, height: 130)
            block(height: 260)
            block(height: 90)
        }
        .redacted(reason: .placeholder) // parity:allow SwiftUI redaction API, not a stub
        .accessibilityElement()
        .accessibilityLabel(Text("translation.speedProfile.title"))
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(height: height)
    }

    private func grid(count: Int, height: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: height)
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationStack {
            SpeedProfilePage()
        }
        .tsUnits(.metric)
    }

    #Preview("Loaded · Imperial") {
        NavigationStack {
            SpeedProfilePage()
        }
        .tsUnits(.imperial)
    }

    #Preview("Empty") {
        NavigationStack {
            SpeedProfilePage(model: SpeedProfilePageModel(dataSource: EmptySpeedProfileDataSource()))
        }
        .tsUnits(.metric)
    }

    #Preview("Error") {
        NavigationStack {
            SpeedProfilePage(model: SpeedProfilePageModel(dataSource: FailingSpeedProfileDataSource()))
        }
        .tsUnits(.metric)
    }
#endif
