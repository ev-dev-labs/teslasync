//
//  Accordion.Previews.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  Xcode previews for every real branch of the collapsible section: the collapsed default, the
//  `defaultOpen` expanded state, the full header chrome (icon + badge + headerExtra), the controlled mode
//  (parent owns `open`), and the empty-body leaf. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
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
        .padding(TSSpacing.md)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleBody() -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: "Range added 142 km over 38 minutes at a Supercharger.")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: "Peak power 168 kW · average 121 kW · cost 11.40.")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func sampleBadge() -> some View {
        Text(verbatim: "3")
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
    }

    #Preview("Collapsed — default") {
        staged("uncontrolled · starts closed") {
            Accordion(title: "Charging details") {
                sampleBody()
            }
        }
    }

    #Preview("Expanded — defaultOpen") {
        staged("uncontrolled · defaultOpen true") {
            Accordion(title: "Charging details", defaultOpen: true) {
                sampleBody()
            }
        }
    }

    #Preview("Full header chrome") {
        staged("icon + badge + headerExtra · open") {
            Accordion(
                title: "Active alerts",
                defaultOpen: true,
                icon: {
                    Image(systemName: "bell.badge")
                },
                badge: {
                    sampleBadge()
                },
                headerExtra: {
                    Image(systemName: "slider.horizontal.3")
                        .foregroundStyle(Color.TS.textMuted)
                },
                content: {
                    sampleBody()
                }
            )
        }
    }

    #Preview("Controlled — parent owns open") {
        @Previewable @State var open = true
        return staged("open bound to parent state") {
            Accordion(
                title: "Charging details",
                open: open,
                onOpenChange: { open = $0 },
                content: { sampleBody() }
            )
        }
    }

    #Preview("Empty body leaf") {
        staged("expanded · nothing to reveal · never a blank box") {
            Accordion(title: "Charging details", defaultOpen: true) {
                AccordionEmptyBody()
            }
        }
    }
#endif
