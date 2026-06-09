//
//  ReferenceLinksSection.Views.swift
//  TeslaSync — P4 feature view · 0007 · ReferenceLinksSection (Apple)
//
//  The presentational subviews composed by `ReferenceLinksSection`: the responsive
//  card grid (web `grid sm:grid-cols-2 lg:grid-cols-4`), one reference-link card
//  (web `GlassPanel` + external `<a>` with the cyan icon box, title, and href), and
//  the loading / empty / error chrome plus the freshness chip + connectivity banner.
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `ICON_COLOR_MAP.cyan`
//  (`bg-neon-cyan/10 text-neon-cyan ring-neon-cyan/20`) maps to the `accent` token,
//  which equals the dark-theme neon cyan (#00f0ff) and adapts for the light theme —
//  applied as a 10%-fill / 20%-ring box with the accent-tinted glyph.
//

import SwiftUI

// MARK: - Responsive grid (web `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`)

/// The adaptive card grid — the native equivalent of the web responsive column
/// classes: an adaptive track that yields 1–4 columns by available width, top-
/// aligned so cards keep an even baseline.
enum ReferenceLinksGridLayout {
    static let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.lg, alignment: .top)]
}

/// The grid of reference-link cards (web non-empty render), wrapped in the shared
/// fade-in.
struct ReferenceLinksGrid: View {
    let links: [ReferenceLink]

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: ReferenceLinksGridLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
                ForEach(links) { link in
                    ReferenceLinkCard(link: link)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Reference-link card (web `GlassPanel` + external `<a>`)

/// One reference-link card — the glass panel hosting an external link row: the cyan
/// icon box, the localized title, and the truncated href. Opens the destination in
/// the system browser (web `target="_blank"`); when the href is not a valid URL the
/// row renders without the link affordance so the card never disappears.
struct ReferenceLinkCard: View {
    let link: ReferenceLink

    private var title: String {
        ReferenceLinksStrings.string(link.titleKey, link.titleFallback)
    }

    var body: some View {
        TSGlassPanel {
            Group {
                if let url = link.url {
                    Link(destination: url) { rowContent }
                } else {
                    rowContent
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.isLink)
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            ReferenceLinkIconBox(systemImage: link.icon.systemImage)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(verbatim: link.urlString)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var accessibilityLabel: String {
        ReferenceLinkAccessibility.label(
            title: title,
            linkWord: ReferenceLinksStrings.string("devtools.ref.linkA11y", "link"),
            host: ReferenceLinkAccessibility.host(of: link.urlString)
        )
    }
}

/// The cyan icon box (web `h-9 w-9 rounded-lg` + `ICON_COLOR_MAP.cyan`): a 36×36
/// rounded square with a 10%-accent fill, a 20%-accent ring, and the accent-tinted
/// glyph.
struct ReferenceLinkIconBox: View {
    let systemImage: String

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.accent.opacity(0.10))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .frame(width: 36, height: 36)
            .overlay(
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip + connectivity banner (P4 leaf states)

/// The compact freshness chip — the dot + label rendered above the grid when the
/// catalog is stale or offline (hidden while live).
struct ReferenceLinksFreshnessChip: View {
    let connection: ReferenceLinksConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = ReferenceLinksStrings.string("devtools.ref.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ReferenceLinksStrings.string("devtools.ref.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ReferenceLinksStrings.string("devtools.ref.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// The stale / offline banner with its retry affordance — the P4 connectivity
/// surface shown above the grid when the catalog is not live.
struct ReferenceLinksConnectivityBanner: View {
    let connection: ReferenceLinksConnection
    let onRefresh: () -> Void

    var body: some View {
        let isOffline = connection == .offline
        let label = isOffline
            ? ReferenceLinksStrings.string("devtools.ref.offlineBanner", "Offline — showing the last known links")
            : ReferenceLinksStrings.string("devtools.ref.staleBanner", "Reconnecting — the links may be out of date")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
            Spacer(minLength: TSSpacing.xs)
            Button(action: onRefresh) {
                Text(verbatim: ReferenceLinksStrings.string("devtools.ref.refresh", "Refresh"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: ReferenceLinksStrings.string("devtools.ref.refresh", "Refresh")))
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton grid of card outlines, so the section
/// keeps its shape while the catalog resolves.
struct ReferenceLinksLoadingView: View {
    var body: some View {
        LazyVGrid(columns: ReferenceLinksGridLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSGlassPanel {
                    HStack(alignment: .top, spacing: TSSpacing.md) {
                        TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.sm)
                        VStack(alignment: .leading, spacing: TSSpacing.xs) {
                            TSSkeleton(height: 12)
                            TSSkeleton(width: 120, height: 10)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ReferenceLinksStrings.string(
            "devtools.ref.loadingA11y",
            "Loading reference links"
        )))
    }
}

/// The empty render: a friendly state, never a blank grid (P4 contract).
struct ReferenceLinksEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ReferenceLinksStrings.string("devtools.ref.empty", "No reference links available"))
            } icon: {
                Image(systemName: "link")
            }
        } description: {
            Text(verbatim: ReferenceLinksStrings.string(
                "devtools.ref.emptyHint",
                "Developer documentation links will appear here once they are enabled."
            ))
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct ReferenceLinksErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: ReferenceLinksStrings.string("devtools.ref.errorTitle", "Couldn't load reference links"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: ReferenceLinksStrings.string("devtools.ref.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: ReferenceLinksStrings.string("devtools.ref.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
