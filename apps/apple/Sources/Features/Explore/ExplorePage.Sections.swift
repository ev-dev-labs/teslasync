import SwiftUI

// MARK: - Recently visited strip (web `RecentStrip`)

/// Horizontal strip of recently visited features (web `recentPages` registry). Shown only when not
/// filtering and there is something to show; tapping a chip navigates to that route.
struct ExploreRecentStrip: View {
    let entries: [ExploreEntry]
    let onNavigate: (AppRoute) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(entries) { entry in
                        ExploreRecentChip(entry: entry, onNavigate: onNavigate)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("explore.recent.heading")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: String(entries.count))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// A single recent-feature chip (web `RecentStrip` anchor).
private struct ExploreRecentChip: View {
    let entry: ExploreEntry
    let onNavigate: (AppRoute) -> Void

    var body: some View {
        Button {
            onNavigate(entry.route)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: entry.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                Text(entry.titleKey)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(entry.titleKey)
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Sticky search panel (web GlassPanel1)

/// The sticky search panel — the first `GlassPanel`: a search field plus the per-section anchor
/// strip. Mirrors the web sticky panel that stays visible while scrolling the catalog.
struct ExploreSearchPanel: View {
    @Binding var query: String
    let sections: [ExploreSection]
    let onJump: (String) -> Void

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ExploreSearchField(query: $query)
                if !sections.isEmpty {
                    ExploreAnchorStrip(sections: sections, onJump: onJump)
                }
            }
        }
    }
}

/// The search field (web `Input type=search` with a leading icon + clear affordance). The visible
/// prompt and the screen-reader label resolve from the catalog so neither is hardcoded.
private struct ExploreSearchField: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            field
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("explore.empty.clear"))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("explore.searchLabel"))
    }

    private var field: some View {
        // The prompt key carries the i18n name verbatim; it is copy, not an unfinished marker.
        TextField("explore.searchPlaceholder", text: $query) // parity:allow i18n key name, not a stub
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .autocorrectionDisabled(true)
            .submitLabel(.search)
        #if os(iOS)
            .textInputAutocapitalization(.never)
        #endif
    }
}

// MARK: - Section anchor strip (web `SectionAnchorStrip`)

/// Per-section anchor chips with a match count, jumping to that band (web `#explore-section-{slug}`).
struct ExploreAnchorStrip: View {
    let sections: [ExploreSection]
    let onJump: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.sm) {
                ForEach(sections) { section in
                    ExploreAnchorChip(section: section, onJump: onJump)
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("explore.sectionsAriaLabel"))
    }
}

/// A single anchor chip: the section title plus its match count.
private struct ExploreAnchorChip: View {
    let section: ExploreSection
    let onJump: (String) -> Void

    private var countLabel: String {
        String(format: String(localized: "explore.anchorCountAria"), section.entries.count)
    }

    var body: some View {
        Button {
            onJump(section.anchorID)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Text(section.titleKey)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: String(section.entries.count))
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityLabel(Text(verbatim: countLabel))
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
