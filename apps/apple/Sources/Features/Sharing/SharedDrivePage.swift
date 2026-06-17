import SwiftUI

/// Native SwiftUI parity of `web/src/features/sharing/pages/SharedDrivePage.tsx`
/// (public share route `/s/:token`). The web page is a chrome-less, unauthenticated branded report:
/// a logo header, an optional hero route map, the drive title / description / date / endpoints, a
/// 7-tile stat grid (distance · duration · efficiency · battery · max-speed · avg-speed ·
/// elevation-gain), a vehicle badge, the elevation + speed profile charts, a "no route data"
/// fallback, and a footer. This view reproduces every region, binding through the `@Observable`
/// `SharedDrivePageModel` (ADR-004 — no networking in the view). It resolves the three web data
/// states — `loading` (spinner), `success` (the report), and the `error || !data` expired view —
/// and, inside success, the empty "no route data" branch. Adaptive across macOS/iPad (regular) and
/// iPhone (compact) via the P2 tokens + P3 components; every value formats at the render boundary
/// through `Units` (SI in, display out — ADR-005); every literal resolves from `Localizable
/// .xcstrings` with the web key names.
public struct SharedDrivePage: View {
    @State private var model: SharedDrivePageModel
    private let onHome: () -> Void

    public init(model: SharedDrivePageModel, onHome: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onHome = onHome
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg.ignoresSafeArea())
            .navigationTitle(Text(navigationTitle))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard model.phase == .loading else { return }
                await model.load()
            }
    }

    private var navigationTitle: String {
        if let title = model.payload?.title, !title.isEmpty { return title }
        return String(localized: "share.header")
    }

    // MARK: - Phase switch (web `isLoading ? Spinner : error || !data ? Expired : report`)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingView
        case .expired:
            SharedDriveExpiredView(onRetry: { Task { await model.refresh() } }, onHome: onHome)
        case .ready:
            if let payload = model.payload {
                report(payload)
            } else {
                SharedDriveExpiredView(onRetry: { Task { await model.refresh() } }, onHome: onHome)
            }
        }
    }

    /// Web full-screen `<Spinner />` loading state.
    private var loadingView: some View {
        ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel(Text("loading"))
    }

    // MARK: - Report (web success body)

    private func report(_ payload: SharedDrivePayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                SharedDriveBrandHeader()
                if model.hasRoute {
                    SharedDriveHeroMap(points: payload.mapPoints)
                }
                SharedDriveTitleBlock(payload: payload)
                SharedDriveStatsSection(drive: payload.drive)
                SharedDriveVehicleBadge(vehicle: payload.vehicle)
                SharedDriveElevationSection(points: payload.elevationProfile)
                SharedDriveSpeedSection(points: payload.speedProfile)
                if model.hasNoRouteData {
                    SharedDriveNoRouteDataPanel()
                }
                SharedDriveFooter()
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 920, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Brand header (web `<header>` Logo + "Shared Drive Report")

/// The branded header row: the TeslaSync lockup beside the muted report label (web header).
struct SharedDriveBrandHeader: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSLogo()
            Text(SharedDriveStrings.header)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Title block (web title / description / date / endpoints)

/// The report headline: the share title, optional description, then the date and (when both
/// addresses are present) the `start → end` route line (web title `<div>`).
struct SharedDriveTitleBlock: View {
    let payload: SharedDrivePayload

    private var routeLine: String? {
        guard let start = payload.drive.startAddress, !start.isEmpty,
              let end = payload.drive.endAddress, !end.isEmpty
        else { return nil }
        return "\(start) → \(end)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: payload.title)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let description = payload.description, !description.isEmpty {
                Text(verbatim: description)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: payload.drive.date)
                if let routeLine {
                    Text(verbatim: routeLine)
                }
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Stats grid (web 7-tile `StatCard` grid)

/// The headline stat grid: seven tiles reflowing 2-up on compact width and 4-up on regular width
/// (web `grid cols default 2 / md 4`). Distance + duration always render; the five optional tiles
/// render their value when present and an em-dash fallback otherwise, so every panel stays
/// visible (ADR-011 — never a blank region). All unit-bearing values format at the render boundary
/// through `Units` / `SharedDriveFormat` (SI in, display out — ADR-005).
struct SharedDriveStatsSection: View {
    let drive: SharedDriveInfo
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(title: SharedDriveStrings.distance, value: distanceValue, systemImage: "mappin")
            TSStatCard(title: SharedDriveStrings.duration, value: durationValue, systemImage: "clock")
            TSStatCard(title: SharedDriveStrings.efficiency, value: efficiencyValue, systemImage: "bolt.fill")
            TSStatCard(title: SharedDriveStrings.battery, value: batteryValue, systemImage: "battery.100")
            TSStatCard(title: SharedDriveStrings.maxSpeed, value: maxSpeedValue, systemImage: "gauge.medium")
            TSStatCard(
                title: SharedDriveStrings.avgSpeed,
                value: avgSpeedValue,
                systemImage: "chart.line.uptrend.xyaxis"
            )
            TSStatCard(title: SharedDriveStrings.elevGain, value: elevationGainValue, systemImage: "mountain.2.fill")
        }
    }

    private var distanceValue: String {
        Units.formatDistance(drive.distanceM, units)
    }

    private var durationValue: String {
        SharedDriveFormat.durationMinutes(drive.durationS)
    }

    private var efficiencyValue: String {
        guard let efficiency = drive.efficiencyWhPerM else { return SharedDriveFormat.fallback }
        return SharedDriveFormat.efficiencyValue(efficiency, units)
    }

    private var batteryValue: String {
        guard let start = drive.startBattery, let end = drive.endBattery else { return SharedDriveFormat.fallback }
        return SharedDriveFormat.batteryValue(start: start, end: end)
    }

    private var maxSpeedValue: String {
        guard let maxSpeed = drive.maxSpeedMps else { return SharedDriveFormat.fallback }
        return Units.formatSpeed(maxSpeed, units)
    }

    private var avgSpeedValue: String {
        guard let avgSpeed = drive.avgSpeedMps else { return SharedDriveFormat.fallback }
        return Units.formatSpeed(avgSpeed, units)
    }

    private var elevationGainValue: String {
        guard let gain = drive.elevationGainM else { return SharedDriveFormat.fallback }
        return SharedDriveFormat.elevationGainValue(gain, units)
    }
}

