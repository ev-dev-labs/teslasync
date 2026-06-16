import SwiftUI

/// Native SwiftUI parity of `web/src/features/maps/pages/NavigationRoutePage.tsx` (route `/navigation`).
/// Live location tracking + navigation status: the page chrome (web `PageContainer`: title + subtitle +
/// the global `VehicleSelect`, the `LiveIndicator`, and the Refresh action), the navigation-status
/// panel, the location-status cards, the route-metric cards, the speed-profile area chart, the route
/// waypoints, the route traffic delay, the recent destinations, the home/work presence line chart, and
/// the location-history table. Every data state the sources produce is implemented (loading / empty /
/// error / success).
///
/// Adaptive (ADR-002/006): the header, the status-card grid, and the metric grid reflow for macOS / iPad
/// regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the web key
/// names; data binds through the `@Observable` `NavigationRoutePageModel` (no networking in the view).
/// Distance / speed / duration convert to the user's unit preference only here, at the render boundary,
/// via the shared `Units` facade (ADR-005).
public struct NavigationRoutePage: View {
    @State private var model: NavigationRoutePageModel
    @Environment(\.tsUnits) private var units

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: NavigationRoutePageModel) {
        _model = State(initialValue: model)
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
        .navigationTitle(Text("nav.pageTitle"))
        .refreshable { await model.refresh() }
        .task {
            guard model.loadState == .loading, model.vehicles.isEmpty else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect + LiveIndicator + Refresh)

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
            TSPageTitle("nav.pageTitle")
            Text("nav.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `actions`: the global `VehicleSelect`, the `LiveIndicator`, and the Refresh button.
    private var controls: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    if !model.vehicles.isEmpty { vehiclePicker }
                    HStack(spacing: TSSpacing.md) {
                        TSLiveIndicator(isLive: model.isLive)
                        refreshButton
                    }
                }
            } else {
                HStack(spacing: TSSpacing.md) {
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 220) }
                    TSLiveIndicator(isLive: model.isLive)
                    refreshButton
                }
            }
        }
    }

    /// Web global `VehicleSelect`.
    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .accessibilityLabel(Text("nav.pageTitle"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    /// Web Refresh `Button` (icon + `nav.refresh`).
    private var refreshButton: some View {
        TSButton(variant: .ghost, size: .small, isLoading: model.isRefreshing) {
            Task { await model.refresh() }
        } label: {
            Label("nav.refresh", systemImage: "arrow.clockwise")
        }
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NavigationRouteSkeleton()
        case let .error(message):
            errorView(message)
        case .empty:
            TSEmptyState(
                title: "nav.pageTitle",
                message: "common.noData",
                systemImage: "location.slash"
            )
            .frame(maxWidth: .infinity, minHeight: 240)
        case .ready:
            sections
        }
    }

    /// Web main `PageContainer` body (`vehicleId !== null && <FadeIn>…`): every panel, always present;
    /// each surfaces its own loading / empty / error region (never a blank page).
    private var sections: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if let message = model.anyErrorMessage {
                NavErrorBanner(message: message)
            }
            NavStatusPanel(model: model, units: units, isCompact: isCompact)
            if model.latest != nil, !model.hasValidLocation {
                TSInlineCallout(tone: .info, message: "nav.noGps")
            }
            NavLocationStatusSection(model: model, isCompact: isCompact)
            NavMetricsSection(model: model, units: units, isCompact: isCompact)
            NavSpeedProfileSection(model: model, units: units)
            NavWaypointsSection(model: model, units: units)
            NavTrafficDelaySection(model: model, units: units)
            NavRecentDestinationsSection(model: model, units: units)
            NavPresenceSection(model: model)
            NavLocationHistorySection(model: model)
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "nav.pageTitle",
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }
}

/// Web inline `AlertBanner` for a feed error: the localized `error.loadFailed` prefix plus the raw error
/// detail (web `${t('error.loadFailed')}: ${getErrorMessage(err)}`).
struct NavErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
            (Text("error.loadFailed") + Text(verbatim: ": \(message)"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// Web `PageContainer loading` skeleton — the header, the status grid, and the chart blocks.
struct NavigationRouteSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSPageHeaderSkeleton()
            TSStatGridSkeleton(count: 4)
            TSChartBlockSkeleton()
            TSChartBlockSkeleton()
        }
        .accessibilityLabel(Text("nav.pageTitle"))
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationRoutePage(model: NavigationRoutePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationRoutePage(model: NavigationRoutePageModel(dataSource: NoVehiclesNavigationRouteDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationRoutePage(model: NavigationRoutePageModel(dataSource: FailingNavigationRouteDataSource()))
            .teslaSyncTheme()
    }
#endif
