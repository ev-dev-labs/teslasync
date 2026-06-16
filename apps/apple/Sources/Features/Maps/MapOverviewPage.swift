import SwiftUI

/// Native SwiftUI parity of `web/src/features/maps/pages/MapOverviewPage.tsx` (web route
/// `/live`, native route `.maps`). The live vehicle location screen: the page chrome (web
/// `PageContainer` title + subtitle + the header `VehicleSelect` / freshness / live indicator),
/// the stale-data + GPS banners, the live map (layer switcher, marker callout, recent-trail
/// polyline), the recent route-playback map, the four current-status metric cards
/// (speed · heading · lat-lon · last-updated), the location-details panel (home / work /
/// HomeLink / odometer), the quick-links panel, and the recent location-history table. Every
/// data state the source produces is implemented (loading / empty / error / success), and each
/// panel resolves its own empty state so no region is ever blank (ADR-011).
///
/// Adaptive (ADR-002/006): the header controls, the metric grid, and the location-details grid
/// reflow for macOS / iPad regular width vs. compact iPhone, and the page scrolls in a single
/// column. All copy resolves from `Localizable.xcstrings` with the web key names; speed /
/// distance arrive SI (m/s, m) and convert only here, at the render boundary, via `Units`
/// (ADR-005). Data binds through the `@Observable` `MapOverviewPageModel` (no networking in the
/// view).
public struct MapOverviewPage: View {
    @State private var model: MapOverviewPageModel
    private let onQuickLink: (MapOverviewQuickLink) -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(
        model: MapOverviewPageModel,
        onQuickLink: @escaping (MapOverviewQuickLink) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onQuickLink = onQuickLink
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("mapOverview.pageTitle"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect / freshness)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    headerControls
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    headerControls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("mapOverview.title")
            Text("mapOverview.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the `VehicleSelect` and the `DataFreshnessAuto` refresh affordance.
    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker }
            refreshControl
        }
    }

    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.displayName)) }
        )
        .frame(maxWidth: 200)
        .accessibilityLabel(Text("mapOverview.vehicle"))
    }

    /// Web `DataFreshnessAuto` — a refresh control that surfaces the in-flight refetch.
    private var refreshControl: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            if model.isRefreshing {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "arrow.clockwise")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.accent)
        .disabled(model.isRefreshing)
        .accessibilityLabel(Text("action.refresh"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            MapOverviewSkeleton()
        case let .error(message):
            errorView(message)
        case .empty:
            emptyView
        case .ready:
            readyView
        }
    }

    /// The page-level retryable error (web `PageContainer error` / `anyError`).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(
                    title: "error.loadFailed",
                    onRetry: { Task { await model.refresh() } }
                )
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    /// The page-level empty state — no enrolled vehicle to locate (web `NoVehicleSelected`).
    private var emptyView: some View {
        TSEmptyState(
            title: "mapOverview.title",
            message: "mapOverview.noVehicle",
            systemImage: "car.fill"
        )
        .frame(maxWidth: .infinity, minHeight: 280)
    }

    // MARK: - Ready (web main body — always-rendered panels with their own empties)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.isStale() {
                TSLiveStaleDataBanner()
            }
            if model.latest != nil, !model.hasValidLatest {
                TSAlertBanner(
                    tone: .info,
                    systemImage: "location.slash",
                    title: "mapOverview.noGps"
                )
            }
            MapOverviewMapSection(model: model)
            MapOverviewPlaybackSection(model: model)
            MapOverviewStatusSection(model: model, isCompact: isCompact)
            MapOverviewLocationDetailsSection(model: model, isCompact: isCompact)
            MapOverviewQuickLinksSection(onQuickLink: onQuickLink)
            MapOverviewHistorySection(model: model)
        }
    }
}
