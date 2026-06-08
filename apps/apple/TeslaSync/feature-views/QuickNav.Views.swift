//
//  QuickNav.Views.swift
//  TeslaSync — P4 feature view · 0129 · QuickNav (Apple)
//
//  Presentational chrome composed by `QuickNav`: the responsive shortcut grid, the
//  individual shortcut tile (web `<Link><GlassPanel hover>`), the redacted loading
//  grid, the empty + error states, and the stale / offline connectivity chip. All
//  copy resolves through the P1/S10 facade and all chrome is token-driven (P1/S9) —
//  no networking, no Tailwind ports, no raw hex (the per-item accent is the web
//  `NAV_ITEMS` color, a dynamic value owned by `QuickNavShortcut`).
//

import SwiftUI

// MARK: - Responsive content grid (web `grid grid-cols-2 sm:grid-cols-4 gap-3`)

/// The responsive grid of shortcut tiles. The column count reflows across the web
/// Tailwind breakpoint (`QuickNavComponentLayout`: 2 below `sm`, 4 at/above) using
/// the iOS 18 / macOS 15 `onGeometryChange` width seam so the math stays pure +
/// testable. Selection is delegated to the host via `onSelect` (web `<Link to>`).
struct QuickNavContentGrid: View {
    let items: [QuickNavTileModel]
    let onSelect: (QuickNavShortcut) -> Void

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
            count: QuickNavComponentLayout.columns(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(items) { item in
                QuickNavShortcutTile(item: item) { onSelect(item.shortcut) }
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Shortcut tile (web `<Link><GlassPanel hover className="p-4">`)

/// One tappable shortcut: a tinted icon badge, the label + description, and a
/// trailing chevron, inside a glass tile — the native port of the web `GlassPanel`
/// link. Routing is delegated to the host via `onTap` (web `<Link to>`).
struct QuickNavShortcutTile: View {
    let item: QuickNavTileModel
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: TSSpacing.md) {
                iconBadge
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: item.label)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: item.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: tileShape)
            .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(tileShape)
        }
        .buttonStyle(QuickNavTilePressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: item.accessibilityLabel))
        .accessibilityHint(Text(verbatim: item.accessibilityHint))
        .accessibilityAddTraits(.isButton)
    }

    /// The tinted SF Symbol badge — the native parity of the web icon box
    /// (`rounded-lg p-2` with the accent's faint fill + ring and the solid glyph).
    private var iconBadge: some View {
        Image(systemName: item.systemImage)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(item.accentColor)
            .frame(width: 36, height: 36)
            .background(
                item.accentColor.opacity(0.15),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(item.accentColor.opacity(0.25), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}

/// Press feedback for a shortcut tile: a subtle scale-down + dim on press that
/// mirrors the web `group-hover` affordance, suppressed under Reduce Motion.
struct QuickNavTilePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: configuration.isPressed)
    }
}

// MARK: - Loading grid (web shell `Skeleton`)

/// The redacted loading grid: four skeleton tiles in the same responsive layout as
/// the content grid, so the surface never flashes a blank box on first mount.
struct QuickNavLoadingGrid: View {
    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
            count: QuickNavComponentLayout.columns(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(height: 13)
                        TSSkeleton(width: 64, height: 10)
                    }
                }
                .padding(TSSpacing.lg)
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
        .accessibilityLabel(QuickNavViewStrings.text("dashboard.quickNav.loadingA11y", "Loading quick navigation"))
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}

// MARK: - Empty state (defensive — catalog resolved with no shortcuts)

/// The friendly empty state shown when the resolved catalog has no shortcuts. Always
/// rendered in place of a blank panel (never a hidden surface).
struct QuickNavEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                QuickNavViewStrings.text("dashboard.quickNav.emptyTitle", "No shortcuts")
            } icon: {
                Image(systemName: "square.grid.2x2")
            }
        } description: {
            QuickNavViewStrings.text("dashboard.quickNav.emptyHint", "Navigation shortcuts will appear here.")
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (defensive — catalog failed to resolve)

/// The error state with a retry affordance, shown when the catalog fails to resolve
/// and there are no cached shortcuts to fall back to (web `QueryError` intent).
struct QuickNavErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            QuickNavViewStrings.text("dashboard.quickNav.errorTitle", "Couldn't load shortcuts")
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
                QuickNavViewStrings.text("dashboard.quickNav.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(QuickNavViewStrings.text("dashboard.quickNav.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Connectivity chip (Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown above
/// the grid when the surface is not live so a cached grid is clearly labeled. A stale
/// chip offers a manual refresh alongside the model's one-shot auto-refresh; an
/// offline chip keeps the cached grid on screen without a network round-trip.
struct QuickNavConnectivityChip: View {
    let connection: QuickNavConnection
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
            QuickNavViewStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .fontWeight(.medium)
            if let onRefresh {
                Button(action: onRefresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(QuickNavViewStrings.text("dashboard.quickNav.retry", "Retry"))
            }
        }
        .foregroundStyle(descriptor.tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(descriptor.tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private static func descriptor(for connection: QuickNavConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                symbol: "dot.radiowaves.left.and.right",
                key: "dashboard.quickNav.live",
                fallback: "Live"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                symbol: "clock.arrow.circlepath",
                key: "dashboard.quickNav.stale",
                fallback: "Stale"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                symbol: "wifi.slash",
                key: "dashboard.quickNav.offline",
                fallback: "Offline"
            )
        }
    }
}
