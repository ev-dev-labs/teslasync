//
//  DriveScore.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  The SwiftUI surface — the public API of the drive-quality score, the parity of the web
//  `<DriveScore drive />`. Like the web component it is driven entirely by its props (the SI drive
//  fields); the only "hook" is the i18n facade (P1/S10), so there is no data binding to wire. The
//  view binds through ``DriveScoreSurfaceModel`` (P1/S8) for the derived projection + resolved copy +
//  the once-only `view.opened` telemetry (P1/S11), and pushes prop changes into the holder via
//  `.onChange` so a reused cell re-renders faithfully. No networking, no Tailwind ports — chrome is
//  token-driven (P1/S9) and copy resolves through P1/S10.
//

import SwiftUI

/// The drive-quality score — the SwiftUI parity of `components/data-display/DriveScore.tsx`. Renders
/// the web component's single branch (an always-present gauge + four breakdown bars) from the SI
/// drive fields, scored by the verbatim `computeDriveScore` port. Used by Drive detail / list
/// surfaces to summarize how efficient, smooth, and range-friendly a trip was.
public struct DriveScore: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DriveScoreSurface.slug

    private let inputs: DriveScoreSurfaceInputs
    @State private var model: DriveScoreSurfaceModel

    /// The prop-style initializer — the parity of `<DriveScore drive />`. The five SI fields are the
    /// canonical drive shape (meters, seconds, m/s, SoC percent); a `nil` resolves with the same
    /// `?? default` chain the web uses.
    public init(
        distanceM: Double? = nil,
        durationS: Double? = nil,
        maxSpeedMps: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil,
        telemetry: any DriveScoreSurfaceTelemetry = OSLogDriveScoreSurfaceTelemetry()
    ) {
        let resolvedInputs = DriveScoreSurfaceInputs(
            distanceM: distanceM,
            durationS: durationS,
            maxSpeedMps: maxSpeedMps,
            startBatteryPct: startBatteryPct,
            endBatteryPct: endBatteryPct
        )
        inputs = resolvedInputs
        _model = State(initialValue: DriveScoreSurfaceModel(inputs: resolvedInputs, telemetry: telemetry))
    }

    /// Builds the surface from a pre-resolved props value type — the host/list-cell seam.
    public init(
        inputs: DriveScoreSurfaceInputs,
        telemetry: any DriveScoreSurfaceTelemetry = OSLogDriveScoreSurfaceTelemetry()
    ) {
        self.inputs = inputs
        _model = State(initialValue: DriveScoreSurfaceModel(inputs: inputs, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host/preview/test seam (a spy telemetry, a seeded drive).
    public init(model: DriveScoreSurfaceModel) {
        inputs = model.inputs
        _model = State(initialValue: model)
    }

    public var body: some View {
        DriveScoreSurfaceContentView(
            projection: model.projection,
            title: model.title,
            scoreCaption: model.scoreCaption,
            scoreAccessibilityLabel: model.scoreAccessibilityLabel,
            rows: model.rows
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: inputs) { _, newInputs in
            model.update(newInputs)
        }
    }
}
