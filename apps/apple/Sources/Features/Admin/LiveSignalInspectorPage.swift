import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/LiveSignalInspectorPage.tsx`
/// (route `/admin/live-signals`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + the `LiveIndicator` action shown once a vehicle is picked) and the
/// three `GlassPanel`s the source renders: the vehicle-picker controls (GlassPanel1), the
/// "select a vehicle" prompt shown until one is chosen (GlassPanel2), and the live
/// snapshot panel that embeds the P3 `LiveSignalsTable` (GlassPanel3).
///
/// Two data sources drive the page — the vehicle list (web `useVehicles`) and the live
/// signal snapshot (web `useVehicleLiveSignals`). Every data state each produces is
/// implemented: the controls panel renders the vehicles source's loading / empty / error
/// / success, and the embedded `LiveSignalsTable` renders the live source's loading /
/// empty / success (+ error). Adaptive (ADR-002/006): the embedded table reflows from a
/// columnar grid on macOS / iPad regular width to a card list on compact iPhone. All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `LiveSignalInspectorPageModel` (no networking in the view, ADR-004).
public struct LiveSignalInspectorPage: View {
    @State private var model: LiveSignalInspectorPageModel

    /// Picker width on the controls row (web `w-64` = 256pt).
    private static let pickerWidth: CGFloat = 256
    /// Keeps the no-vehicle / snapshot panels tall enough to breathe (web `min-h`).
    private static let panelMinHeight: CGFloat = 280

    public init(model: LiveSignalInspectorPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                controlsPanel
                if model.hasSelection {
                    snapshotPanel
                } else {
                    noVehiclePanel
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.vehiclesState { return }
            await model.load()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle + LiveIndicator action)

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle("admin.liveSignals.pageTitle")
                Text("admin.liveSignals.subtitle")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            if model.hasSelection {
                TSLiveIndicator(isLive: isLive)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Whether the live stream is fresh (web `LiveIndicator` on a foregrounded poll).
    private var isLive: Bool {
        model.liveSignals?.connection == .live
    }

    // MARK: - GlassPanel 1 — vehicle picker controls (web first GlassPanel)

    private var controlsPanel: some View {
        TSGlassPanel {
            controlsBody
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.liveSignals.controls.vehicleAria"))
    }

    @ViewBuilder
    private var controlsBody: some View {
        switch model.vehiclesState {
        case .loading:
            TSSpinner(label: "admin.liveSignals.vehicles.loading")
                .padding(.vertical, TSSpacing.xs)
        case .empty:
            emptyVehicles
        case let .error(message):
            vehiclesError(message)
        case .loaded:
            vehiclePicker
        }
    }

    /// The vehicle dropdown — a native menu `Picker` (web `<Select>`), tagged by the
    /// optional vehicle id, with the localized "select vehicle…" sentinel as the first
    /// option and the web aria-label on the control.
    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            Text("admin.liveSignals.controls.selectVehicle").tag(Int64?.none)
            ForEach(model.vehicles) { vehicle in
                Text(verbatim: vehicle.label).tag(Int64?.some(vehicle.id))
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: Self.pickerWidth, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityLabel(Text("admin.liveSignals.controls.vehicleAria"))
    }

    /// `Int64?` binding: reads the model's selection, routes changes through
    /// `selectVehicle` (web `onChange` → `setVehicleId`).
    private var vehicleBinding: Binding<Int64?> {
        Binding(
            get: { model.selectedVehicleID },
            set: { model.selectVehicle($0) }
        )
    }

    /// The vehicles source resolved with zero rows (web would render only the sentinel).
    private var emptyVehicles: some View {
        TSEmptyState(
            title: "admin.liveSignals.vehicles.empty",
            message: "admin.liveSignals.vehicles.emptyMessage",
            systemImage: "car"
        )
        .frame(maxWidth: .infinity)
    }

    /// The vehicles source failed — an inline message with a Retry affordance (HIG).
    private func vehiclesError(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text("admin.liveSignals.vehicles.error")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton("admin.liveSignals.action.retry", variant: .secondary, size: .small) {
                Task { await model.refresh() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(verbatim: message))
    }

    // MARK: - GlassPanel 2 — no-vehicle prompt (web second GlassPanel / EmptyState)

    private var noVehiclePanel: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "admin.liveSignals.noVehicle.title",
                message: "admin.liveSignals.noVehicle.message",
                systemImage: "dot.radiowaves.left.and.right"
            )
            .frame(maxWidth: .infinity, minHeight: Self.panelMinHeight)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.liveSignals.noVehicle.title"))
    }

    // MARK: - GlassPanel 3 — live snapshot (web third GlassPanel + LiveSignalsTable)

    private var snapshotPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "waveform.path.ecg")
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    TSPanelTitle("admin.liveSignals.panels.snapshot")
                }
                snapshotBody
            }
            .frame(maxWidth: .infinity, minHeight: Self.panelMinHeight, alignment: .topLeading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.liveSignals.panels.snapshot"))
    }

    @ViewBuilder
    private var snapshotBody: some View {
        if let live = model.liveSignals {
            // `.id` re-creates the table (and re-runs its start/stop lifecycle) when the
            // selected vehicle changes — the native analogue of re-keying the web hook.
            LiveSignalsTable(model: live)
                .id(model.selectedVehicleID)
        }
    }
}

#if DEBUG
    #Preview("Loaded — no selection") {
        LiveSignalInspectorPage(model: LiveSignalInspectorPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty vehicles") {
        LiveSignalInspectorPage(
            model: LiveSignalInspectorPageModel(vehicleSource: PreviewEmptyVehicles())
        )
        .teslaSyncTheme()
    }

    #Preview("Vehicles error") {
        LiveSignalInspectorPage(
            model: LiveSignalInspectorPageModel(vehicleSource: PreviewFailingVehicles())
        )
        .teslaSyncTheme()
    }

    /// Preview seam yielding no vehicles (drives the controls empty state).
    private struct PreviewEmptyVehicles: LiveSignalInspectorVehicleSource {
        func load() async throws -> [InspectorVehicle] {
            []
        }
    }

    /// Preview seam that fails (drives the controls error state).
    private struct PreviewFailingVehicles: LiveSignalInspectorVehicleSource {
        struct Failure: Error {}
        func load() async throws -> [InspectorVehicle] {
            throw Failure()
        }
    }
#endif
