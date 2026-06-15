import SwiftUI

// MARK: - Telemetry tab (web devtools `TELEMETRY_FIELDS` signal-field reference)

/// The Telemetry tab: a reference of every Fleet Telemetry signal field the pipeline
/// supports (web devtools `TELEMETRY_FIELDS`), grouped by category in collapsible
/// sections. Static, local reference content — the live fleet-telemetry error feed is
/// the separate FleetTelemetryCoverage parity unit (the manifest scopes DevTools to
/// "no API data sources").
struct DevToolsTelemetryTab: View {
    private let categories = DevToolsCatalog.telemetryCategories

    private let chipColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            summaryCard
            ForEach(categories) { category in
                TSAccordion(category.name) {
                    categoryBody(category)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summaryCard: some View {
        DevToolsToolCard(
            title: "devtools.telemetry.title",
            detail: "devtools.telemetry.subtitle",
            systemImage: "dot.radiowaves.left.and.right",
            tone: .info
        ) {
            HStack(spacing: TSSpacing.x2xl) {
                metric(value: DevToolsCatalog.telemetryFieldTotal, label: "devtools.telemetry.totalFields")
                metric(value: categories.count, label: "devtools.telemetry.categories")
                Spacer(minLength: 0)
            }
        }
    }

    private func metric(value: Int, label: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            TSMetricValue("\(value)")
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }

    private func categoryBody(_ category: DevToolsTelemetryCategory) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text("devtools.telemetry.fieldCount \(category.fieldCount)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            LazyVGrid(columns: chipColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(category.fields, id: \.self) { field in
                    DevToolsTokenChip(token: field)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text("devtools.telemetry.fieldCount \(category.fieldCount)"))
    }
}
