//
//  DashboardStatsWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0033 · DashboardStatsWidget (Apple)
//
//  The leaf SwiftUI subviews the Dashboard Stats surface composes: the FSM state palette, the
//  stat tile (web `StatCard`), the current-state badge (web `StatusBadge`), the neutral
//  recent-transition row (web `Badge` + relative time), and the compact big-number block. They
//  hold no surface state, so they live beside the main view to keep DashboardStatsWidget.swift
//  focused on the state machine + layout.
//

import SwiftUI

// MARK: - FSM state palette (port of the web VEHICLE_STATE_ENTRIES badgeDot map)

/// The per-state dot swatch the current-state `StatusBadge` paints, a faithful port of the web
/// `VEHICLE_STATE_ENTRIES` `badgeDot` Tailwind classes (resolved through `VARIANT_THEME` for the
/// states without an override). These categorical colors stay constant across light/dark (like the
/// chart palette); neutral chrome elsewhere on the surface uses design tokens so light theme works.
enum DashboardStatsPalette {
    /// online → success variant `bg-green-400` (#4ADE80).
    static let online = Color(.sRGB, red: 0.290, green: 0.871, blue: 0.502, opacity: 1)
    /// driving → override `bg-blue-500` (#3B82F6).
    static let driving = Color(.sRGB, red: 0.231, green: 0.510, blue: 0.965, opacity: 1)
    /// charging → override `bg-yellow-400` (#FACC15).
    static let charging = Color(.sRGB, red: 0.980, green: 0.800, blue: 0.082, opacity: 1)
    /// parked → override `bg-cyan-500` (#06B6D4).
    static let parked = Color(.sRGB, red: 0.024, green: 0.714, blue: 0.831, opacity: 1)
    /// updating → override `bg-indigo-500` (#6366F1).
    static let updating = Color(.sRGB, red: 0.388, green: 0.400, blue: 0.945, opacity: 1)
    /// asleep → override `bg-purple-500` (#A855F7).
    static let asleep = Color(.sRGB, red: 0.659, green: 0.333, blue: 0.969, opacity: 1)
    /// offline → danger variant `bg-red-400` (#F87171).
    static let offline = Color(.sRGB, red: 0.973, green: 0.443, blue: 0.443, opacity: 1)
    /// unknown → neutral `DEFAULT_STATE` `bg-gray-400` (#9CA3AF).
    static let unknown = Color(.sRGB, red: 0.612, green: 0.639, blue: 0.686, opacity: 1)

    /// The header glyph tint (web `text-indigo-400`, #818CF8).
    static let icon = Color(.sRGB, red: 0.506, green: 0.549, blue: 0.972, opacity: 1)

    /// The badge dot for a state kind (web `getStateDefinition('vehicle', state).badgeDot`).
    static func dot(for kind: DashboardVehicleStateKind) -> Color {
        switch kind {
        case .online: online
        case .driving: driving
        case .charging: charging
        case .parked: parked
        case .updating: updating
        case .asleep: asleep
        case .offline: offline
        case .unknown: unknown
        }
    }
}

// MARK: - Stat tile (web `StatCard` inside `WidgetStatGrid`)

/// One stat-grid cell: an uppercase muted label over a tabular value. The native parity of the web
/// `StatCard` the `WidgetStatGrid` renders — a label/value stack on a faint glass tile.
struct DashboardStatTile: View {
    let item: DashboardStatItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: item.label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(verbatim: item.value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(item.label): \(item.value)"))
    }
}

// MARK: - Current-state badge (web `StatusBadge`)

/// The FSM current-state chip — a rounded pill with a state-colored dot and the capitalized state
/// label, the native parity of the web `StatusBadge` (dot = `getStateDefinition(...).badgeDot`,
/// text = CSS-`capitalize`d).
struct DashboardFsmStateBadge: View {
    let rawState: String

    private var kind: DashboardVehicleStateKind {
        DashboardVehicleStateKind.from(raw: rawState)
    }

    private var label: String {
        DashboardStatsProjector.capitalizedState(rawState)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(DashboardStatsPalette.dot(for: kind))
                .frame(width: 7, height: 7)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Recent-transition row (web `Badge variant="neutral"` + relative time)

/// One recent-transition row: a neutral capitalized state pill on the left and the relative
/// `startedAt` time on the right, the native parity of the web wide-layout transitions list. The
/// relative label is recomputed from `now` at render so it stays current (web `formatRelative`).
struct DashboardTransitionRowView: View {
    let row: DashboardTransitionRow
    var now: Date = .init()

    private var relativeLabel: String {
        DashboardStatsStrings.relative(from: row.startedAt, now: now)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.surfaceGlass, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: relativeLabel)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(row.label), \(relativeLabel)"))
    }
}

// MARK: - Compact big number (web 1-column `totalTrips` block)

/// The compact (1-column) layout: the centered trips count over the localized "active" caption,
/// the native parity of the web `isCompact` branch.
struct DashboardStatsBigNumber: View {
    let value: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            DashboardStatsStrings.text("widget.dashboardStats.active", "active")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section caption (web wide-layout `Recent Transitions` header)

/// The uppercase muted section label the wide layout renders above the transitions list (web
/// `text-[10px] uppercase tracking-wider text-[var(--text-muted)]`).
struct DashboardSectionCaption: View {
    let key: String
    let fallback: String

    var body: some View {
        DashboardStatsStrings.text(key, fallback)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
