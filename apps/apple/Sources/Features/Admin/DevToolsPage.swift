import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/DevToolsPage.tsx` (route
/// `/dev-tools`). Reproduces the web page chrome (web `PageContainer`: title + subtitle)
/// and the tabbed shell — a five-section segmented navigation (Fleet API, Telemetry,
/// Infrastructure, Utilities, Reference) in the same order as the web `TABS`. Each tab
/// renders native, local/static content (the manifest scopes this unit to "renders from
/// navigation values / local state, no API data sources"); the live Fleet-API/telemetry
/// request paths belong to the separate FleetAPI / FleetTelemetryCoverage parity units.
///
/// Adaptive (ADR-002/006): the tab content lays out responsive grids that collapse on
/// compact iPhone widths and expand on macOS/iPad. Copy resolves from
/// `Localizable.xcstrings`; tab/selection state binds through `DevToolsPageModel`.
public struct DevToolsPage: View {
    @State private var model: DevToolsPageModel

    public init(model: DevToolsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                TSTabs(selection: $model.selectedTab, tabs: tabs)
                    .accessibilityLabel(Text("devtools.a11y.tabs"))
                tabContent
                    .id(model.selectedTab)
                    .transition(.opacity)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.selectedTab)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    /// Tab descriptors (web `TABS`). Computed (not a static let) because `TSTab` carries
    /// a non-`Sendable` `LocalizedStringKey`.
    private var tabs: [TSTab<DevToolsTab>] {
        DevToolsTab.allCases.map { TSTab($0, $0.titleKey, systemImage: $0.systemImage) }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("devtools.title")
            Text("devtools.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Tab router (web `FadeIn` keyed switch over the active tab)

    @ViewBuilder
    private var tabContent: some View {
        switch model.selectedTab {
        case .fleetAPI: DevToolsFleetAPITab()
        case .telemetry: DevToolsTelemetryTab()
        case .infrastructure: DevToolsInfrastructureTab()
        case .utilities: DevToolsUtilitiesTab(model: model)
        case .reference: DevToolsReferenceTab()
        }
    }
}

#if DEBUG
    #Preview("DevTools") {
        DevToolsPage(model: DevToolsPageModel())
            .teslaSyncTheme()
    }

    #Preview("DevTools · Utilities") {
        DevToolsPage(model: DevToolsPageModel(selectedTab: .utilities))
            .teslaSyncTheme()
    }
#endif
