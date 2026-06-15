import SwiftUI

/// Native SwiftUI parity of `web/src/features/dashboard/pages/GlancePage.tsx` (route
/// `/glance`). A focused at-a-glance view of one vehicle: the web page chrome
/// (`PageContainer` title + its loading / error phases), the no-vehicle empty
/// (`GlassPanel` + `EmptyState`), and — once a vehicle resolves — the name + online status
/// badge, the hero battery `RadialGauge`, the four metric cards (Range / Interior /
/// Security / Location), the lock / climate / horn quick actions, the data-freshness chip,
/// and the "Open full app" link. Every data state the source produces is implemented
/// (loading / empty / error / success); each metric degrades to an em dash rather than
/// hiding, exactly as the web `?? '—'` fallbacks do.
///
/// Adaptive (ADR-002/006): the glance column centres on macOS / iPad regular width and
/// fills the compact iPhone width, with the metric grid reflowing 1↔2 columns. All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `GlancePageModel` (no networking in the view). SI range (metres) and
/// interior temperature (Celsius) convert to the user's units only here — at the render
/// boundary — via the shared `Units` facade + `GlanceFormat` (ADR-005).
public struct GlancePage: View {
    @State private var model: GlancePageModel
    @Environment(\.tsUnits) private var units

    /// Navigates to the full app (web `<Link to="/">`). Injected by the route registration;
    /// a no-op default keeps previews / tests self-contained.
    private let onOpenApp: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: GlancePageModel, onOpenApp: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onOpenApp = onOpenApp
    }

    public var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity)
                .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("glance.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
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

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            GlanceSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Web `PageContainer error={vehiclesError}` — a message plus a Retry affordance.
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
        .frame(maxWidth: 420)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web body — no-vehicle empty or the populated glance)

    @ViewBuilder
    private var readyView: some View {
        if model.vehicle == nil {
            noVehiclePanel
        } else {
            glanceColumn
        }
    }

    /// Web `!vehicle` → `GlassPanel` wrapping an `EmptyState` (panel "GlassPanel1").
    private var noVehiclePanel: some View {
        TSGlassPanel {
            TSEmptyState(title: "glance.noVehicle", systemImage: "car.fill")
                .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: 420)
    }

    /// The populated glance (web `FadeIn` column) — centred and width-capped like the web
    /// `max-w-xs` body.
    private var glanceColumn: some View {
        VStack(spacing: TSSpacing.xl) {
            vehicleHeader
            GlanceBatteryGauge(level: model.state?.batteryLevel)
                .padding(.vertical, TSSpacing.sm)
            metricGrid
            quickActions
            GlanceFreshness(timestamp: model.updatedAt, isStale: model.isStale)
            openAppLink
        }
        .frame(maxWidth: 380)
        .frame(maxWidth: .infinity)
    }

    // MARK: Header (web vehicle name + status Badge)

    private var vehicleHeader: some View {
        VStack(spacing: TSSpacing.sm) {
            vehicleNameText
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            GlanceStatusBadge(
                state: model.state?.state,
                tone: model.state?.statusTone ?? .neutral
            )
        }
    }

    /// Web `vehicle.display_name || vehicle.model || t('glance.defaultName')`.
    @ViewBuilder
    private var vehicleNameText: some View {
        if let name = model.vehicle?.resolvedName {
            Text(verbatim: name)
        } else {
            Text("glance.defaultName")
        }
    }

    // MARK: Metric grid (web 4 MetricCards)

    private var metricColumns: [GridItem] {
        let count = isCompact ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    private var metricGrid: some View {
        LazyVGrid(columns: metricColumns, spacing: TSSpacing.md) {
            GlanceMetricCard(
                label: "glance.range",
                value: Text(verbatim: GlanceFormat.range(model.state?.ratedRangeM, units)),
                systemImage: "battery.100",
                tone: .success
            )
            GlanceMetricCard(
                label: "glance.temp",
                value: Text(verbatim: GlanceFormat.temperature(model.state?.insideTempC, units)),
                systemImage: "thermometer.medium",
                tone: .warning
            )
            GlanceMetricCard(
                label: "glance.security",
                value: securityValueText,
                systemImage: model.state?.securityIcon ?? "lock.open.fill",
                tone: model.state?.securityTone ?? .danger
            )
            GlanceMetricCard(
                label: "glance.locationLabel",
                value: locationValueText,
                systemImage: "mappin.and.ellipse",
                tone: .info
            )
        }
    }

    /// Web `state?.is_locked ? t('glance.locked') : t('glance.unlocked')`.
    private var securityValueText: Text {
        Text(LocalizedStringKey(model.state?.isLockedResolved == true ? "glance.locked" : "glance.unlocked"))
    }

    /// Web `getLocationLabel(location)` → a localized label, a verbatim destination, or '—'.
    private var locationValueText: Text {
        let label = model.locationLabel
        if let key = label.localizationKey {
            return Text(LocalizedStringKey(key))
        }
        if let destination = label.destinationText {
            return Text(verbatim: destination)
        }
        return Text(verbatim: GlanceFormat.emptyValue)
    }

    // MARK: Quick actions (web 3 QuickActions)

    private var quickActions: some View {
        HStack(spacing: TSSpacing.md) {
            GlanceQuickAction(
                systemImage: model.state?.lockToggleIcon ?? "lock.fill",
                label: LocalizedStringKey(model.state?.lockToggleLabelKey ?? "glance.action.lock"),
                isLoading: model.commandInFlight == (model.state?.lockToggleCommand ?? .lock),
                isDisabled: !model.canSendCommands,
                action: { Task { await model.send(model.state?.lockToggleCommand ?? .lock) } }
            )
            GlanceQuickAction(
                systemImage: "wind",
                label: LocalizedStringKey(model.state?.climateToggleLabelKey ?? "glance.action.climateOn"),
                isLoading: model.commandInFlight == .climateOn || model.commandInFlight == .climateOff,
                isDisabled: !model.canSendCommands,
                action: { Task { await model.send(model.state?.climateToggleCommand ?? .climateOn) } }
            )
            GlanceQuickAction(
                systemImage: "speaker.wave.2.fill",
                label: "glance.action.horn",
                isLoading: model.commandInFlight == .honkHorn,
                isDisabled: !model.canSendCommands,
                action: { Task { await model.send(.honkHorn) } }
            )
        }
    }

    // MARK: Open-app link (web `<Link to="/">`)

    private var openAppLink: some View {
        Button(action: onOpenApp) {
            Text("glance.openApp")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
    }
}

#if DEBUG
    #Preview("Success") {
        GlancePage(model: GlancePageModel())
            .tsUnits(.metric)
            .teslaSyncTheme()
    }

    #Preview("No vehicle") {
        GlancePage(model: GlancePageModel(dataSource: NoVehicleGlanceDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Degraded") {
        GlancePage(model: GlancePageModel(dataSource: EmptyGlanceDataSource()))
            .tsUnits(.imperial)
            .teslaSyncTheme()
    }

    #Preview("Error") {
        GlancePage(model: GlancePageModel(dataSource: FailingGlanceDataSource()))
            .teslaSyncTheme()
    }
#endif
