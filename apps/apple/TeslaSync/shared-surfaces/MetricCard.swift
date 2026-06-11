//
//  MetricCard.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  The SwiftUI surface — the public API of the compact metric card, the parity of the web
//  `<MetricCard label value icon color change delta subtitle help />`. Like the web component it is
//  driven entirely by its props; the only "hook" is the i18n facade (P1/S10), so there is no data
//  binding to wire. The view binds through ``MetricCardModel`` (P1/S8) for the derived projection +
//  the localized VoiceOver labels + the once-only `view.opened` telemetry (P1/S11), and pushes prop
//  changes into the holder via `.onChange` so a reused cell re-renders faithfully. No networking, no
//  Tailwind ports — chrome is token-driven (P1/S9) and copy resolves through P1/S10.
//

import SwiftUI

/// The compact metric card — the SwiftUI parity of `components/data-display/MetricCard.tsx`. Renders a
/// glass card with a label (and optional "?" help), a bold value, an optional subtitle, an optional
/// trend (the legacy change pill or the richer direction-aware delta), and an optional colored icon
/// box. Purely presentational: every branch is a function of its props.
public struct MetricCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = MetricCardSurface.slug

    private let inputs: MetricCardInputs
    @State private var model: MetricCardModel

    /// The prop-style initializer — the parity of `<MetricCard … />`. `value` is the headline
    /// (`.number` for a raw number, `.text` for a pre-formatted string); `color` defaults to cyan and
    /// the change / delta / subtitle / help / icon slots are all optional, matching the web defaults.
    /// The delta takes precedence over the legacy change pill (web `change && !delta`).
    public init(
        label: String,
        value: MetricCardValue,
        iconSystemName: String? = nil,
        color: MetricCardColor = .defaultColor,
        change: MetricCardChange? = nil,
        delta: MetricCardDelta? = nil,
        subtitle: String? = nil,
        help: MetricCardHelp? = nil,
        telemetry: any MetricCardTelemetry = OSLogMetricCardTelemetry()
    ) {
        let resolved = MetricCardInputs(
            label: label,
            value: value,
            iconSystemName: iconSystemName,
            color: color,
            change: change,
            delta: delta,
            subtitle: subtitle,
            help: help
        )
        inputs = resolved
        _model = State(initialValue: MetricCardModel(inputs: resolved, telemetry: telemetry))
    }

    /// Number-value convenience — the parity of the web `value: number`. Forwards to the designated
    /// initializer with `.number(value)`.
    public init(
        label: String,
        value: Double,
        iconSystemName: String? = nil,
        color: MetricCardColor = .defaultColor,
        change: MetricCardChange? = nil,
        delta: MetricCardDelta? = nil,
        subtitle: String? = nil,
        help: MetricCardHelp? = nil,
        telemetry: any MetricCardTelemetry = OSLogMetricCardTelemetry()
    ) {
        self.init(
            label: label,
            value: .number(value),
            iconSystemName: iconSystemName,
            color: color,
            change: change,
            delta: delta,
            subtitle: subtitle,
            help: help,
            telemetry: telemetry
        )
    }

    /// String-value convenience — the parity of the web `value: string` (a pre-formatted string).
    /// Forwards to the designated initializer with `.text(value)`.
    public init(
        label: String,
        value: String,
        iconSystemName: String? = nil,
        color: MetricCardColor = .defaultColor,
        change: MetricCardChange? = nil,
        delta: MetricCardDelta? = nil,
        subtitle: String? = nil,
        help: MetricCardHelp? = nil,
        telemetry: any MetricCardTelemetry = OSLogMetricCardTelemetry()
    ) {
        self.init(
            label: label,
            value: .text(value),
            iconSystemName: iconSystemName,
            color: color,
            change: change,
            delta: delta,
            subtitle: subtitle,
            help: help,
            telemetry: telemetry
        )
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: MetricCardModel) {
        inputs = model.inputs
        _model = State(initialValue: model)
    }

    public var body: some View {
        MetricCardContentView(
            inputs: model.inputs,
            projection: model.projection,
            valueAccessibilityLabel: model.valueAccessibilityLabel,
            helpAccessibilityLabel: model.helpAccessibilityLabel,
            learnMoreLabel: model.learnMoreLabel
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: inputs) { _, newInputs in
            model.update(newInputs)
        }
    }
}
