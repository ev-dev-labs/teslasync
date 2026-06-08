//
//  BatteryPill.swift
//  TeslaSync — P4 feature view · 0073 · BatteryPill (Apple)
//
//  Native, Apple-idiomatic parity of the web `BatteryPill`
//  (web/src/features/analytics/components/weekly-digest/BatteryPill.tsx).
//
//  A pure presentational chip: a glass panel pairing a status-tinted battery
//  glyph with a caption label, a bold `fmtInt(level)%` readout, and a trailing
//  capsule meter whose fill tracks the charge level. It owns no data — exactly
//  like the web component — so the loading / empty / error / stale / offline
//  states belong to whatever surface embeds the pill, not to the pill itself.
//  The branches the web source actually carries are reproduced in full by
//  ``BatteryPillPresentation``: the `STATUS_COLORS` threshold ladder, the
//  `safeNumber`-guarded value (non-finite ⇒ `0%`), and the `min(level, 100)`
//  meter clamp.
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with the
//  ``BatteryPillSurface/slug``.
//

import SwiftUI

// MARK: - BatteryPill (the feature surface)

/// The composable battery chip. Bind the `level` (0–100 state of charge) and a
/// localized `label` (a P1/S10 catalog key — never raw English); the tint, value
/// text, and meter fill are derived by ``BatteryPillPresentation``.
public struct BatteryPill: View {
    private let label: LocalizedStringKey
    private let presentation: BatteryPillPresentation
    private let telemetry: any BatteryPillTelemetry

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initialiser.
    /// - Parameters:
    ///   - level: state of charge (web `level`); the threshold ladder and meter
    ///     clamp tolerate any `Double`, including non-finite and out-of-range.
    ///   - label: the caption (web `label`) — a P1/S10 catalog key.
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        level: Double,
        label: LocalizedStringKey,
        telemetry: any BatteryPillTelemetry = OSLogBatteryPillTelemetry()
    ) {
        self.label = label
        self.telemetry = telemetry
        presentation = BatteryPillPresentation(level: level)
    }

    public var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                icon
                readout
                Spacer(minLength: TSSpacing.md)
                meter
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(accessibilityValue)
        .task { BatteryPillSurface.reportOpen(to: telemetry) }
    }

    // MARK: Icon (web `<Battery>` tinted by status)

    private var icon: some View {
        Image(systemName: presentation.iconSystemName)
            .font(.system(size: 20, weight: .regular))
            .foregroundStyle(presentation.tint.color)
            .accessibilityHidden(true)
    }

    // MARK: Label + value (web `<span class="flex flex-col">`)

    private var readout: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            // web: text-xs text-[var(--text-secondary)]
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            // web: text-sm font-bold, colored by status (dynamic ⇒ inline style).
            Text(verbatim: percentText)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(presentation.tint.color)
        }
    }

    // MARK: Meter (web track + fill capsule)

    private var meter: some View {
        Capsule(style: .continuous)
            .fill(Color.TS.border)
            .frame(width: Self.meterWidth, height: Self.meterHeight)
            .overlay(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(presentation.tint.color)
                    .frame(width: Self.meterWidth * presentation.fillFraction)
            }
            .animation(
                reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration),
                value: presentation.fillFraction
            )
            .accessibilityHidden(true)
    }

    // MARK: Derived text

    /// The full value string: grouped integer + percent sign (web
    /// `{fmtInt(level)}%`). The `%` is a unit symbol, appended verbatim — the
    /// same convention as the shared `TSPercentage` formatter.
    private var percentText: String {
        "\(presentation.percentText())%"
    }

    /// VoiceOver value: the spoken percent plus the resolved status word, so the
    /// traffic-light color carries meaning without sight.
    private var accessibilityValue: Text {
        Text(verbatim: percentText)
            + Text(verbatim: ", ")
            + Text(presentation.tint.accessibilityStatusKey)
    }

    // Meter geometry (web `h-2 w-16`).
    private static let meterWidth: CGFloat = 64
    private static let meterHeight: CGFloat = 8
}
