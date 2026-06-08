//
//  DashboardGrid.Views.swift
//  TeslaSync — P4 feature view · 0122 · DashboardGrid (Apple)
//
//  The presentational pieces of the DashboardGrid — the absolute-positioning
//  custom `Layout` (the native equivalent of react-grid-layout's x/y/w/h grid),
//  one widget tile (glass panel + kiosk boost + optional border), the edit-mode
//  chrome (drag handle + settings/remove), the live freshness chip, the edit-mode
//  dot-grid backing, the skeleton tile, and the fullscreen detail. Each piece reads
//  its copy through the injected `DashboardGridLocalizer`; no English is hardcoded.
//  The state switch + the grid/stack composition live in `DashboardGrid.swift`.
//

import SwiftUI

// MARK: - Absolute grid (native equivalent of RGL's x/y/w/h positioning)

/// Carries a tile's grid placement to the custom `Layout` (SwiftUI's idiomatic
/// per-subview channel), so the layout positions each subview from its saved
/// `(x, y, columnSpan, rowSpan)` rather than flowing them.
struct DashboardGridCellKey: LayoutValueKey {
    static let defaultValue = DashboardGridLayoutItem(id: "", x: 0, y: 0, columnSpan: 1, rowSpan: 1)
}

/// A fixed-column grid that places each subview at its absolute `(x, y)` spanning
/// `(columnSpan, rowSpan)` cells — the native, HIG-blessed `Layout` parity of the
/// web `ResponsiveGridLayout`. The geometry is delegated to the unit-tested
/// `DashboardGridPlacement` so this stays a thin shell.
struct DashboardGridFlowLayout: Layout {
    let columns: Int
    let rowHeight: CGFloat
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let width = proposal.replacingUnspecifiedDimensions().width
        let items = subviews.map { $0[DashboardGridCellKey.self] }
        let height = DashboardGridPlacement.contentHeight(items: items, rowHeight: rowHeight, spacing: spacing)
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let columnWidth = DashboardGridPlacement.columnWidth(
            totalWidth: bounds.width,
            columns: columns,
            spacing: spacing
        )
        for subview in subviews {
            let item = subview[DashboardGridCellKey.self]
            let frame = DashboardGridPlacement.frame(
                for: item,
                columnWidth: columnWidth,
                rowHeight: rowHeight,
                spacing: spacing
            )
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: frame.width, height: frame.height)
            )
        }
    }
}

// MARK: - Widget tile (web GlassPanel-wrapped widget body + chrome)

/// One placed widget — the glass panel that wraps the parent-supplied widget body,
/// with the kiosk-opacity boost, the optional border, the edit-mode chrome, and the
/// view-mode expand affordance. Generic over the already-rendered body so the grid
/// owns composition while the parent owns the widget internals (web `def.component`).
struct DashboardWidgetTile<Body: View>: View {
    let context: DashboardWidgetRenderContext
    let editMode: Bool
    let showBorder: Bool
    let kioskStyle: DashboardKioskStyle?
    let localize: DashboardGridLocalizer
    let onRemove: () -> Void
    let onOpenSettings: () -> Void
    let onExpand: () -> Void
    @ViewBuilder let content: () -> Body

    var body: some View {
        panel
            .overlay(alignment: .top) {
                if editMode {
                    DashboardWidgetChrome(
                        name: context.name,
                        localize: localize,
                        onRemove: onRemove,
                        onOpenSettings: onOpenSettings
                    )
                }
            }
            .overlay(alignment: .topTrailing) {
                if !editMode {
                    expandButton
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.tileLabel(context.name, localize: localize)))
    }

    private var panel: some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(TSSpacing.md)
            .background(kioskFill, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .tsGlassPanel(cornerRadius: TSRadius.lg)
            .overlay {
                if showBorder {
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                }
            }
    }

    /// The kiosk opacity boost — a faint surface fill that lifts widget contrast for
    /// at-a-glance reading (web `kioskPanelStyle` background-color boost).
    private var kioskFill: Color {
        Color.TS.surface.opacity(kioskStyle?.backgroundOpacity ?? 0)
    }

