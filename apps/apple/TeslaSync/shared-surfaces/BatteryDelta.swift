//
//  BatteryDelta.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  The SwiftUI surface — the public API of the battery state-of-charge delta, the parity of the web
//  `<BatteryDelta startPct endPct showIcon variant />`. Like the web component it is driven entirely
//  by its props; the only "hook" is the i18n facade (P1/S10), so there is no data binding to wire.
//  The view binds through ``BatteryDeltaModel`` (P1/S8) for the derived projection + the once-only
//  `view.opened` telemetry (P1/S11), and pushes prop changes into the holder via `.onChange` so a
//  reused cell re-renders faithfully. No networking, no Tailwind ports — chrome is token-driven
//  (P1/S9) and copy resolves through P1/S10.
//

import SwiftUI

/// The battery state-of-charge delta — the SwiftUI parity of `components/data-display/BatteryDelta.tsx`.
/// Renders the two real branches of the web source (muted "—" when data is missing, a sign-/tone-
/// decorated delta otherwise), in either the `compact` ("+12%") or `pair` ("79% → 78%") variant, with
/// an optional battery icon. Used by both Drives (deltas usually negative — the trip drained the
/// battery) and Charging (deltas usually positive — the session filled it).
public struct BatteryDelta: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = BatteryDeltaSurface.slug

    private let inputs: BatteryDeltaInputs
    @State private var model: BatteryDeltaModel

    /// The prop-style initializer — the parity of `<BatteryDelta startPct endPct showIcon variant />`.
    /// `startPct` / `endPct` are the SoC endpoints (0–100); a `nil` or non-finite value resolves to
    /// the muted "—" branch. `variant` defaults to `compact` and `showIcon` to `true`, matching the
    /// web defaults.
    public init(
        startPct: Double?,
        endPct: Double?,
        showIcon: Bool = true,
        variant: BatteryDeltaVariant = .defaultVariant,
        telemetry: any BatteryDeltaTelemetry = OSLogBatteryDeltaTelemetry()
    ) {
        let resolvedInputs = BatteryDeltaInputs(
            startPct: startPct,
            endPct: endPct,
            variant: variant,
            showIcon: showIcon
        )
        inputs = resolvedInputs
        _model = State(initialValue: BatteryDeltaModel(inputs: resolvedInputs, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host/preview/test seam (a spy telemetry, a seeded input).
    public init(model: BatteryDeltaModel) {
        inputs = model.inputs
        _model = State(initialValue: model)
    }

    public var body: some View {
        BatteryDeltaContentView(
            projection: model.projection,
            showIcon: model.showIcon,
            accessibilityLabel: model.accessibilityLabel
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: inputs) { _, newInputs in
            model.update(newInputs)
        }
    }
}
