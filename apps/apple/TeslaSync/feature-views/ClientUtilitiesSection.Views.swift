//
//  ClientUtilitiesSection.Views.swift
//  TeslaSync — P4 feature view · 0003 · ClientUtilitiesSection (Apple)
//
//  The presentational subviews composed by `ClientUtilitiesSection`: the search
//  field (web `Input`), the responsive card grid, the expandable tool card (web
//  `ExpandableToolCard` — icon box, name, desc, rotating chevron), the built-in
//  descriptor body, the loading skeleton, the connectivity banner, and the
//  search-empty copy. All consume pre-localized strings from the P1/S10 facade and
//  the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Grid layout

/// The responsive card grid columns (web `grid-cols-1 md:grid-cols-2
/// lg:grid-cols-3`): an adaptive track that yields 1–3+ columns by width, top-
/// aligned so a single expanded card doesn't stretch its row siblings.
enum ToolGridLayout {
    static let columns = [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg, alignment: .top)]
}

// MARK: - Search field (web `Input`)

/// The tool search field — the native counterpart of the web `Input`. Carries a
/// leading glyph, a verbatim (facade-resolved) prompt, and a clear button.
struct ToolSearchField: View {
    let prompt: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(verbatim: prompt))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(Text(verbatim: prompt))
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    ClientUtilitiesStrings.text("devtools.clientUtilities.clearSearch", "Clear search")
                )
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Connectivity banner (native chrome for stale / offline)

/// The freshness banner shown above the grid when the catalog is stale or offline.
/// Cached tools stay visible; the banner offers a manual refresh affordance.
struct ClientUtilitiesConnectivityBanner: View {
    let connection: ClientUtilitiesConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("devtools.clientUtilities.offlineBanner", "Offline — showing the last known tools")
            : ("devtools.clientUtilities.staleBanner", "Reconnecting — the catalog may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            ClientUtilitiesStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                ClientUtilitiesStrings.text("devtools.clientUtilities.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ClientUtilitiesStrings.text("devtools.clientUtilities.refresh", "Refresh"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Card grid

/// The responsive grid of tool cards (web `<div className="grid …">`).
struct ToolGrid: View {
    let tools: [ToolDescriptor]
    let expandedID: String?
    let onToggle: (String) -> Void
    let toolContent: ((ToolDescriptor) -> AnyView)?

    var body: some View {
        LazyVGrid(columns: ToolGridLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(tools) { tool in
                ToolCard(
                    tool: tool,
                    expanded: tool.id == expandedID,
                    onToggle: { onToggle(tool.id) },
                    toolContent: toolContent
                )
            }
        }
    }
}

// MARK: - Expandable tool card (web `ExpandableToolCard`)

/// One expandable tool card — the native port of the web `ExpandableToolCard`. The
/// header is a single tap target (icon box + name + description + rotating
/// chevron); expanding reveals the injected tool body or the built-in descriptor.
struct ToolCard: View {
    let tool: ToolDescriptor
    let expanded: Bool
    let onToggle: () -> Void
    let toolContent: ((ToolDescriptor) -> AnyView)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var name: String {
        tool.localizedName(ClientUtilitiesStrings.string)
    }

    private var summary: String {
        ClientUtilitiesAccessibility.cardSummary(
            for: tool,
            expanded: expanded,
            localize: ClientUtilitiesStrings.string
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if expanded {
                Divider().overlay(Color.TS.border)
                expandedBody
            }
        }
        .tsGlassPanel()
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: expanded)
    }

    private var header: some View {
        Button(action: onToggle) {
            HStack(spacing: TSSpacing.md) {
                iconBox
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: name)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(verbatim: tool.localizedDescription(ClientUtilitiesStrings.string))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .padding(TSSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: summary))
        .accessibilityAddTraits(expanded ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(
            ClientUtilitiesStrings.text("devtools.clientUtilities.toggleHint", "Double tap to expand or collapse")
        )
    }

    private var expandedBody: some View {
        Group {
            if let toolContent {
                toolContent(tool)
            } else {
                ToolDetailPanel(tool: tool)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var iconBox: some View {
        Image(systemName: tool.systemImage)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(tool.tint.color)
            .frame(width: 40, height: 40)
            .background(
                tool.tint.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(tool.tint.color.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Built-in descriptor body (default expanded content)

/// The section's self-contained tool body, rendered when no `toolContent` provider
/// is injected. Production wires each tool's own surface; this descriptor keeps the
/// section complete and useful on its own (full description + entry metadata).
struct ToolDetailPanel: View {
    let tool: ToolDescriptor

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: tool.localizedDescription(ClientUtilitiesStrings.string))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: TSSpacing.sm) {
                metadataChip(
                    label: ClientUtilitiesStrings.string("devtools.clientUtilities.identifier", "Identifier"),
                    value: tool.id
                )
                metadataChip(
                    label: ClientUtilitiesStrings.string("devtools.clientUtilities.runsOn", "Runs"),
                    value: ClientUtilitiesStrings.string("devtools.clientUtilities.clientSide", "On device")
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func metadataChip(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label.uppercased())
                .font(Font.TS.label)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.bodySm.monospaced())
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Search-empty (web `filtered.length === 0`)

/// The "no search results" copy (web `<p>…No tools match your search</p>`).
struct ToolSearchEmpty: View {
    var body: some View {
        ClientUtilitiesStrings.text("devtools.noToolsFound", "No tools match your search")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.x3xl)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted search bar plus a grid of redacted
/// card rows, matching the loaded layout so the transition is stable.
struct ToolCatalogSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(width: 420, height: 38, cornerRadius: TSRadius.md)
            LazyVGrid(columns: ToolGridLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    cardSkeleton
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(ClientUtilitiesStrings.text("devtools.clientUtilities.loading", "Loading tools"))
    }

    private var cardSkeleton: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(width: 120, height: 14)
                TSSkeleton(height: 10)
            }
            TSSkeleton(width: 16, height: 16, cornerRadius: TSRadius.sm)
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel()
    }
}
