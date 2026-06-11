//
//  ChangelogModal.Rows.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The collapsible release entry + change-section + badge leaf views `ChangelogPopulatedView` composes
//  (split from the chrome for the lint file-length budget): the per-release card (a disclosure header with
//  the version, the Latest/Stable/Beta badge, and the date; an expanded body grouping the changes by
//  category with a tinted dot per category), and the tone-styled release badge. The change text + version
//  + date are product copy rendered verbatim; all chrome copy resolves through P1/S10. Binds through
//  `ChangelogModel` (P1/S8).
//

import SwiftUI

// MARK: - Release entry (web `ChangelogModalEntry`)

/// One collapsible release (web `ChangelogModalEntry`): a disclosure header (version + badge + date +
/// chevron) over the grouped change sections when expanded. The header toggles the model's per-release
/// disclosure state (web entry `setExpanded`).
struct ChangelogEntryRow: View {
    @Bindable var model: ChangelogModel
    let entry: ChangelogReleaseEntry

    private var isExpanded: Bool {
        model.isExpanded(entry.version)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if isExpanded {
                Divider().overlay(Color.TS.border)
                expandedSections
            }
        }
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        Button { model.toggle(entry.version) } label: {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: "v\(entry.version)")
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                ChangelogReleaseBadge(label: model.badgeLabel(entry.badge), badge: entry.badge)
                Text(verbatim: entry.date)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Text(verbatim: model.entryAccessibilityLabel(entry)))
        .accessibilityHint(Text(verbatim: model.entryAccessibilityHint(entry.version)))
        .accessibilityValue(Text(verbatim: model.badgeLabel(entry.badge)))
    }

    private var expandedSections: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(model.groups(for: entry)) { group in
                ChangelogSectionView(label: model.sectionLabel(group.type), group: group)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Change section (web grouped `<div>` per category)

/// One change category within a release (web `grouped.map`): an uppercase section heading over the change
/// items, each a tinted category dot beside its verbatim text.
struct ChangelogSectionView: View {
    let label: String
    let group: ChangelogGroup

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label.uppercased())
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textMuted)
                .tracking(0.6)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(group.items.enumerated()), id: \.offset) { _, item in
                ChangelogChangeRow(type: group.type, text: item.text)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One change line (web `<li>`): a tinted category dot beside the verbatim change text.
struct ChangelogChangeRow: View {
    let type: ChangelogChangeType
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Circle()
                .fill(ChangelogSectionPalette.dotColor(type))
                .frame(width: 6, height: 6)
                .padding(.top, 6)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Release badge (web `<Badge variant=…>`)

/// The release badge (web `Badge`): a tinted capsule whose tone reflects the classification — `latest`
/// success / `stable` info / `beta` warning (web `BADGE_VARIANT`).
struct ChangelogReleaseBadge: View {
    let label: String
    let badge: ChangelogBadgeKind

    private var tone: Color {
        switch badge {
        case .latest: Color.TS.statusSuccess
        case .stable: Color.TS.statusInfo
        case .beta: Color.TS.statusWarning
        }
    }

    var body: some View {
        Text(verbatim: label)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Section dot palette (web `SECTION_DOT`)

/// The per-category dot tint — the native parity of the web `SECTION_DOT` map, toned to the design-token
/// status colors (deprecated keeps a purple via the chart palette, matching the web purple dot).
enum ChangelogSectionPalette {
    static func dotColor(_ type: ChangelogChangeType) -> Color {
        switch type {
        case .added: Color.TS.statusSuccess
        case .changed: Color.TS.accent
        case .fixed: Color.TS.statusWarning
        case .removed: Color.TS.statusDanger
        case .deprecated: Color.TS.chartSeriesPower
        case .security: Color.TS.statusDanger
        }
    }
}
