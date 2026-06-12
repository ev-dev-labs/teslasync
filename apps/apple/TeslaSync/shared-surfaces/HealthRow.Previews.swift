//
//  HealthRow.Previews.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  Xcode previews for every real branch of the single-line health summary row: each status (with its
//  recoloured dot + summary), the icon present / absent variants, the internal-link / external-link /
//  action / inert activations, and a stacked at-a-glance grid (the web usage — rows stacked inside a
//  panel). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The
//  sample labels / summaries are illustrative (the embedder supplies the real, localized strings).
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
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

    #Preview("All statuses · stacked grid") {
        staged("healthy / degraded / unhealthy / unknown / maintenance · navigable rows") {
            VStack(spacing: 0) {
                HealthRow(
                    status: .healthy,
                    label: "Vehicles",
                    summary: "12 / 12 healthy",
                    activation: .link(to: "/vehicles", perform: {}),
                    icon: { Image(systemName: "car.fill") }
                )
                HealthRow(
                    status: .degraded,
                    label: "Telemetry",
                    summary: "3 streams lagging",
                    activation: .link(to: "/telemetry", perform: {}),
                    icon: { Image(systemName: "antenna.radiowaves.left.and.right") }
                )
                HealthRow(
                    status: .unhealthy,
                    label: "MQTT broker",
                    summary: "disconnected",
                    activation: .link(to: "/system", perform: {}),
                    icon: { Image(systemName: "bolt.horizontal.circle") }
                )
                HealthRow(
                    status: .unknown,
                    label: "Export worker",
                    summary: "0 jobs · idle",
                    icon: { Image(systemName: "questionmark.circle") }
                )
                HealthRow(
                    status: .maintenance,
                    label: "Database",
                    summary: "scheduled window",
                    activation: .link(to: "/system", perform: {}),
                    icon: { Image(systemName: "wrench.and.screwdriver") }
                )
            }
            .tsGlassPanel()
        }
    }

    #Preview("Activation variants") {
        staged("external link · action button · inert · no icon") {
            VStack(spacing: 0) {
                HealthRow(
                    status: .healthy,
                    label: "Status page",
                    summary: "operational",
                    activation: .externalLink(to: "https://status.example.com", perform: {}),
                    icon: { Image(systemName: "globe") }
                )
                HealthRow(
                    status: .degraded,
                    label: "Run health check",
                    summary: "last: 4m ago",
                    activation: .action(perform: {}),
                    icon: { Image(systemName: "stethoscope") }
                )
                HealthRow(status: .unknown, label: "Uptime", summary: "—")
                HealthRow(
                    status: .healthy,
                    label: "Redis cache",
                    summary: "hit rate 99.2%"
                )
            }
            .tsGlassPanel()
        }
    }

    #Preview("Truncation · long label") {
        staged("flexible label truncates · summary holds its width") {
            HealthRow(
                status: .degraded,
                label: "Automation worker with an unusually long descriptive name",
                summary: "2 rules paused",
                activation: .link(to: "/automation", perform: {}),
                icon: { Image(systemName: "gearshape.2") }
            )
            .tsGlassPanel()
        }
    }
#endif
