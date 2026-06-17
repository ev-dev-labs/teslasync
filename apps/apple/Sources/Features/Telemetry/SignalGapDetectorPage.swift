//
//  SignalGapDetectorPage.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/SignalGapDetector (Apple)
//
//  Native SwiftUI / Apple HIG parity of
//  web/src/features/telemetry/pages/SignalGapDetectorPage.tsx (route `/signal-gaps`).
//
//  The web page is a thin wrapper around the shared signal catalog: a `PageContainer`
//  (title `signalGap.title` + subtitle `signalGap.subtitle` + a `<VehicleSelect/>` action)
//  whose body is either the "select a vehicle" `EmptyState` (no scope) or the
//  `<SignalCatalogPanel vehicleId>` catalog (a scope is set). This view reproduces all of
//  that natively: the adaptive header (macOS / iPad regular vs. compact iPhone, ADR-002/006),
//  the always-rendered empty state (never a blank region, ADR-011), and the mounted catalog
//  surface. All copy resolves from `Localizable.xcstrings` with the web key names; data binds
//  through the `@Observable` `SignalGapDetectorPageModel` (no networking in the view, ADR-004).
//

import SwiftUI

public struct SignalGapDetectorPage: View {
    @State private var model: SignalGapDetectorPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Picker width on the regular-width header row (web `<VehicleSelect/>` ~ `w-64`).
    private static let pickerMaxWidth: CGFloat = 260
    /// Keeps the no-vehicle empty state tall enough to breathe (web `EmptyState` block).
    private static let emptyMinHeight: CGFloat = 320

    public init(model: SignalGapDetectorPageModel) {
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
        .task { await model.load() }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle + <VehicleSelect/> action)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    vehiclePicker
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    vehiclePicker.frame(maxWidth: Self.pickerMaxWidth, alignment: .trailing)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("signalGap.title")
            Text("signalGap.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The web header action `<VehicleSelect/>` — the shared per-page vehicle scope picker, bound to the
    /// model's single state-holder (which commits a chosen id through `selectVehicle`).
    private var vehiclePicker: some View {
        VehicleSelect(model: model.vehicleSelectModel)
    }

    // MARK: - Body (web EmptyState vs. <SignalCatalogPanel>)

    @ViewBuilder
    private var content: some View {
        if model.hasSelection {
            catalogSection
        } else {
            noVehicleState
        }
    }

    /// Web `!vehicleId || vehicleId <= 0` branch — the "select a vehicle to begin" empty state with
    /// the `Activity` glyph (SF Symbol `waveform.path.ecg`). Always rendered, never a blank region.
    private var noVehicleState: some View {
        TSEmptyState(
            title: "signalGap.noVehicle",
            message: "signalGap.noVehicleDesc",
            systemImage: "waveform.path.ecg"
        )
        .frame(maxWidth: .infinity, minHeight: Self.emptyMinHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("signalGap.noVehicle"))
        .accessibilityHint(Text("signalGap.noVehicleDesc"))
    }

    /// Web `<SignalCatalogPanel vehicleId>` branch — the mounted staleness-aware signal catalog. The
    /// `.id(selectedVehicleID)` re-creates the surface (re-running its start/stop lifecycle) when the
    /// scope changes, the native analogue of re-keying the web hook on `vehicleId`.
    @ViewBuilder
    private var catalogSection: some View {
        if let catalog = model.catalogModel {
            SignalCatalogPanel(model: catalog)
                .id(model.selectedVehicleID)
        }
    }
}

#if DEBUG
    #Preview("No vehicle (empty)") {
        SignalGapDetectorPage(model: SignalGapDetectorPageModel())
            .teslaSyncTheme()
    }

    #Preview("Vehicle selected (catalog)") {
        SignalGapDetectorPage(model: SignalGapDetectorPageModel(initialVehicleID: 1))
            .teslaSyncTheme()
    }
#endif
