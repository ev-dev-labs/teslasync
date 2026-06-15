import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/IngestXRayPage.tsx` (route
/// `/admin/ingest-xray`) — the per-vehicle telemetry diagnostic surface. Reproduces the web page
/// chrome (web `PageContainer`: title + subtitle), the four web `GlassPanel`s, and the X-Ray
/// header strip, composing the P3 X-Ray component library (`XRayControls` / `XRayHeader` /
/// `XRayBucketChart` / `XRayFieldsTable` presentational views + projections from
/// `TeslaSync/feature-views/`) over one central `@Observable` `IngestXRayPageModel` — the native
/// parity of the web page owning `vehicleId` / `windowSel` / `bucketSel` and passing them as props.
///
/// The panels:
///   • GlassPanel1 — the controls bar (vehicle / window / bucket selectors).
///   • GlassPanel2 — the "select a vehicle" empty state, shown until a vehicle is picked.
///   • GlassPanel3 — the bucketed sample-count bar chart (Swift Charts, never a WKWebView).
///   • GlassPanel4 — the sortable per-field statistics table.
/// The header strip (three summary tiles) sits between the controls and the chart, exactly as the
/// web page renders it outside a panel. Each data-bound region switches its own state
/// (loading / empty / error / success) in place rather than gating the surface. All copy resolves
/// from the string catalog with the web key names; data binds through the model (no networking in
/// the view, ADR-004). Adaptive across macOS/iPad (regular) + iPhone (compact) per ADR-002/006.
public struct IngestXRayPage: View {
    @State private var model: IngestXRayPageModel

    public init(model: IngestXRayPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                controlsPanel
                if model.hasVehicle {
                    IngestXRayHeaderSection(model: model)
                    chartPanel
                    fieldsPanel
                } else {
                    noVehiclePanel
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task { await model.loadVehicles() }
        .task(id: model.fetchKey) { await model.reloadData() }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("admin.xray.pageTitle")
            Text("admin.xray.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - GlassPanel1 — controls bar (web controls `GlassPanel`)

    private var controlsPanel: some View {
        TSGlassPanel {
            IngestXRayControlsSection(model: model)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.xray.controls.vehicleAria"))
    }

    // MARK: - GlassPanel2 — no-vehicle empty state (web `vehicleId === null` `GlassPanel`)

    private var noVehiclePanel: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "admin.xray.noVehicle.title",
                message: "admin.xray.noVehicle.message",
                systemImage: "car.2"
            )
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.xray.noVehicle.title"))
    }

    // MARK: - GlassPanel3 — samples-per-bucket chart (web chart `GlassPanel`)

    private var chartPanel: some View {
        TSGlassPanel {
            IngestXRayChartSection(model: model)
        }
    }

    // MARK: - GlassPanel4 — per-field statistics (web fields `GlassPanel`)

    private var fieldsPanel: some View {
        TSGlassPanel {
            IngestXRayFieldsSection(model: model)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        IngestXRayPage(model: {
            let model = IngestXRayPageModel()
            model.selectVehicle(1)
            return model
        }())
            .teslaSyncTheme()
    }

    #Preview("No vehicle") {
        IngestXRayPage(model: IngestXRayPageModel())
            .teslaSyncTheme()
    }

    #Preview("No vehicles available") {
        IngestXRayPage(model: IngestXRayPageModel(dataSource: SampleIngestXRayDataSource(emptyVehicles: true)))
            .teslaSyncTheme()
    }
#endif
