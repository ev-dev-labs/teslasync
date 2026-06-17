//
//  VehicleAccessTable.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/VehicleAccess (Apple) — Table + cell chips
//
//  The reusable presentation primitives the two Vehicle Access panels share: the checkbox-free
//  adaptive table (web `DataTable`), the in-cell chips (web `Badge` / `StatusBadge` / `CopyButton`
//  variants), the section header strip, and the retryable section error view. Extracted from the
//  sections so each file stays within the lint budget and the table can be unit-reasoned in
//  isolation. All copy resolves from `Localizable.xcstrings` via `VehicleAccessPageStrings`; the
//  layout uses only the P2 design tokens + P3 components (no hardcoded colors / typography).
//

import SwiftUI

// MARK: - Adaptive, checkbox-free table (web `DataTable`)

/// A column width policy: stretch to share the remaining width, or a fixed point width.
enum VehicleAccessColumnWidth: Sendable {
    case flexible
    case fixed(CGFloat)
}

/// One column of `VehicleAccessTable`: a stable id, a localized header title (web `Column.header`),
/// a width policy, and a type-erased cell builder (web `Column.render`).
struct VehicleAccessTableColumn<Row: Identifiable>: Identifiable {
    let id: String
    let title: LocalizedStringKey
    let width: VehicleAccessColumnWidth
    let cell: (Row) -> AnyView

    init(
        id: String,
        title: LocalizedStringKey,
        width: VehicleAccessColumnWidth = .flexible,
        @ViewBuilder cell: @escaping (Row) -> some View
    ) {
        self.id = id
        self.title = title
        self.width = width
        self.cell = { AnyView(cell($0)) }
    }
}

/// Renders the web `DataTable` for a row type with an optional trailing action accessory (the
/// remove / revoke icon column whose web header is empty). Regular width → a header row + aligned
/// data rows; compact width → labeled cards. No selection chrome (the web table has none).
struct VehicleAccessTable<Row: Identifiable>: View {
    let rows: [Row]
    let columns: [VehicleAccessTableColumn<Row>]
    let accessibilityLabel: LocalizedStringKey
    let trailing: (Row) -> AnyView

    private let actionColumnWidth: CGFloat = 32

    init(
        rows: [Row],
        columns: [VehicleAccessTableColumn<Row>],
        accessibilityLabel: LocalizedStringKey,
        @ViewBuilder trailing: @escaping (Row) -> some View
    ) {
        self.rows = rows
        self.columns = columns
        self.accessibilityLabel = accessibilityLabel
        self.trailing = { AnyView(trailing($0)) }
    }

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool { horizontalSizeClass == .compact }
    #else
        private var isCompact: Bool { false }
    #endif

    var body: some View {
        Group {
            if isCompact {
                compactCards
            } else {
                regularGrid
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    // MARK: Regular (macOS / iPad) — header strip + aligned rows

    private var regularGrid: some View {
        VStack(spacing: 0) {
            headerRow
            Divider().overlay(Color.TS.border)
            ForEach(rows) { row in
                dataRow(row)
                Divider().overlay(Color.TS.border.opacity(0.5))
            }
        }
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(columns) { column in
                columnWidth(TSLabel(column.title), column.width)
            }
            Color.clear.frame(width: actionColumnWidth)
        }
        .padding(.vertical, TSSpacing.sm)
    }

    private func dataRow(_ row: Row) -> some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(columns) { column in
                columnWidth(column.cell(row), column.width)
            }
            trailing(row)
                .frame(width: actionColumnWidth, alignment: .center)
        }
        .padding(.vertical, TSSpacing.sm)
    }

    @ViewBuilder
    private func columnWidth(_ view: some View, _ width: VehicleAccessColumnWidth) -> some View {
        switch width {
        case .flexible:
            view.frame(maxWidth: .infinity, alignment: .leading)
        case let .fixed(value):
            view.frame(width: value, alignment: .leading)
        }
    }

    // MARK: Compact (iPhone) — labeled cards

    private var compactCards: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(rows) { row in
                TSCard {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        ForEach(columns) { column in
                            HStack(alignment: .firstTextBaseline) {
                                TSLabel(column.title)
                                Spacer(minLength: TSSpacing.md)
                                column.cell(row)
                            }
                        }
                        HStack {
                            Spacer()
                            trailing(row)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Small in-cell chips (web Badge / StatusBadge / CopyButton variants)

/// Neutral count chip next to a section title (web `<Badge variant="neutral">{list.length}</Badge>`).
struct VehicleAccessCountBadge: View {
    let count: Int

    var body: some View {
        Text(verbatim: "\(count)")
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text("\(count)"))
    }
}

/// Info-toned role chip (web `<Badge variant="info">{row.role}</Badge>`). The role is a server value,
/// rendered verbatim; a missing role falls back to the em-dash sentinel.
struct VehicleAccessRoleBadge: View {
    let role: String?

    var body: some View {
        if let role, !role.isEmpty {
            Text(verbatim: role)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusInfo)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.statusInfo.opacity(0.15), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1))
        } else {
            Text(verbatim: VehicleAccessPageFormat.emDash)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// Invitation status dot + mapped word (web `StatusBadge` with the pending→online / revoked→offline
/// / else→asleep mapping). The word is verbatim (the web renders the mapped vehicle-status string).
struct VehicleAccessStatusBadge: View {
    let status: String

    private var mapped: VehicleAccessInvitationStatus { VehicleAccessInvitationStatus(status: status) }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSStatusDot(tone: mapped.tone)
            Text(verbatim: mapped.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: mapped.label))
    }
}

// MARK: - Section header (icon + title + count + actions)

/// The shared header strip for both panels (web flex row: icon + title + count badge + actions).
struct VehicleAccessSectionHeader<Actions: View>: View {
    let systemImage: String
    let title: LocalizedStringKey
    let itemCount: Int
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSPanelTitle(title)
            if itemCount > 0 {
                VehicleAccessCountBadge(count: itemCount)
            }
            Spacer(minLength: TSSpacing.md)
            actions()
        }
    }
}

// MARK: - Section error view (web section error + Retry)

/// Retryable failure of a list source (ADR-011 — never a blank region). The default error chrome
/// (icon + title + Retry) plus the verbatim server message underneath.
struct VehicleAccessErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TSErrorDisplay(onRetry: onRetry)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}
