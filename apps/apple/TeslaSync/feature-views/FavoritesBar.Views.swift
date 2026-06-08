//
//  FavoritesBar.Views.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  The presentational subviews composed by `FavoritesBar`: the header (web `Star` +
//  uppercase "Quick Actions" label + count), the responsive favorites grid (web
//  `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), the default command tile (web
//  `renderTile` → `CommandTile`), the freshness chip + cached-data banner, and the
//  loading / empty / error states. All copy resolves through the P1/S10 facade; all chrome
//  is token-driven (P1/S9). No networking and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Variant → accent token (web neon `hoverStyles` → semantic role)

extension FavoriteCommandVariant {
    /// The accent role for the tile, mapped to a semantic design token (ADR-006) — the
    /// web `default`/`danger`/`success` neon hover hues become the brand accent + the
    /// danger/success status roles so the tile stays theme-aware without porting hex.
    var accent: Color {
        switch self {
        case .default: Color.TS.accent
        case .danger: Color.TS.statusDanger
        case .success: Color.TS.statusSuccess
        }
    }
}

// MARK: - Responsive column math (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`)

/// The pure column-count derivation for the favorites grid, mirroring the web Tailwind
/// breakpoints (base 2 columns, `sm` ≥ 640pt → 3, `lg` ≥ 1024pt → 4). Kept pure so the
/// XCTest suite can cover the breakpoints without a rendered view.
enum FavoritesLayout {
    static let smallBreakpoint: CGFloat = 640
    static let largeBreakpoint: CGFloat = 1024

    static func columnCount(forWidth width: CGFloat) -> Int {
        if width >= largeBreakpoint {
            return 4
        }
        if width >= smallBreakpoint {
            return 3
        }
        return 2
    }
}

// MARK: - Content (web non-null branch: header + favorites grid)

/// The populated body shown for `.content`: the "Quick Actions" header, the cached-data
/// banner (when not live), and the responsive favorites grid of caller-supplied tiles —
/// the web `<FadeIn><div>… <div className="grid …">{favCmds.map(renderTile)}</div></div>`.
struct FavoritesContent<Tile: View>: View {
    @Bindable var model: FavoritesBarModel
    @ViewBuilder let tile: (FavoriteCommand) -> Tile

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
            count: FavoritesLayout.columnCount(forWidth: width)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            FavoritesHeader(count: model.favoriteCount, connection: model.connection)
            if model.connection != .live {
                FavoritesConnectivityBanner(connection: model.connection)
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(model.favoriteCommands) { command in
                    tile(command)
                }
            }
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width
            } action: { newWidth in
                width = newWidth
            }
        }
    }
}

// MARK: - Header (web `Star` + uppercase label + count)

/// The section header: the amber star, the uppercase tracked "Quick Actions" label (web
/// `commands.cat.quickActions`), the parenthesised count, and — when the bound source is
/// not live — the trailing freshness chip.
struct FavoritesHeader: View {
    let count: Int
    let connection: FavoritesConnection

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "star.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            FavoritesStrings.text("commands.cat.quickActions", "Quick Actions")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: "(\(count))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Spacer(minLength: 0)
            if connection != .live {
                FavoritesFreshnessChip(connection: connection)
            }
        }
        .accessibilityElement(children: .ignore)
    }
}

// MARK: - Default tile (web `renderTile` → `CommandTile`)

/// The native parity of a single web `CommandTile`: a tappable glass tile with a tinted
/// SF Symbol chip, the localized label + optional sublabel, the favorite star (filled,
/// since every tile here is a favorite — tapping unpins it), and the dangerous-command
/// indicator. Activating the tile runs the command (web `onExecute`).
public struct FavoriteCommandTile: View {
    private let command: FavoriteCommand
    private let onExecute: () -> Void
    private let onToggleFavorite: () -> Void

    public init(
        command: FavoriteCommand,
        onExecute: @escaping () -> Void,
        onToggleFavorite: @escaping () -> Void
    ) {
        self.command = command
        self.onExecute = onExecute
        self.onToggleFavorite = onToggleFavorite
    }

    private var label: String {
        FavoritesStrings.string(command.labelKey, command.labelFallback)
    }

    private var sublabel: String? {
        guard let fallback = command.sublabelFallback, !fallback.isEmpty else {
            return nil
        }
        return FavoritesStrings.string(command.sublabelKey ?? "", fallback)
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }

    public var body: some View {
        Button(action: onExecute) {
            tileBody
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isButton)
    }

    private var tileBody: some View {
        VStack(spacing: TSSpacing.sm) {
            iconChip
            VStack(spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                if let sublabel {
                    Text(verbatim: sublabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.center)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: tileShape)
        .overlay(tileShape.strokeBorder(command.variant.accent.opacity(0.25), lineWidth: 1))
        .overlay(alignment: .topLeading) { favoriteButton }
        .overlay(alignment: .topTrailing) { dangerBadge }
    }

    private var iconChip: some View {
        Image(systemName: command.systemImage)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(command.variant.accent)
            .frame(width: 44, height: 44)
            .background(
                command.variant.accent.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var favoriteButton: some View {
        Button(action: onToggleFavorite) {
            Image(systemName: "star.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .padding(TSSpacing.xs)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            Text(verbatim: FavoritesStrings.string("commands.toggleFavorite", "Toggle favorite"))
        )
    }

    @ViewBuilder
    private var dangerBadge: some View {
        if command.dangerous {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger.opacity(0.6))
                .padding(TSSpacing.xs)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown when the
/// favorites are stale / offline so a cached set is clearly labeled.
struct FavoritesFreshnessChip: View {
    let connection: FavoritesConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            FavoritesStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FavoritesStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: FavoritesConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "commands.favorites.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "commands.favorites.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "commands.favorites.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the grid when the bound source is not live, so a
/// cached favorites set is clearly labeled while reconnecting / offline.
struct FavoritesConnectivityBanner: View {
    let connection: FavoritesConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "commands.favorites.offlineBanner" : "commands.favorites.staleBanner"
        let fallback = offline
            ? "Offline — showing your last saved favorites"
            : "Reconnecting — favorites may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FavoritesStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (initial favorites fetch)

/// The initial-fetch skeleton chrome: a redacted header over a small grid of shimmer
/// tile blocks standing in for the favorites. Never a blank box.
struct FavoritesLoadingState: View {
    private let columns = Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 16, height: 16, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 120, height: 12)
            }
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 100, cornerRadius: TSRadius.md)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(FavoritesStrings.text("commands.favorites.loading", "Loading quick actions"))
    }
}

// MARK: - Empty state (no favorites pinned)

/// The resolved-but-empty state. The web bar returns `null` when there are no favorites;
/// the native surface renders a friendly, instructive empty (prompt: never a blank box)
/// over a native `ContentUnavailableView`.
struct FavoritesEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                FavoritesStrings.text("commands.favorites.empty", "No favorites yet")
            } icon: {
                Image(systemName: "star")
            }
        } description: {
            FavoritesStrings.text(
                "commands.favorites.emptyDescription",
                "Tap the star on any command to pin it here for quick access."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (favorites fetch failed → retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). The runtime failure
/// message is rendered verbatim so it is never re-localized.
struct FavoritesErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FavoritesStrings.text("commands.favorites.errorTitle", "Couldn't load favorites")
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
                FavoritesStrings.text("commands.favorites.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FavoritesStrings.text("commands.favorites.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension FavoritesStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
