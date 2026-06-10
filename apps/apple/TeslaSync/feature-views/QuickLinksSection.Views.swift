//
//  QuickLinksSection.Views.swift
//  TeslaSync — P4 feature view · 0294 · QuickLinksSection (Apple)
//
//  Presentational chrome composed by `QuickLinksSection`: the chevron + title header
//  (web `<ChevronRight/> <span>Quick Links</span>`), the responsive shortcut grid, the
//  individual link tile (web `<Link><GlassPanel hover glow="cyan">`), the redacted
//  loading grid, the empty + error states, and the stale / offline connectivity chip.
//  All copy resolves through the P1/S10 facade and all chrome is token-driven (P1/S9)
//  — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web header chevron is
//  `--neon-cyan` and the tile glow is `glow="cyan"`, both of which map to the `accent`
//  token (equal to the dark-theme neon cyan #00f0ff, adapting for the light theme).
//  The web tile glyph is `--text-muted` and its label is `--text-primary`, mapped to
//  the `textMuted` / `textPrimary` tokens.
//

import SwiftUI

// MARK: - Header (web `<ChevronRight/> <span>Quick Links</span>`)

/// The section header: a cyan chevron glyph followed by the bold "Quick Links" title,
/// marked as an accessibility header. The chevron is decorative (hidden from
/// VoiceOver) so the header reads as a single title element.
struct QuickLinksHeader: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            QuickLinksViewStrings.text("vehicles.detail.quickLinks", "Quick Links")
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(QuickLinksViewStrings.text("vehicles.detail.quickLinks", "Quick Links"))
    }
}

// MARK: - Responsive content grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`)

/// The responsive grid of link tiles. The column count reflows across the web Tailwind
/// breakpoints (`QuickLinksLayout`: 2 below `sm`, 3 at/above `sm`, 6 at/above `lg`)
/// using the iOS 18 / macOS 15 `onGeometryChange` width seam so the math stays pure +
/// testable. Selection is delegated to the host via `onSelect` (web `<Link to>`).
struct QuickLinksContentGrid: View {
    let items: [QuickLinksTileModel]
    let onSelect: (QuickLinksDestination) -> Void

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
            count: QuickLinksLayout.columns(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(items) { item in
                QuickLinksTile(item: item) { onSelect(item.destination) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Link tile (web `<Link><GlassPanel hover glow="cyan" className="flex-col items-center p-4">`)

/// One tappable shortcut: a centered, muted SF Symbol over its label inside a glass
/// tile — the native port of the web `GlassPanel` link. Routing is delegated to the
/// host via `onTap` (web `<Link to>`).
struct QuickLinksTile: View {
    let item: QuickLinksTileModel
    let onTap: () -> Void

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: item.label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
            }
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .center)
            .padding(TSSpacing.lg)
            .background(Color.TS.surfaceGlass, in: tileShape)
            .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(tileShape)
        }
        .buttonStyle(QuickLinksTilePressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: item.accessibilityLabel))
        .accessibilityHint(Text(verbatim: item.accessibilityHint))
        .accessibilityAddTraits(.isButton)
    }
}

/// Press feedback for a link tile: a subtle scale-down plus a cyan ring + glow on
/// press that mirrors the web `group-hover` + `glow="cyan"` affordance, suppressed
/// under Reduce Motion.
struct QuickLinksTilePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        return configuration.label
            .scaleEffect(pressed && !reduceMotion ? 0.97 : 1)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(pressed ? 0.5 : 0), lineWidth: 1)
            )
            .shadow(color: Color.TS.accent.opacity(pressed ? 0.35 : 0), radius: pressed ? 8 : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: pressed)
    }
}

// MARK: - Loading grid (web shell `Skeleton`)

/// The redacted loading grid: six skeleton tiles in the same responsive layout as the
/// content grid, so the surface never flashes a blank box on first mount.
struct QuickLinksLoadingGrid: View {
    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
            count: QuickLinksLayout.columns(forWidth: width)
        )
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                VStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 48, height: 10)
                }
                .frame(maxWidth: .infinity, minHeight: 76, alignment: .center)
                .padding(TSSpacing.lg)
                .background(Color.TS.surfaceGlass, in: tileShape)
                .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
        .accessibilityElement()
        .accessibilityLabel(QuickLinksViewStrings.text("vehicles.detail.quickLinks.loadingA11y", "Loading quick links"))
    }
}

// MARK: - Empty state (defensive — catalog resolved with no links)

/// The friendly empty state shown when the resolved catalog has no links. Always
/// rendered in place of a blank panel (never a hidden surface).
struct QuickLinksEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                QuickLinksViewStrings.text("vehicles.detail.quickLinks.emptyTitle", "No quick links")
            } icon: {
                Image(systemName: "square.grid.2x2")
            }
        } description: {
            QuickLinksViewStrings.text(
                "vehicles.detail.quickLinks.emptyHint",
                "Navigation shortcuts will appear here."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (defensive — catalog failed to resolve)

/// The error state with a retry affordance, shown when the catalog fails to resolve
/// and there are no cached links to fall back to (web `QueryError` intent).
struct QuickLinksErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            QuickLinksViewStrings.text("vehicles.detail.quickLinks.errorTitle", "Couldn't load quick links")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                QuickLinksViewStrings.text("vehicles.detail.quickLinks.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(QuickLinksViewStrings.text("vehicles.detail.quickLinks.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Connectivity chip (Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown beside
/// the header when the surface is not live so a cached grid is clearly labeled. A stale
/// chip offers a manual refresh alongside the model's one-shot auto-refresh; an offline
/// chip keeps the cached grid on screen without a network round-trip.
struct QuickLinksConnectivityChip: View {
    let connection: QuickLinksConnection
    let onRefresh: (() -> Void)?

    private struct Descriptor {
        let tone: Color
        let symbol: String
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.symbol)
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            QuickLinksViewStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .fontWeight(.medium)
            if let onRefresh {
                Button(action: onRefresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(QuickLinksViewStrings.text("vehicles.detail.quickLinks.retry", "Retry"))
            }
        }
        .foregroundStyle(descriptor.tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(descriptor.tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private static func descriptor(for connection: QuickLinksConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                symbol: "dot.radiowaves.left.and.right",
                key: "vehicles.detail.quickLinks.live",
                fallback: "Live"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                symbol: "clock.arrow.circlepath",
                key: "vehicles.detail.quickLinks.stale",
                fallback: "Stale"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                symbol: "wifi.slash",
                key: "vehicles.detail.quickLinks.offline",
                fallback: "Offline"
            )
        }
    }
}
