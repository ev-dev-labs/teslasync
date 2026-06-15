import SwiftUI

// MARK: - Reference tab (web devtools `ReferenceLinksSection`)

/// The Reference tab: external Tesla Fleet API documentation links (web
/// `REFERENCE_LINKS`) as a responsive grid of cards that open in the browser.
struct DevToolsReferenceTab: View {
    private let links = DevToolsCatalog.referenceLinks

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(links) { link in
                linkCard(link)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func linkCard(_ link: DevToolsReferenceLink) -> some View {
        if let url = link.url {
            Link(destination: url) {
                cardBody(link)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isLink)
            .accessibilityLabel(Text(link.title))
        } else {
            cardBody(link)
        }
    }

    private func cardBody(_ link: DevToolsReferenceLink) -> some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(systemName: link.systemImage, tone: .info)
                VStack(alignment: .leading, spacing: 2) {
                    Text(link.title)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: link.urlString)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
