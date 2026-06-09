//
//  SubscribeCard.Views.swift
//  TeslaSync — P4 feature view · 0255 · SubscribeCard (Apple)
//
//  Presentational chrome composed by `SubscribeCard`: the bell header + caption,
//  the responsive channel grid, the individual channel tile (web
//  `<Link><div class="border …">`), the redacted loading grid, the empty + error
//  states, and the stale / offline connectivity chip. All copy resolves through
//  the P1/S10 facade and all chrome is token-driven (P1/S9) — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Header (web `<h3>` bell title + `<p>` caption)

/// The card's static header: the bell + "Get notified about incidents" title and
/// the self-hosted explainer caption. Always rendered (in every state) so the
/// card never reads as a blank box.
struct SubscribeCardHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "bell")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityHidden(true)
                SubscribeCardViewStrings.text("subscribe.title", "Get notified about incidents")
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            SubscribeCardViewStrings.text(
                "subscribe.description",
                "Self-hosted: configure your own channels for status events."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Responsive content grid (web `grid grid-cols-1 sm:grid-cols-2 gap-2`)

/// The responsive grid of channel tiles. The column count reflows across the web
/// Tailwind breakpoint (`SubscribeCardLayout`: 1 below `sm`, 2 at/above) using the
/// iOS 18 / macOS 15 `onGeometryChange` width seam so the math stays pure +
/// testable. Selection is delegated to the host via `onSelect` (web `<Link to>`).
struct SubscribeCardContentGrid: View {
    let items: [SubscribeChannelTileModel]
    let onSelect: (SubscribeChannel) -> Void

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .top),
            count: SubscribeCardLayout.columns(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(items) { item in
                SubscribeChannelTile(item: item) { onSelect(item.channel) }
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Channel tile (web `<Link><div class="border bg-white/[0.02]">`)

/// One tappable channel link: a tinted icon, the label + description, inside a
/// bordered tile — the native port of the web `<ChannelTile>`. Routing is
/// delegated to the host via `onTap` (web `<Link to>`).
struct SubscribeChannelTile: View {
    let item: SubscribeChannelTileModel
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .frame(width: 18)
                    .padding(.top, 1)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: item.label)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: item.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: tileShape)
            .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(tileShape)
        }
        .buttonStyle(SubscribeCardTilePressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: item.accessibilityLabel))
        .accessibilityHint(Text(verbatim: item.accessibilityHint))
        .accessibilityAddTraits(.isButton)
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
    }
}

/// Press feedback for a channel tile: a subtle scale-down + dim on press that
/// mirrors the web `hover:bg-white/[0.05]` affordance, suppressed under Reduce
/// Motion.
struct SubscribeCardTilePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(
                reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration),
                value: configuration.isPressed
            )
    }
}

// MARK: - Loading grid (web shell `Skeleton`)

/// The redacted loading grid: five skeleton tiles in the same responsive layout
/// as the content grid, so the surface never flashes a blank box on first mount.
struct SubscribeCardLoadingGrid: View {
    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .top),
            count: SubscribeCardLayout.columns(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 72, height: 13)
                        TSSkeleton(height: 10)
                    }
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(Color.TS.surfaceGlass, in: tileShape)
                .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
        .accessibilityElement()
        .accessibilityLabel(SubscribeCardViewStrings.text("subscribe.loadingA11y", "Loading notification channels"))
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
    }
}

// MARK: - Empty state (defensive — catalog resolved with no channels)

/// The friendly empty state shown when the resolved catalog has no channels.
/// Always rendered in place of a blank panel (never a hidden surface).
struct SubscribeCardEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SubscribeCardViewStrings.text("subscribe.emptyTitle", "No channels")
            } icon: {
                Image(systemName: "bell.slash")
            }
        } description: {
            SubscribeCardViewStrings.text("subscribe.emptyHint", "Notification channels will appear here.")
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (defensive — catalog failed to resolve)

/// The error state with a retry affordance, shown when the catalog fails to
/// resolve and there are no cached channels to fall back to (web `QueryError`
/// intent).
struct SubscribeCardErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SubscribeCardViewStrings.text("subscribe.errorTitle", "Couldn't load channels")
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
                SubscribeCardViewStrings.text("subscribe.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SubscribeCardViewStrings.text("subscribe.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Connectivity chip (Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown
/// above the grid when the surface is not live so a cached grid is clearly
/// labeled. A stale chip offers a manual refresh alongside the model's one-shot
/// auto-refresh; an offline chip keeps the cached grid on screen without a
/// network round-trip.
struct SubscribeCardConnectivityChip: View {
    let connection: SubscribeCardConnection
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
            SubscribeCardViewStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .fontWeight(.medium)
            if let onRefresh {
                Button(action: onRefresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(SubscribeCardViewStrings.text("subscribe.retry", "Retry"))
            }
        }
        .foregroundStyle(descriptor.tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(descriptor.tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private static func descriptor(for connection: SubscribeCardConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                symbol: "dot.radiowaves.left.and.right",
                key: "subscribe.live",
                fallback: "Live"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                symbol: "clock.arrow.circlepath",
                key: "subscribe.stale",
                fallback: "Stale"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                symbol: "wifi.slash",
                key: "subscribe.offline",
                fallback: "Offline"
            )
        }
    }
}
