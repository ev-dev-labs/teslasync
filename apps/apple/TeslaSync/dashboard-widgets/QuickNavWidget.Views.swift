//
//  QuickNavWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0075 · QuickNavWidget (Apple)
//
//  The presentational subviews composed by `QuickNavWidget`: the responsive tile
//  grid, the individual shortcut tile (web `GlassPanel` link), the redacted loading
//  grid, and the empty / error states. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Content grid (web `grid grid-cols-2 sm:grid-cols-4`)

/// The responsive grid of shortcut tiles. `columns` comes from `QuickNavLayout`
/// (2 for a narrow widget, 4 for a full-width one), mirroring the web breakpoints.
struct QuickNavGrid: View {
    let items: [QuickNavItem]
    let columns: Int
    let onSelect: (QuickNavDestination) -> Void

    var body: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(items) { item in
                QuickNavTile(item: item) { onSelect(item.destination) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: max(1, columns))
    }
}

// MARK: - Shortcut tile (web `<Link><GlassPanel hover>…`)

/// One tappable shortcut: a tinted icon square, the label + description, and a
/// trailing chevron, inside a glass tile — the native port of the web `GlassPanel`
/// link. Routing is delegated to the host via `onTap` (web `<Link to>`).
struct QuickNavTile: View {
    let item: QuickNavItem
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: TSSpacing.md) {
                iconBadge
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: item.label)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: item.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: TSSpacing.xs)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: tileShape)
            .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(tileShape)
        }
        .buttonStyle(QuickNavTileButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: item.accessibilityLabel))
        .accessibilityHint(Text(verbatim: item.accessibilityHint))
        .accessibilityAddTraits(.isButton)
    }

    private var iconBadge: some View {
        Image(systemName: item.systemImage)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(item.accentColor)
            .frame(width: 36, height: 36)
            .background(
                item.accentColor.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}

/// Press feedback for a shortcut tile: a subtle scale-down on press that mirrors
/// the web `group-hover` affordance, suppressed under Reduce Motion.
struct QuickNavTileButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Loading grid (web shell `Skeleton`)

/// The redacted loading grid: skeleton tiles in the same responsive layout as the
/// content grid, so the surface never flashes a blank box on first mount.
struct QuickNavSkeletonGrid: View {
    let columns: Int

    var body: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(height: 12)
                        TSSkeleton(width: 60, height: 10)
                    }
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(Color.TS.surfaceGlass, in: tileShape)
                .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: QuickNavStrings.string(
            "widget.quickNavLoading",
            "Loading quick navigation"
        )))
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: max(1, columns))
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}

// MARK: - Empty state (defensive — catalog resolved with no shortcuts)

/// The friendly empty state shown when the resolved catalog is empty. Always
/// rendered in place of a blank panel (never a hidden surface).
struct QuickNavEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                QuickNavStrings.text("widget.quickNavEmptyTitle", "No shortcuts")
            } icon: {
                Image(systemName: "square.grid.2x2")
            }
        } description: {
            QuickNavStrings.text("widget.quickNavEmptyHint", "Navigation shortcuts will appear here.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error state (defensive — catalog failed to resolve)

/// The error state with a retry affordance, shown when the catalog fails to resolve
/// and there are no cached shortcuts to fall back to (web `QueryError` intent).
struct QuickNavErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            QuickNavStrings.text("widget.quickNavErrorTitle", "Couldn't load shortcuts")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                QuickNavStrings.text("widget.quickNavRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(QuickNavStrings.text("widget.quickNavRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