// MARK: - Vehicle badge (web `GlassPanel` vehicle row — GlassPanel8)

/// The vehicle badge panel: a bolt chip beside the `Tesla {model}` name and color (web vehicle
/// `GlassPanel`). The panel always renders so the region never collapses; when the share omits the
/// vehicle it shows the em-dash fallback (ADR-011).
struct SharedDriveVehicleBadge: View {
    let vehicle: SharedVehicle?

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "bolt.fill")
                    .foregroundStyle(Color.TS.accent)
                    .padding(TSSpacing.sm)
                    .background(Color.TS.surface, in: Circle())
                    .accessibilityHidden(true)
                if let vehicle {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: "Tesla \(vehicle.model)")
                            .font(Font.TS.bodySm)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(verbatim: vehicle.color)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                } else {
                    Text(verbatim: SharedDriveFormat.fallback)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - No route data (web `GlassPanel` EmptyState — GlassPanel11)

/// The no-route-data empty panel (web `GlassPanel` + `EmptyState`): shown when the share has no map,
/// elevation, or speed data. This is the page's empty data state (ADR-011 — never a blank region).
struct SharedDriveNoRouteDataPanel: View {
    var body: some View {
        TSGlassPanel {
            TSEmptyState(title: SharedDriveStrings.noMapData, systemImage: "mappin.slash")
                .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Footer (web footer + "Learn more →")

/// The report footer: the muted attribution line and the "Learn more →" link to the project
/// (web footer `<a>`).
struct SharedDriveFooter: View {
    private static let learnMoreURL = URL(string: "https://github.com/ev-dev-labs/teslasync")

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Divider().overlay(Color.TS.border)
            Text(SharedDriveStrings.footer)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            if let url = Self.learnMoreURL {
                Link(destination: url) {
                    Text(SharedDriveStrings.learnMore)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.accent)
                }
            }
        }
        .padding(.top, TSSpacing.lg)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Expired / error view (web `ExpiredShareView`)

/// The expired / unavailable view (web `ExpiredShareView`): a muted pin glyph, the title +
/// description, a Retry affordance (ADR-011), and the "Go to TeslaSync" home action (web home link).
struct SharedDriveExpiredView: View {
    let onRetry: () -> Void
    let onHome: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            Image(systemName: "mappin.slash.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(SharedDriveStrings.expiredTitle)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(SharedDriveStrings.expiredDescription)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            HStack(spacing: TSSpacing.sm) {
                TSButton("action.retry", variant: .secondary, size: .small, action: onRetry)
                TSButton(SharedDriveStrings.expiredHome, variant: .primary, size: .small, action: onHome)
            }
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            SharedDrivePage(model: SharedDrivePageModel(token: "demo"))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("Imperial / legacy v1") {
        NavigationStack {
            SharedDrivePage(model: SharedDrivePageModel(token: "demo", dataSource: LegacySharedDriveDataSource()))
        }
        .tsUnits(.imperial)
        .teslaSyncTheme()
    }

    #Preview("No route data") {
        NavigationStack {
            SharedDrivePage(model: SharedDrivePageModel(token: "demo", dataSource: NoRouteSharedDriveDataSource()))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("Expired") {
        NavigationStack {
            SharedDrivePage(model: SharedDrivePageModel(token: "demo", dataSource: FailingSharedDriveDataSource()))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }
#endif
