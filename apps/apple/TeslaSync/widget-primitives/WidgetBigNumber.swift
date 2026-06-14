//
//  WidgetBigNumber.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  The public API of the big-number primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetBigNumber.tsx`. Like the web component it is driven entirely
//  by its props (`value`, `unit`, `label`, `subtitle`, `badge`, `valueColor`, `nullDisplay`, `animated`);
//  there is no fetcher. The view binds through ``WidgetBigNumberModel`` for the derived projection + the
//  once-only `view.opened` telemetry (P1/S11), composes the token-driven centered column (P1/S9), and
//  pushes prop changes into the holder via `.onChange` so a reused / rebound surface re-renders
//  faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The big-number display — the SwiftUI parity of `WidgetBigNumber.tsx`. Renders a centered headline
/// figure (an animated count-up, a static figure, or a muted `nullDisplay` null value) with an optional
/// unit affix, an uppercase label, a subtitle, and a tinted badge. A shared widget building block — mount
/// it inside a dashboard widget that supplies the already-formatted, already-converted value + chrome.
public struct WidgetBigNumber: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetBigNumberSurface.slug

    private let input: WidgetBigNumberInput
    @State private var model: WidgetBigNumberModel

    /// The prop-style initializer — the parity of `<WidgetBigNumber value unit label subtitle badge
    /// valueColor nullDisplay animated />`. `value` is the headline figure (`nil` renders the muted
    /// `nullDisplay`); `valueTone` is the native peer of the web `valueColor` (default ``primary``, the
    /// peer of `'text-white'`); `nullDisplay` / `animated` carry the web defaults; `locale` drives the
    /// number grouping.
    public init(
        value: Double?,
        unit: String? = nil,
        label: String? = nil,
        subtitle: String? = nil,
        badge: BigNumberBadge? = nil,
        valueTone: BigNumberValueTone = WidgetBigNumberSurface.defaultValueTone,
        nullDisplay: String = WidgetBigNumberSurface.defaultNullDisplay,
        animated: Bool = WidgetBigNumberSurface.defaultAnimated,
        locale: Locale = .autoupdatingCurrent,
        telemetry: any WidgetBigNumberTelemetry = OSLogWidgetBigNumberTelemetry()
    ) {
        let resolved = WidgetBigNumberInput(
            value: value,
            unit: unit,
            label: label,
            subtitle: subtitle,
            badge: badge,
            valueTone: valueTone,
            nullDisplay: nullDisplay,
            animated: animated,
            locale: locale
        )
        input = resolved
        _model = State(initialValue: WidgetBigNumberModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetBigNumberModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        BigNumberStack(projection: model.projection)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }
}
