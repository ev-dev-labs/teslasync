//
//  RangeSlider.Previews.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  Xcode previews for every real branch of the dual-thumb range slider: the default controlled slider, the
//  label hidden, a custom `formatValue` (currency), custom per-thumb a11y names, the disabled state, the
//  collision case (both thumbs near the same edge, exercising the `lowPct > 50` z-order), and the
//  degenerate-range affordance (`max <= min`). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Default — controlled") {
        @Previewable @State var range = (20.0, 80.0)
        return staged("value [20, 80] · min 0 · max 100 · step 1") {
            RangeSlider(
                value: range,
                min: 0,
                max: 100,
                label: "Price range",
                onChange: { range = ($0, $1) }
            )
        }
    }

    #Preview("Label hidden") {
        @Previewable @State var range = (35.0, 65.0)
        return staged("showLabel false · track only") {
            RangeSlider(
                value: range,
                min: 0,
                max: 100,
                label: "State of charge",
                showLabel: false,
                onChange: { range = ($0, $1) }
            )
        }
    }

    #Preview("Custom format — currency") {
        @Previewable @State var range = (12.0, 48.0)
        return staged("formatValue → $n") {
            RangeSlider(
                value: range,
                min: 0,
                max: 60,
                step: 1,
                label: "Charge cost",
                formatValue: { "$\(Int($0))" },
                onChange: { range = ($0, $1) }
            )
        }
    }

    #Preview("Custom thumb labels") {
        @Previewable @State var range = (2.0, 9.0)
        return staged("minThumbLabel / maxThumbLabel overrides") {
            RangeSlider(
                value: range,
                min: 0,
                max: 12,
                label: "Departure window",
                minThumbLabel: "Earliest hour",
                maxThumbLabel: "Latest hour",
                onChange: { range = ($0, $1) }
            )
        }
    }

    #Preview("Disabled") {
        staged("disabled · non-interactive, dimmed") {
            RangeSlider(
                value: (30.0, 70.0),
                min: 0,
                max: 100,
                label: "Temperature band",
                disabled: true,
                onChange: { _, _ in }
            )
        }
    }

    #Preview("Edge collision — z-order") {
        @Previewable @State var range = (88.0, 96.0)
        return staged("both thumbs past midpoint · low raised (lowPct > 50)") {
            RangeSlider(
                value: range,
                min: 0,
                max: 100,
                label: "High band",
                onChange: { range = ($0, $1) }
            )
        }
    }

    #Preview("Degenerate range — empty affordance") {
        staged("max <= min · never a blank box") {
            RangeSlider(
                value: (10.0, 10.0),
                min: 10,
                max: 10,
                label: "Fixed value",
                onChange: { _, _ in }
            )
        }
    }
#endif
