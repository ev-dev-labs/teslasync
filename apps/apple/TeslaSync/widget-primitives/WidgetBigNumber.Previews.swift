//
//  WidgetBigNumber.Previews.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  Xcode previews for every real branch of the big-number primitive: the animated count-up with the full
//  chrome (unit + label + subtitle + badge), the static (non-animated) figure, the muted `nullDisplay`
//  null value, the minimal value-only figure, the value-tone palette, and the four badge variants
//  (success / warning / error → danger / neutral). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope. The locale is pinned so the grouped figures render deterministically.
//

import SwiftUI

#if DEBUG
    private let previewLocale = Locale(identifier: "en_US")

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .frame(height: 140)
                .frame(maxWidth: .infinity)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Animated — full chrome") {
        staged("value + unit + label + subtitle + badge") {
            WidgetBigNumber(
                value: 1420,
                unit: "mi",
                label: "Range",
                subtitle: "EPA estimate",
                badge: BigNumberBadge(text: "Optimal", variant: .success),
                locale: previewLocale
            )
        }
    }

    #Preview("Static — no animation") {
        staged("animated: false · tabular figure · success tone") {
            WidgetBigNumber(
                value: 87,
                unit: "%",
                label: "State of charge",
                valueTone: .success,
                animated: false,
                locale: previewLocale
            )
        }
    }

    #Preview("Null — muted figure") {
        staged("value: nil · muted nullDisplay · never a blank box") {
            WidgetBigNumber(
                value: nil,
                unit: "kWh",
                label: "Energy used",
                subtitle: "No session yet",
                locale: previewLocale
            )
        }
    }

    #Preview("Minimal — value only") {
        staged("just a value · no affixes") {
            WidgetBigNumber(value: 42, locale: previewLocale)
        }
    }

    #Preview("Value-tone palette") {
        staged("primary · success · warning · danger · accent") {
            HStack(spacing: TSSpacing.lg) {
                WidgetBigNumber(value: 12, label: "Primary", locale: previewLocale)
                WidgetBigNumber(value: 34, label: "Success", valueTone: .success, locale: previewLocale)
                WidgetBigNumber(value: 56, label: "Warning", valueTone: .warning, locale: previewLocale)
                WidgetBigNumber(value: 78, label: "Danger", valueTone: .danger, locale: previewLocale)
                WidgetBigNumber(value: 90, label: "Accent", valueTone: .accent, locale: previewLocale)
            }
        }
    }

    #Preview("Badge variants") {
        staged("success · warning · error→danger · neutral") {
            HStack(spacing: TSSpacing.lg) {
                WidgetBigNumber(
                    value: 1,
                    badge: BigNumberBadge(text: "Healthy", variant: .success),
                    locale: previewLocale
                )
                WidgetBigNumber(
                    value: 2,
                    badge: BigNumberBadge(text: "Watch", variant: .warning),
                    locale: previewLocale
                )
                WidgetBigNumber(
                    value: 3,
                    badge: BigNumberBadge(text: "Fault", variant: .error),
                    locale: previewLocale
                )
                WidgetBigNumber(
                    value: 4,
                    badge: BigNumberBadge(text: "Idle", variant: .neutral),
                    locale: previewLocale
                )
            }
        }
    }
#endif
