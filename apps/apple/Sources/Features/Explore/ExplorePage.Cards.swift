import SwiftUI

// MARK: - Section band (web `SectionBand`)

/// A titled band of feature cards for one sidebar group. Carries the scroll anchor the strip jumps
/// to and reflows its card grid across macOS / iPad / iPhone widths.
struct ExploreSectionBand: View {
    let section: ExploreSection
    let onNavigate: (AppRoute) -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 240, maximum: .infinity), spacing: TSSpacing.md, alignment: .top)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(section.entries) { entry in
                    ExploreFeatureCard(entry: entry, onNavigate: onNavigate)
                }
            }
        }
        .id(section.anchorID)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(section.titleKey)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: String(section.entries.count))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Feature card (web `FeatureCard`)

/// One discoverable feature: its icon, localized title, and canonical deep-link path. The whole card
/// is a single navigation control with a combined accessibility element.
struct ExploreFeatureCard: View {
    let entry: ExploreEntry
    let onNavigate: (AppRoute) -> Void

    var body: some View {
        Button {
            onNavigate(entry.route)
        } label: {
            TSCard {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSIconBox(systemName: entry.systemImage, tone: .accent)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        Text(entry.titleKey)
                            .font(Font.TS.body)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(verbatim: entry.path)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(entry.titleKey)
        .accessibilityHint(Text(verbatim: entry.path))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Empty result (web `EmptyResult` — GlassPanel2)

/// The no-match empty state — the second `GlassPanel`. Built on `ContentUnavailableView` (the HIG
/// empty state) with "did you mean" suggestions and a clear-filter action, so the hub never blanks.
struct ExploreEmptyResult: View {
    let query: String
    let suggestions: [ExploreSuggestion]
    let onPick: (AppRoute) -> Void
    let onClear: () -> Void

    private var title: String {
        String(format: String(localized: "explore.empty.title"), query)
    }

    var body: some View {
        TSGlassPanel {
            ContentUnavailableView {
                Label {
                    Text(verbatim: title)
                } icon: {
                    Image(systemName: "magnifyingglass")
                }
            } description: {
                Text("explore.empty.body")
            } actions: {
                actions
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var actions: some View {
        if !suggestions.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text("explore.empty.didYouMean")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                ForEach(suggestions) { suggestion in
                    ExploreSuggestionRow(suggestion: suggestion, onPick: onPick)
                }
            }
            .frame(maxWidth: 420)
        }
        TSButton("explore.empty.clear", variant: .secondary, size: .small, action: onClear)
    }
}

/// One "did you mean" suggestion row (web empty-state suggestion button): label plus its path.
private struct ExploreSuggestionRow: View {
    let suggestion: ExploreSuggestion
    let onPick: (AppRoute) -> Void

    var body: some View {
        Button {
            onPick(suggestion.route)
        } label: {
            HStack {
                Text(suggestion.titleKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: suggestion.path)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(suggestion.titleKey)
    }
}
