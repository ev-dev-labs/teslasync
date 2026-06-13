//
//  HistoryListRow.Previews.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  Xcode previews for every real branch of the slot-based history row: the full drive-style row (all
//  slots + actions + link), the minimal primary-only row, the selected row, the action / inert
//  variants, each glow, the chevron-less row, and the checkbox row. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope. The slot content is illustrative sample
//  data (the embedder composes the real chips / badges / route views).
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleScore(_ value: Int) -> some View {
        Text(verbatim: "\(value)")
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.statusSuccess)
    }

    private func samplePrimary() -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: "3:45 PM")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "1h 20m")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private func sampleActions() -> [AnyView] {
        [
            AnyView(Button {} label: { Image(systemName: "eye") }
                .accessibilityLabel(Text(verbatim: "View"))),
            AnyView(Button {} label: { Image(systemName: "map") }
                .accessibilityLabel(Text(verbatim: "Map")))
        ]
    }

    #Preview("Full drive row · link + actions") {
        staged("all slots · navigable link · hover-revealed actions") {
            HistoryListRow(
                glow: .cyan,
                activation: .link(href: "/drives/42", perform: {}),
                actions: sampleActions(),
                primary: { samplePrimary() },
                leading: { sampleScore(95) },
                route: {
                    Text(verbatim: "Home → Office")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                },
                metrics: {
                    Text(verbatim: "42 mph · −12% · 268 Wh/mi")
                },
                insight: {
                    Text(verbatim: "Low efficiency — investigate")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusWarning)
                }
            )
        }
    }

    #Preview("Minimal · primary only") {
        staged("primary only · inert · chevron") {
            HistoryListRow(primary: { samplePrimary() })
        }
    }

    #Preview("Selected · action + checkbox") {
        staged("selected tint · onClick action · checkbox column") {
            HistoryListRow(
                selected: true,
                activation: .action(perform: {}),
                primary: { samplePrimary() },
                checkbox: { Image(systemName: "checkmark.square.fill").foregroundStyle(Color.TS.accent) },
                leading: { sampleScore(78) },
                route: {
                    Text(verbatim: "Supercharger · Fremont")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            )
        }
    }

    #Preview("Glow variants · no chevron") {
        staged("glow cyan / green / purple / none · hideChevron") {
            VStack(spacing: TSSpacing.sm) {
                HistoryListRow(glow: .green, hideChevron: true, primary: {
                    Text(verbatim: "Charging complete").font(Font.TS.body)
                })
                HistoryListRow(glow: .purple, hideChevron: true, primary: {
                    Text(verbatim: "Sentry event").font(Font.TS.body)
                })
                HistoryListRow(glow: .none, hideChevron: true, primary: {
                    Text(verbatim: "Idle").font(Font.TS.body)
                })
            }
        }
    }
#endif
