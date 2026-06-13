//
//  TeslaCarViz.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The public API of the live vehicle illustration — the SwiftUI parity of
//  `components/data-display/TeslaCarViz.tsx`. Like the web component it is driven entirely by its props
//  (`batteryLevel`, `isCharging`, `isLocked`, `isClimateOn`, `sentryMode`, `speed`, plus the `size` / `model`
//  styling); there is no fetcher. The view binds through ``TeslaCarVizModel`` for the once-only `view.opened`
//  telemetry (P1/S11) and the props → projection derivation (P1/S8), reads the theme colour scheme + Reduce
//  Motion from the environment to build the palette (P1/S9) and gate motion, composes the whole car in a
//  `Canvas`, and speaks the live state as one combined VoiceOver element (P1/S10). It also exposes
//  ``TeslaCarMini`` — the compact card silhouette the web file exports alongside. No networking, no Tailwind
//  ports.
//

import SwiftUI

/// The live vehicle illustration — the SwiftUI parity of `components/data-display/TeslaCarViz.tsx`. Renders
/// the model silhouette with rolling wheels, lit head/tail lights, a banded battery bar, a lock badge,
/// charging / climate / Sentry decorations, an ambient mood glow, and a status row, all driven by the props.
/// Mount it wherever the web app shows the animated car (the live dashboard, a vehicle detail header).
public struct TeslaCarViz: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        TeslaCarVizSurface.slug
    }

    private let input: TeslaCarVizInput
    @State private var model: TeslaCarVizModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<TeslaCarViz batteryLevel isCharging isLocked isClimateOn
    /// sentryMode speed size model />`. The `telemetry` seam defaults to the `os.Logger` sink; hosts / tests
    /// inject their own. Only `batteryLevel` is required; every other prop carries the web default.
    public init(
        batteryLevel: Double,
        isCharging: Bool = false,
        isLocked: Bool = false,
        isClimateOn: Bool = false,
        sentryMode: Bool = false,
        speed: Double = 0,
        size: TeslaCarVizSize = .md,
        model: TeslaCarModel = .model3,
        telemetry: any TeslaCarVizTelemetry = OSLogTeslaCarVizTelemetry()
    ) {
        let resolved = TeslaCarVizInput(
            batteryLevel: batteryLevel,
            isCharging: isCharging,
            isLocked: isLocked,
            isClimateOn: isClimateOn,
            sentryMode: sentryMode,
            speed: speed,
            size: size,
            model: model
        )
        input = resolved
        _model = State(initialValue: TeslaCarVizModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded projection).
    public init(model: TeslaCarVizModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        let palette = TeslaCarVizPalette(isLight: colorScheme == .light)
        TeslaCarVizContent(projection: projection, palette: palette, animated: !reduceMotion)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: TeslaCarVizStrings.accessibilityLabel))
            .accessibilityValue(Text(verbatim: TeslaCarVizStrings.accessibilityValue(for: projection)))
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newValue in
                model.update(newValue)
            }
    }
}

/// The compact card silhouette + battery sliver — the SwiftUI parity of the web `TeslaCarMini`. A tiny,
/// inert glyph for lists / cards where the full animated illustration is too large; shows the model
/// outline, the banded charge sliver, and a charging dot. Spoken as one combined VoiceOver element.
public struct TeslaCarMini: View {
    private let batteryLevel: Double
    private let isCharging: Bool
    private let model: TeslaCarModel
    @Environment(\.colorScheme) private var colorScheme

    /// The parity of `<TeslaCarMini batteryLevel isCharging model />`.
    public init(batteryLevel: Double, isCharging: Bool = false, model: TeslaCarModel = .model3) {
        self.batteryLevel = batteryLevel
        self.isCharging = isCharging
        self.model = model
    }

    public var body: some View {
        let designHeight: CGFloat = model == .modelX ? 34 : 32
        let palette = TeslaCarVizPalette(isLight: colorScheme == .light)
        let percent = TeslaCarVizProjector.batteryPercent(level: batteryLevel)
        Canvas { context, size in
            CarMiniRenderer.draw(
                context,
                size: size,
                spec: CarMiniSpec(model: model, batteryLevel: batteryLevel, isCharging: isCharging),
                palette: palette
            )
        }
        .frame(width: 64, height: designHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TeslaCarVizStrings.modelName(model)))
        .accessibilityValue(Text(verbatim: TeslaCarVizStrings.batteryPhrase(percent: percent)))
    }
}
