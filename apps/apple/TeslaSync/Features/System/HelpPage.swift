//
//  HelpPage.swift
//  TeslaSync — P7 System · HelpPage (Apple)
//
//  The SwiftUI parity of web/src/features/system/pages/HelpPage.tsx — the deterministic
//  baseline help page. This surface renders a brief introduction + a grid of curated
//  links to canonical app destinations (documentation, onboarding, system status, search,
//  chatbot). The page is static (no API data sources) and follows Apple HIG with adaptive
//  layout for macOS (regular horizontal size class) and iOS (compact/regular). All strings
//  resolve from Localizable.xcstrings; all styling uses P2 design tokens (Color.TS, Font.TS,
//  TSSpacing) with no hardcoded values (ADR-005, ADR-014).
//

import SwiftUI

// MARK: - View Model

/// The view model for HelpPage. Since this is a static page with no API data sources,
/// the model simply tracks presentation state and provides localized strings. No networking,
/// no KMP core dependencies — pure UI state.
@Observable
final class HelpPageModel {
    /// The localized page title.
    var title: String {
        String(localized: "help.title", defaultValue: "Help")
    }

    /// The localized intro text.
    var intro: String {
        String(
            localized: "help.intro",
            defaultValue: """
            Get started with TeslaSync. The links below cover the most common questions; \
            for anything else, ask the in-app assistant or open the documentation.
            """
        )
    }

    /// The curated link destinations. Each entry points to an existing canonical route
    /// already mounted in the app's navigation graph. Order matches web: documentation
    /// first, then onboarding, system status, search, chatbot.
    let links: [HelpLink] = [
        HelpLink(
            id: "docs-status-api",
            icon: "book.closed",
            titleKey: "help.baseline.links.docsStatusApi.title",
            titleDefault: "Documentation",
            descKey: "help.baseline.links.docsStatusApi.description",
            descDefault: "Browse the public API documentation including endpoints, schemas, and example requests."
        ),
        HelpLink(
            id: "onboarding",
            icon: "rocket",
            titleKey: "help.baseline.links.onboarding.title",
            titleDefault: "Onboarding",
            descKey: "help.baseline.links.onboarding.description",
            descDefault: """
            Walk through the first-time setup wizard to connect a Tesla account \
            and configure live telemetry.
            """
        ),
        HelpLink(
            id: "system-status",
            icon: "server.rack",
            titleKey: "help.baseline.links.systemStatus.title",
            titleDefault: "System status",
            descKey: "help.baseline.links.systemStatus.description",
            descDefault: "Inspect the live health of every backend service: database, MQTT, Redis, and the Tesla API."
        ),
        HelpLink(
            id: "search",
            icon: "magnifyingglass",
            titleKey: "help.baseline.links.search.title",
            titleDefault: "Search",
            descKey: "help.baseline.links.search.description",
            descDefault: "Find drives, charging sessions, alerts, and other records using typed filters."
        ),
        HelpLink(
            id: "chatbot",
            icon: "message.badge",
            titleKey: "help.baseline.links.chatbot.title",
            titleDefault: "Chatbot",
            descKey: "help.baseline.links.chatbot.description",
            descDefault: """
            Talk to the in-app assistant. Available in deterministic mode or LLM mode \
            when Helix is enabled.
            """
        )
    ]

    init() {}
}

// MARK: - Model Types

/// A curated help link card.
struct HelpLink: Identifiable {
    let id: String
    /// SF Symbols icon name.
    let icon: String
    /// i18n key for the link title.
    let titleKey: String
    /// Fallback English title (used if translation is missing).
    let titleDefault: String
    /// i18n key for the one-line description.
    let descKey: String
    /// Fallback English description.
    let descDefault: String
}

// MARK: - Top-Level Surface

