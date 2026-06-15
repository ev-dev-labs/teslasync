import SwiftUI

/// Native SwiftUI parity of `web/src/features/charging/pages/PowersharePage.tsx`
/// (route `/powershare`). Bidirectional power sharing for the selected vehicle: the web
/// page chrome (`PageContainer` title + subtitle + the header `VehicleSelect`), the
/// Powershare Status panel (its header status badge plus the Type / Output-Power /
/// Hours-Remaining metric cards or a no-data empty), and the Stop Reason panel (the
/// recorded reason badge + help or a no-stop-reason empty). Every data state the source
/// produces is implemented (loading / error, and each panel's own empty / success).
///
/// Adaptive (ADR-002/006): the status metric grid reflows for macOS / iPad regular width
/// vs. compact iPhone, and the panels stack in a scroll view. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `PowersharePageModel` (no networking in the view). The five Powershare signals arrive
/// in their display units (kW power, hours runtime, plus status / type / stop-reason
/// text), so the view formats them at the render boundary via `PowershareFormat` without
/// further SI conversion — nothing non-SI is stored or computed (ADR-005).
public struct PowersharePage: View {
    @State private var model: PowersharePageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: PowersharePageModel) {
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
        .navigationTitle(Text("powershare.title"))
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

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect)

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
            TSPageTitle("powershare.title")
            Text("powershare.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the `VehicleSelect` plus a refresh affordance that surfaces the
    /// in-flight refetch (web `DataFreshnessAuto`).
    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker }
            refreshControl
        }
    }

    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .frame(maxWidth: 220)
        .accessibilityLabel(Text("powershare.selectVehicle"))
    }

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
            PowershareSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
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
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body — the two always-rendered panels)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            PowershareStatusSection(snapshot: model.snapshot)
            PowershareStopReasonSection(snapshot: model.snapshot)
        }
    }
}

#if DEBUG
    #Preview("Active") {
        PowersharePage(model: PowersharePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        PowersharePage(model: PowersharePageModel(dataSource: EmptyPowershareDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        PowersharePage(model: PowersharePageModel(dataSource: FailingPowershareDataSource()))
            .teslaSyncTheme()
    }
#endif
