//
//  WidgetGaugeHero.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  The public API of the gauge hero — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetGaugeHero.tsx`. Like the web component it is driven entirely by
//  its props (`gauge`, the optional `stats` / `compact`) plus an accessory slot (the web `children` → a
//  generic `@ViewBuilder Accessory`); there is no fetcher. The view binds through ``WidgetGaugeHeroModel``
//  for the derived layout + the once-only `view.opened` telemetry (P1/S11), composes the token-driven
//  column (P1/S9), and pushes prop changes into the holder via `.onChange` so a reused / rebound gauge
//  re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The gauge hero — the SwiftUI parity of `WidgetGaugeHero.tsx`. Renders a centered column of a radial
/// hero gauge (the web `<RadialGauge>`: a rounded progress arc over a track ring, the formatted reading +
/// unit at its center, and a caption below), then — only in the standard (non-`compact`) variant — an
/// optional wrapping row of supporting stats (web `!compact && stats.length > 0`) and the caller's
/// accessory slot (web `!compact && children`). A shared widget building block — mount it inside a
/// dashboard widget that supplies the already-formatted gauge config + stats.
///
/// The view emits the P1/S11 `view.opened` diagnostic once on appear and binds no data (the hosting widget
/// supplies every input), matching the web presentational component.
public struct WidgetGaugeHero<Accessory: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        WidgetGaugeHeroSurface.slug
    }

    private let input: WidgetGaugeHeroInput
    private let accessory: () -> Accessory
    @State private var model: WidgetGaugeHeroModel

    /// The prop-style initializer — the parity of `<WidgetGaugeHero gauge stats compact>{children}
    /// </WidgetGaugeHero>`. `gauge` is the hero configuration; `stats` (default empty) are the already-
    /// formatted supporting cells; `compact` (default `false`) renders the condensed variant; `accessory`
    /// is the slot rendered below the stats in the standard variant (web `children`).
    public init(
        gauge: GaugeHeroConfig,
        stats: [GaugeHeroStat] = [],
        compact: Bool = false,
        precision: Int = GaugeValueFormatter.defaultPrecision,
        locale: Locale = .current,
        telemetry: any WidgetGaugeHeroTelemetry = OSLogWidgetGaugeHeroTelemetry(),
        @ViewBuilder accessory: @escaping () -> Accessory
    ) {
        let resolved = WidgetGaugeHeroInput(gauge: gauge, stats: stats, compact: compact)
        input = resolved
        self.accessory = accessory
        _model = State(
            initialValue: WidgetGaugeHeroModel(
                input: resolved,
                precision: precision,
                locale: locale,
                telemetry: telemetry
            )
        )
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input). The
    /// accessory slot still lives at the view layer (the web `children`), so it is supplied here.
    public init(model: WidgetGaugeHeroModel, @ViewBuilder accessory: @escaping () -> Accessory) {
        input = model.input
        self.accessory = accessory
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }

    /// The centered column — the native peer of the web `<div className="flex flex-col items-center
    /// justify-center gap-2">`: the always-present ring, then (standard variant only) the optional stats
    /// row and the accessory slot.
    private var content: some View {
        let layout = model.projection
        return VStack(spacing: TSSpacing.sm) {
            GaugeRingView(ring: layout.ring)

            if layout.showsAccessories {
                if !layout.stats.isEmpty {
                    GaugeStatsRow(stats: layout.stats)
                }
                accessory()
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - No-accessory convenience (web `<WidgetGaugeHero>` with no children)

public extension WidgetGaugeHero where Accessory == EmptyView {
    /// Childless initializer — the parity of a `<WidgetGaugeHero>` with no `children`: the gauge plus the
    /// optional stats row, with no accessory slot. Mirrors the web optional `children`.
    init(
        gauge: GaugeHeroConfig,
        stats: [GaugeHeroStat] = [],
        compact: Bool = false,
        precision: Int = GaugeValueFormatter.defaultPrecision,
        locale: Locale = .current,
        telemetry: any WidgetGaugeHeroTelemetry = OSLogWidgetGaugeHeroTelemetry()
    ) {
        self.init(
            gauge: gauge,
            stats: stats,
            compact: compact,
            precision: precision,
            locale: locale,
            telemetry: telemetry
        ) {
            EmptyView()
        }
    }

    /// Injected-model childless convenience — the host / preview / test seam with no accessory slot.
    init(model: WidgetGaugeHeroModel) {
        self.init(model: model) { EmptyView() }
    }
}