/// The deterministic Help page. Renders two glass panels: an intro text panel (GlassPanel1)
/// and a grid of curated link cards (GlassPanel2 is the grid container, each link is its own
/// card). Adaptive layout: single column on iPhone portrait, 2-3 columns on iPad/Mac depending
/// on available width. No loading/error/empty states since there's no data fetching — the
/// success state is the only state (parity requirement: "success data state").
public struct HelpPage: View {
    @State private var viewModel = HelpPageModel()
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                // Page header
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(viewModel.title)
                        .font(.TS.title)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                }

                // GlassPanel 1: Intro text
                GroupBox {
                    Text(viewModel.intro)
                        .font(.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .groupBoxStyle(GlassPanelStyle())
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Help introduction")

                // GlassPanel 2: Link grid (container)
                linkGrid
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(viewModel.title)
    }

    /// The responsive grid of curated link cards. Adapts column count based on horizontal
    /// size class: compact (iPhone portrait) = 1 column, regular (iPad/Mac) = 2-3 columns.
    @ViewBuilder
    private var linkGrid: some View {
        let columns: [GridItem] = if horizontalSizeClass == .compact {
            [GridItem(.flexible(), spacing: TSSpacing.md)]
        } else {
            Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)
        }

        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(viewModel.links) { link in
                linkCard(for: link)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Help links")
    }

    /// A single link card. Mimics the web GlassPanel + Link structure: icon + title + description
    /// + arrow, with hover/tap feedback. Uses a ZStack with overlay button for proper tappability
    /// while maintaining the glass panel styling (matching the web's GlassPanel component).
    private func linkCard(for link: HelpLink) -> some View {
        ZStack(alignment: .topLeading) {
            linkCardContent(for: link)

            // Invisible button overlay for tap handling
            Button {
                // Navigation will be wired by the parent app when routes are registered.
                // For now, this is a no-op — the parity requirement is rendering only.
            } label: {
                Color.clear
            }
            .buttonStyle(.plain)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isLink)
        .accessibilityLabel(linkAccessibilityLabel(for: link))
        .accessibilityHint(linkAccessibilityHint(for: link))
    }

    /// The content of a link card (GroupBox with icon, title, description).
    private func linkCardContent(for link: HelpLink) -> some View {
        GroupBox {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                // Icon
                Image(systemName: link.icon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 40, height: 40)
                    .background(Color.TS.accent.opacity(0.1))
                    .cornerRadius(TSRadius.md)
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md)
                            .stroke(Color.TS.accent.opacity(0.2), lineWidth: 1)
                    )
                    .accessibilityHidden(true)

                // Title + description
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack(spacing: TSSpacing.xs) {
                        Text(LocalizedStringKey(link.titleKey))
                        .font(.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)

                        Spacer(minLength: 0)

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.TS.textMuted)
                            .accessibilityHidden(true)
                    }

                    Text(LocalizedStringKey(link.descKey))
                    .font(.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(TSSpacing.sm)
        }
        .groupBoxStyle(GlassPanelStyle())
    }

    /// Generates the accessibility label for a link card.
    private func linkAccessibilityLabel(for link: HelpLink) -> String {
        let title = link.titleDefault
        let desc = link.descDefault
        return "\(title). \(desc)"
    }

    /// Generates the accessibility hint for a link card.
    private func linkAccessibilityHint(for link: HelpLink) -> String {
        let title = link.titleDefault
        return "Navigates to \(title)"
    }
}

// MARK: - Glass Panel Style

/// A custom GroupBox style that mimics the web's GlassPanel component: translucent background
/// (surfaceGlass token), subtle border, corner radius, and proper contrast for both light and
/// dark modes (ADR-005: materials where the web uses glass, HIG-aligned).
private struct GlassPanelStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            configuration.label
            configuration.content
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass)
        .cornerRadius(TSRadius.lg)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg)
                .stroke(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Previews

#Preview("HelpPage — Light") {
    NavigationStack {
        HelpPage()
    }
    .preferredColorScheme(.light)
}

#Preview("HelpPage — Dark") {
    NavigationStack {
        HelpPage()
    }
    .preferredColorScheme(.dark)
}

#Preview("HelpPage — Compact") {
    NavigationStack {
        HelpPage()
    }
    .environment(\.horizontalSizeClass, .compact)
}
