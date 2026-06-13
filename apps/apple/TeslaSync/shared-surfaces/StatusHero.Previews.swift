//
//  StatusHero.Previews.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  Xcode previews for every real branch of the status card: the five statuses (each with its glyph,
//  tint, and glow), the headline override, the sub-line with the "Live" chip, and the CTA in its resting
//  and loading states. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
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
        .frame(maxWidth: 560, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Statuses — default headlines") {
        staged("healthy · degraded · unhealthy · unknown · maintenance") {
            VStack(spacing: TSSpacing.md) {
                StatusHero(status: .healthy)
                StatusHero(status: .degraded)
                StatusHero(status: .unhealthy)
                StatusHero(status: .unknown)
                StatusHero(status: .maintenance)
            }
        }
    }

    #Preview("Subline + Live chip") {
        staged("sub-line present · live chip nested inside it") {
            VStack(spacing: TSSpacing.md) {
                StatusHero(
                    status: .healthy,
                    subline: "Last checked 12s ago · 8 services",
                    live: true
                )
                StatusHero(
                    status: .degraded,
                    subline: "1 of 8 services degraded · since 14:02"
                )
            }
        }
    }

    #Preview("CTA — resting + loading") {
        staged("primary action · spinning loading state") {
            VStack(spacing: TSSpacing.md) {
                StatusHero(
                    status: .unhealthy,
                    subline: "Telemetry stream offline",
                    cta: StatusHeroAction(label: "Run health check") {}
                )
                StatusHero(
                    status: .maintenance,
                    subline: "Upgrade in progress",
                    cta: StatusHeroAction(label: "Refreshing", isLoading: true) {}
                )
            }
        }
    }

    #Preview("Headline override + live + CTA") {
        staged("custom headline · everything on") {
            StatusHero(
                status: .healthy,
                headline: "Fleet nominal",
                subline: "4 vehicles online",
                live: true,
                cta: StatusHeroAction(label: "Re-run") {}
            )
        }
    }
#endif
