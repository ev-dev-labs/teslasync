//
//  AccordionSection.Previews.swift
//  TeslaSync — P4 feature view · 0236 · AccordionSection (Apple)
//
//  #if DEBUG previews exercising every render state the surface has — collapsed (the web
//  `defaultOpen=false` resting state), expanded (web `defaultOpen=true`), expanded with a
//  badges accessory, an expanded section whose caller-supplied body is an empty affordance
//  (proving the surface is never a blank box), and a stack of sections (the web
//  status-page composition) — so the accordion can be eyeballed in Xcode without a host.
//
//  Preview-only sample copy is illustrative caller content (the web `children` / `title` /
//  `badges` props), not shippable surface text, so it is inline `Text(verbatim:)`.
//

#if DEBUG
    import SwiftUI

    private struct AccordionSectionPreviewPill: View {
        let label: String
        let tint: Color

        var body: some View {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(tint)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 3)
                .background(tint.opacity(0.15), in: Capsule())
                .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
        }
    }

    private struct AccordionSectionPreviewRow: View {
        let name: String
        let value: String

        var body: some View {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: name)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: value)
                    .font(Font.TS.body.weight(.medium))
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
    }

    private struct AccordionSectionPreviewStage<StageContent: View>: View {
        @ViewBuilder let content: () -> StageContent

        var body: some View {
            ScrollView {
                VStack(spacing: TSSpacing.lg) {
                    content()
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 520)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Collapsed (default)") {
        AccordionSectionPreviewStage {
            AccordionSection(
                title: "Backend Status",
                description: "API, database, and cache health",
                systemImage: "server.rack"
            ) {
                AccordionSectionPreviewRow(name: "API", value: "Operational")
                AccordionSectionPreviewRow(name: "Database", value: "Operational")
            }
        }
    }

    #Preview("Expanded") {
        AccordionSectionPreviewStage {
            AccordionSection(
                title: "Data Pipeline",
                description: "Telemetry ingest and normalization",
                systemImage: "point.3.connected.trianglepath.dotted",
                defaultOpen: true
            ) {
                AccordionSectionPreviewRow(name: "Ingest", value: "Healthy")
                AccordionSectionPreviewRow(name: "Normalize", value: "Healthy")
                AccordionSectionPreviewRow(name: "Backlog", value: "0 messages")
            }
        }
    }

    #Preview("Expanded · with badges") {
        AccordionSectionPreviewStage {
            AccordionSection(
                title: "Service Health",
                description: "Live status of every worker",
                systemImage: "heart.text.square",
                defaultOpen: true
            ) {
                AccordionSectionPreviewPill(label: "12 up", tint: Color.TS.statusSuccess)
            } content: {
                AccordionSectionPreviewRow(name: "Notification worker", value: "Up")
                AccordionSectionPreviewRow(name: "Export worker", value: "Up")
            }
        }
    }

    #Preview("Expanded · empty body") {
        AccordionSectionPreviewStage {
            AccordionSection(
                title: "Incidents",
                description: "Operational incidents in the last 24 hours",
                systemImage: "exclamationmark.bubble",
                defaultOpen: true
            ) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "checkmark.seal")
                        .foregroundStyle(Color.TS.statusSuccess)
                    Text(verbatim: "No incidents to report")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    #Preview("Stacked sections") {
        AccordionSectionPreviewStage {
            AccordionSection(
                title: "Backend Status",
                description: "API, database, and cache health",
                systemImage: "server.rack",
                defaultOpen: true
            ) {
                AccordionSectionPreviewRow(name: "API", value: "Operational")
            }
            AccordionSection(
                title: "Infrastructure",
                description: "Hosts, queues, and storage",
                systemImage: "cpu"
            ) {
                AccordionSectionPreviewRow(name: "MQTT broker", value: "Connected")
            }
            AccordionSection(
                title: "Operations",
                description: "Backups and scheduled maintenance",
                systemImage: "wrench.and.screwdriver"
            ) {
                AccordionSectionPreviewRow(name: "Last backup", value: "2h ago")
            }
        }
    }
#endif
