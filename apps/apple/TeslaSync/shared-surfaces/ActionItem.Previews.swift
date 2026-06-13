//
//  ActionItem.Previews.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  Xcode previews for every real branch of the single operator-task row: each severity (with its
//  recoloured glyph + tint + ring), the description present / absent variants, the route / external-link /
//  action / no CTA wrappers, and a stacked at-a-glance list (the web usage — rows stacked inside an
//  `ActionItemsPanel`). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope. The sample titles / descriptions / labels are illustrative (the embedder supplies the real,
//  localized strings).
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
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Severities — with CTA") {
        staged("info · warn · error · each with a route CTA") {
            VStack(spacing: TSSpacing.sm) {
                ActionItem(
                    severity: .info,
                    title: "Firmware update available",
                    description: "v1.2.0 → v1.3.0",
                    cta: .route(label: "Review", to: "/settings/updates", perform: {})
                )
                ActionItem(
                    severity: .warn,
                    title: "Fleet token expires in 3 days",
                    description: "Re-authenticate to keep telemetry flowing.",
                    cta: .route(label: "Re-auth", to: "/settings/tesla", perform: {})
                )
                ActionItem(
                    severity: .error,
                    title: "Last backup failed",
                    description: "2 days ago · disk full",
                    cta: .action(label: "Run backup", perform: {})
                )
            }
        }
    }

    #Preview("CTA wrappers") {
        staged("internal route · external link · action button · no CTA") {
            VStack(spacing: TSSpacing.sm) {
                ActionItem(
                    severity: .info,
                    title: "Open the release notes",
                    cta: .route(label: "Open", to: "/changelog", perform: {})
                )
                ActionItem(
                    severity: .warn,
                    title: "Check the public status page",
                    description: "An incident may be affecting sync.",
                    cta: .externalLink(
                        label: "Status",
                        to: "https://status.example.com",
                        perform: {}
                    )
                )
                ActionItem(
                    severity: .error,
                    title: "Re-run the failed export",
                    cta: .action(label: "Retry", perform: {})
                )
                ActionItem(
                    severity: .info,
                    title: "All caught up — no action needed",
                    description: "This row carries no CTA."
                )
            }
        }
    }

    #Preview("Title only · long wrap") {
        staged("no description · long title wraps before the CTA") {
            VStack(spacing: TSSpacing.sm) {
                ActionItem(severity: .warn, title: "Two automation rules are paused")
                ActionItem(
                    severity: .error,
                    title: "The MQTT broker has been unreachable for an unusually long stretch of time",
                    description: "Telemetry ingestion is stalled until it recovers.",
                    cta: .route(label: "Inspect", to: "/system", perform: {})
                )
            }
        }
    }
#endif
