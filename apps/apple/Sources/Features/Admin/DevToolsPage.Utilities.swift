import SwiftUI

// MARK: - Utilities tab (web devtools `ClientUtilitiesSection`)

/// The Utilities tab: a searchable grid of client-side developer tools (web
/// `ClientUtilitiesSection` / `useToolList`). Each card expands to a fully functional,
/// local-only tool. Search + expansion bind through `DevToolsPageModel`; an empty state
/// shows when nothing matches (web "No tools match your search").
struct DevToolsUtilitiesTab: View {
    @Bindable var model: DevToolsPageModel

    private let columns = [GridItem(.adaptive(minimum: 320), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextField("devtools.searchTools", text: $model.toolSearch)
                .frame(maxWidth: 420)
                .accessibilityLabel(Text("devtools.searchTools"))

            if model.hasToolMatches {
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                    ForEach(model.filteredTools) { tool in
                        DevToolsExpandableToolCard(
                            tool: tool,
                            isExpanded: model.isToolExpanded(tool.id),
                            onToggle: { model.toggleTool(tool.id) }
                        )
                    }
                }
            } else {
                TSEmptyState(
                    title: "devtools.noToolsFound",
                    systemImage: "magnifyingglass"
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.x2xl)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Expandable tool card (web `ExpandableToolCard`)

/// A glass card whose header (icon + name + description + chevron) toggles the tool body
/// (web `ExpandableToolCard`). One card is expanded at a time, owned by the page model.
struct DevToolsExpandableToolCard: View {
    let tool: DevToolsUtilityTool
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 0) {
                Button(action: onToggle) {
                    HStack(spacing: TSSpacing.md) {
                        TSIconBox(systemName: tool.systemImage, tone: tool.tone.tsTone)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tool.name)
                                .font(Font.TS.body)
                                .fontWeight(.semibold)
                                .foregroundStyle(Color.TS.textPrimary)
                            Text(tool.detail)
                                .font(Font.TS.bodySm)
                                .foregroundStyle(Color.TS.textSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.TS.textMuted)
                            .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(tool.name))
                .accessibilityHint(Text(tool.detail))
                .accessibilityAddTraits(isExpanded ? [.isButton, .isSelected] : .isButton)

                if isExpanded {
                    Divider()
                        .overlay(Color.TS.border)
                        .padding(.vertical, TSSpacing.md)
                    DevToolsToolContent(toolID: tool.id)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Tool router (web tool registry `Component`)

/// Resolves a utility tool id to its functional widget (web `tool.Component`).
struct DevToolsToolContent: View {
    let toolID: String

    var body: some View {
        switch toolID {
        case "vin": DevToolsVinTool()
        case "jwt": DevToolsJwtTool()
        case "timestamp": DevToolsTimestampTool()
        case "base64": DevToolsBase64Tool()
        case "url": DevToolsUrlTool()
        case "json": DevToolsJsonTool()
        case "uuid": DevToolsUuidTool()
        case "hash": DevToolsHashTool()
        case "bytes": DevToolsBytesTool()
        case "color": DevToolsColorTool()
        case "cron": DevToolsCronTool()
        case "http": DevToolsHttpTool()
        case "tesla-api": DevToolsTeslaApiTool()
        case "regex": DevToolsRegexTool()
        case "unix-perm": DevToolsUnixPermTool()
        default: EmptyView()
        }
    }
}
