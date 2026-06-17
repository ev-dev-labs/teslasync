//
//  MediaPlayerPage.swift
//  TeslaSync — P4 feature view · P7 · MediaPlayer (Apple)
//
//  SwiftUI / HIG parity of web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx
//  — the in-car media monitor: a now-playing card, a volume gauge + stats row, a
//  volume-over-time area chart, a source-distribution donut and a sortable
//  playback-history table. Adaptive across macOS and iOS (ADR-002, ADR-006). Nine
//  panels, three Swift Charts surfaces (RadialGauge · AreaChart · PieChart), the
//  four data states, and every visible string from the catalog. Bound to
//  `MediaPlayerPageModel`; no business logic in the view body.
//

import SwiftUI

struct MediaPlayerPage: View {
    @State private var model = MediaPlayerPageModel()

    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ScrollView {
            switch model.viewState {
            case .loading:
                loadingView
            case let .error(message):
                errorView(message)
            case .empty:
                emptyView
            case .success:
                contentView
            }
        }
        .navigationTitle(String(localized: "translation.Media Player", defaultValue: "Media Player"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                vehiclePicker
                rangeMenu
            }
        }
        .task { await model.load() }
        .refreshable { await model.refresh() }
    }

    // MARK: - Success / content

    private var contentView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            subtitleHeader
            if model.isStale {
                MediaPlayerStalenessChip()
            }
            if let message = model.inlineErrorMessage {
                MediaPlayerInlineError(message: message)
            }
            MediaNowPlayingCard(latest: model.latest)
            MediaVolumeStatsRow(
                latest: model.latest,
                stats: model.stats,
                volumeMax: model.volumeMax
            )
            chartsRow
            MediaPlaybackHistoryPanel(
                rows: model.historyDescending,
                isLoading: model.isLoadingHistory
            )
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    /// Web charts row (`grid lg:grid-cols-3`): the volume chart spans two columns,
    /// the source donut one. Side-by-side on regular width, stacked on compact.
    @ViewBuilder
    private var chartsRow: some View {
        if sizeClass == .compact {
            VStack(spacing: TSSpacing.lg) {
                volumePanel
                sourcePanel
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                volumePanel
                    .frame(maxWidth: .infinity)
                sourcePanel
                    .frame(maxWidth: 360)
            }
        }
    }

    private var volumePanel: some View {
        MediaVolumeChartPanel(
            points: model.volumeChartData,
            maximum: model.volumeMax,
            isLoading: model.isLoadingHistory
        )
    }

    private var sourcePanel: some View {
        MediaSourceDistributionPanel(
            slices: model.sourceData,
            isLoading: model.isLoadingHistory
        )
    }

    private var subtitleHeader: some View {
        Text(String(
            localized: "translation.Now playing, volume, and listening history",
            defaultValue: "Now playing, volume, and listening history"
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
    }

    // MARK: - Toolbar (web VehicleSelect + RangePicker)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label(model.activeVehicleName, systemImage: "car.fill")
        }
        .pickerStyle(.menu)
        .accessibilityLabel(Text(String(
            localized: "translation.mediaPlayer.selectVehicle",
            defaultValue: "Select vehicle"
        )))
    }

    private var rangeMenu: some View {
        Picker(selection: rangeBinding) {
            ForEach(MediaPlayerRange.allCases) { range in
                Text(range.label).tag(range)
            }
        } label: {
            Label(model.selectedRange.label, systemImage: "calendar")
        }
        .pickerStyle(.menu)
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    private var rangeBinding: Binding<MediaPlayerRange> {
        Binding(
            get: { model.selectedRange },
            set: { newRange in model.selectRange(newRange) }
        )
    }

    // MARK: - Loading state

    private var loadingView: some View {
        VStack(spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                MediaPlayerCard {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        Text(verbatim: "Media player panel")
                            .font(Font.TS.section)
                        Text(verbatim: "Loading media playback data")
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding()
        .frame(maxWidth: 1100)
        .frame(maxWidth: .infinity)
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
    }

    // MARK: - Empty state

    private var emptyView: some View {
        ContentUnavailableView {
            Label(
                String(localized: "translation.Media Player", defaultValue: "Media Player"),
                systemImage: "headphones"
            )
        } description: {
            Text(String(
                localized: "translation.Now playing, volume, and listening history",
                defaultValue: "Now playing, volume, and listening history"
            ))
        }
        .padding()
    }

    // MARK: - Error state

    private func errorView(_ message: String) -> some View {
        let prefix = String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
        return ContentUnavailableView {
            Label(
                String(localized: "translation.Media Player", defaultValue: "Media Player"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text("\(prefix): \(message)")
        } actions: {
            Button(String(localized: "translation.common.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

#Preview {
    NavigationStack {
        MediaPlayerPage()
    }
}