    private var expandButton: some View {
        Button(action: onExpand) {
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 28, height: 28)
                .background(Color.TS.surface.opacity(0.6), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.sm)
        .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.expandLabel(context.name, localize: localize)))
    }
}

// MARK: - Edit-mode chrome (drag handle + settings/remove)

/// The edit-mode overlay bar — the native port of the web `WidgetChrome`: a drag
/// handle labelled with the widget name plus the settings and remove controls.
struct DashboardWidgetChrome: View {
    let name: String
    let localize: DashboardGridLocalizer
    let onRemove: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            dragHandle
            Spacer(minLength: TSSpacing.sm)
            settingsButton
            removeButton
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(.ultraThinMaterial, in: UnevenRoundedRectangle(
            topLeadingRadius: TSRadius.lg,
            topTrailingRadius: TSRadius.lg,
            style: .continuous
        ))
    }

    private var dragHandle: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: name)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.dragHandleLabel(name, localize: localize)))
    }

    private var settingsButton: some View {
        Button(action: onOpenSettings) {
            Image(systemName: "gearshape")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.settingsLabel(name, localize: localize)))
    }

    private var removeButton: some View {
        Button(role: .destructive, action: onRemove) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.removeLabel(name, localize: localize)))
    }
}

// MARK: - Freshness chip (stale / offline)

/// The grid-chrome freshness chip — a static tinted capsule shown when the live
/// connection is `stale`/`offline` so the dashboard never implies fresh data while
/// keeping its cached widgets visible.
struct DashboardGridConnectionChip: View {
    let chip: DashboardGridFreshnessChip
    let localize: DashboardGridLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: chip.systemImage)
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: localize.string(chip.labelKey, chip.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: localize.string(chip.labelKey, chip.labelFallback)))
    }
}

// MARK: - Edit-mode dot-grid backing (web radial-gradient dot pattern)

/// The faint dot pattern behind the absolute grid in edit mode — the native port
/// of the web `radial-gradient` background at a 40pt pitch.
struct DashboardDotGridBackground: View {
    var body: some View {
        Canvas { context, size in
            let pitch = DashboardGridMetrics.dotGridPitch
            let dot = Path(ellipseIn: CGRect(x: -0.75, y: -0.75, width: 1.5, height: 1.5))
            let color = GraphicsContext.Shading.color(Color.TS.border.opacity(0.6))
            var positionY = pitch / 2
            while positionY < size.height {
                var positionX = pitch / 2
                while positionX < size.width {
                    context.fill(dot.offsetBy(dx: positionX, dy: positionY), with: color)
                    positionX += pitch
                }
                positionY += pitch
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Skeleton tile (loading grid)

/// One redacted tile for the loading grid — a glass panel with skeleton bars.
struct DashboardWidgetSkeletonTile: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 120, height: 14)
                TSSkeleton(height: 12)
                TSSkeleton(width: 180, height: 12)
                Spacer(minLength: 0)
                TSSkeleton(width: 90, height: 24, cornerRadius: TSRadius.sm)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Fullscreen detail (web `FullscreenOverlay`)

/// The fullscreen widget detail presented as a cross-platform sheet (iOS + macOS)
/// — the native, HIG-idiomatic parity of the web fixed-overlay `FullscreenOverlay`.
/// Renders the enlarged widget body (rows floored at 4) with a titled bar and an
/// explicit exit control.
struct DashboardFullscreenView<Body: View>: View {
    let context: DashboardWidgetRenderContext
    let localize: DashboardGridLocalizer
    let onClose: () -> Void
    @ViewBuilder let content: () -> Body

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: context.name)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: TSSpacing.md)
                TSButton(variant: .secondary, size: .small, action: onClose) {
                    Label {
                        Text(verbatim: DashboardGridAccessibility.exitFullscreenLabel(localize))
                    } icon: {
                        Image(systemName: "arrow.down.right.and.arrow.up.left")
                    }
                }
                .accessibilityLabel(Text(verbatim: DashboardGridAccessibility.exitFullscreenLabel(localize)))
            }

            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .tsGlassPanel(cornerRadius: TSRadius.lg)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.TS.bg)
    }
}
