import SwiftUI

// MARK: - Infrastructure tab (web devtools `InfrastructureSection`)

/// The Infrastructure tab: a catalog of backend diagnostics tools (web
/// `InfrastructureSection` — DB stats, migrations, MQTT test, env check, runtime info)
/// presented as descriptive cards with their endpoint + verb. The manifest scopes
/// DevTools to "no API data sources", so this native hub surfaces the diagnostics
/// catalog; the live request paths belong to the backend admin tooling.
struct DevToolsInfrastructureTab: View {
    private let tools = DevToolsCatalog.infraTools

    private let columns = [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(tools) { tool in
                DevToolsToolCard(
                    title: tool.name,
                    detail: tool.detail,
                    systemImage: tool.systemImage,
                    tone: tool.tone.tsTone
                ) {
                    HStack(spacing: TSSpacing.sm) {
                        DevToolsMethodBadge(method: tool.method)
                        DevToolsTokenChip(token: tool.endpoint)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
