//
//  ResetSection.Views.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  The presentational subviews composed by `ResetSection`: the shared panel header (web
//  `IconBox` + title + subtitle), the per-section reset row (web `SectionRowItem`), the
//  by-section reset panel (web "Reset by section"), the read-only deny-list panel (web
//  "Sections that aren't user-resettable"), and the danger-zone panel (web "Danger zone").
//  All consume pre-localized strings from the P1/S10 facade + the shared P1/S9 tokens and
//  the design-system `TSButton`/`TSIconBox`; no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Shared panel header (web `IconBox` + title + subtitle)

/// A panel header — a tinted icon box plus the title + subtitle copy. Shared by all three
/// panels so the icon tone, the title weight, and the subtitle styling stay consistent.
struct ResetPanelHeader: View {
    let systemImage: String
    let tone: TSTone
    let title: String
    let subtitle: String
    var titleFont: Font = .TS.section

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: systemImage, tone: tone)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(titleFont)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: subtitle)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Per-section reset row (web `SectionRowItem`)

/// One resettable-section row: the cyan icon box, the title + description, and the per-row
/// Reset button (disabled + spinner-labelled while that section's reset is in flight).
/// Adapts from a side-by-side row to a stacked column on narrow widths (web `flex-wrap`).
struct ResetSectionRowItem: View {
    let row: ResetSectionRow
    let busy: Bool
    let onReset: () -> Void

    private var title: String {
        row.title(ResetStrings.string)
    }

    private var description: String {
        row.description(ResetStrings.string)
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                textBlock
                Spacer(minLength: TSSpacing.md)
                resetButton
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                textBlock
                HStack { Spacer(minLength: 0); resetButton }
            }
        }
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }

    private var textBlock: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: row.systemImage, tone: .accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: ResetAdapter.sectionAccessibility(row: row, localize: ResetStrings.string))
        )
    }

    private var resetButton: some View {
        TSButton(variant: .ghost, size: .small, isLoading: busy, action: onReset) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                ResetStrings.text("settingsReset.actions.reset", "Reset")
            }
        }
        .disabled(busy)
        .accessibilityLabel(ResetStrings.text("settingsReset.actions.reset", "Reset"))
        .accessibilityHint(Text(verbatim: title))
        .accessibilityIdentifier("reset-section-button-\(row.id)")
    }
}

// MARK: - Deny-list row (web read-only row)

/// One read-only deny-list row: the amber warning glyph plus the title + the reason it
/// can't be reset from this surface.
struct ResetDeniedRowItem: View {
    let row: ResetDeniedRow

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: row.title(ResetStrings.string))
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: row.reason(ResetStrings.string))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: ResetAdapter.deniedAccessibility(row: row, localize: ResetStrings.string))
        )
        .accessibilityIdentifier("reset-section-denied-row-\(row.id)")
    }
}

// MARK: - By-section panel (web "Reset by section")

/// The first panel: the header plus the list of resettable sections, divided into rows.
/// When the list resolves empty it shows a friendly empty state rather than a blank box —
/// the global danger zone below stays available regardless.
struct ResetBySectionPanel: View {
    let model: ResetSectionModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ResetPanelHeader(
                systemImage: "arrow.counterclockwise",
                tone: .warning,
                title: ResetStrings.string("settingsReset.title", "Reset to defaults"),
                subtitle: ResetStrings.string(
                    "settingsReset.subtitle",
                    "Restore an individual section to its default state. Each reset is destructive and "
                        + "cannot be undone — export your settings first if you want a backup."
                )
            )
            if model.sections.isEmpty {
                ResetEmptyRows()
            } else {
                rows
            }
        }
        .padding(TSSpacing.xl)
        .tsGlassPanel()
        .accessibilityIdentifier("reset-section-by-section")
    }

    private var rows: some View {
        VStack(spacing: 0) {
            ForEach(Array(model.sections.enumerated()), id: \.element.id) { index, row in
                if index > 0 {
                    Divider().overlay(Color.TS.border)
                }
                ResetSectionRowItem(
                    row: row,
                    busy: model.isSectionBusy(row.id),
                    onReset: { model.requestResetSection(row) }
                )
            }
        }
    }
}

/// Friendly empty state for the by-section list (web resolved-but-empty) — never blank.
struct ResetEmptyRows: View {
    var body: some View {
        let label = ResetStrings.string(
            "settingsReset.empty",
            "No resettable sections are available on this deployment."
        )
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Deny-list panel (web "Sections that aren't user-resettable")

/// The second panel: the shield header plus the read-only deny-list rows.
struct ResetDeniedPanel: View {
    let denied: [ResetDeniedRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ResetPanelHeader(
                systemImage: "shield.fill",
                tone: .accent,
                title: ResetStrings.string(
                    "settingsReset.deniedTitle",
                    "Sections that aren’t user-resettable"
                ),
                subtitle: ResetStrings.string(
                    "settingsReset.deniedSubtitle",
                    "These sections live outside this server’s preference store. The Settings page can’t "
                        + "reset them, but the linked instructions tell you where to go."
                ),
                titleFont: Font.TS.panel
            )
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(denied) { row in
                    ResetDeniedRowItem(row: row)
                }
            }
        }
        .padding(TSSpacing.xl)
        .tsGlassPanel()
        .accessibilityIdentifier("reset-section-denied")
    }
}

// MARK: - Danger-zone panel (web "Danger zone")

/// The third panel: the red octagon header, the typed-confirmation hint, and the
/// destructive "Reset ALL settings" trigger. The panel carries a danger-tinted border to
/// echo the web `border-tesla-red/30`.
struct ResetDangerZonePanel: View {
    let model: ResetSectionModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ResetPanelHeader(
                systemImage: "exclamationmark.octagon.fill",
                tone: .danger,
                title: ResetStrings.string("settingsReset.dangerZone.title", "Danger zone"),
                subtitle: ResetStrings.string(
                    "settingsReset.dangerZone.subtitle",
                    "Wipe every user-discoverable preference at once. Alert rules, geofences, channels, "
                        + "automations, dashboard layouts, and your typed preference rows are all deleted in a "
                        + "single transaction."
                )
            )
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    helpText
                    Spacer(minLength: TSSpacing.md)
                    resetAllButton
                }
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    helpText
                    HStack { Spacer(minLength: 0); resetAllButton }
                }
            }
        }
        .padding(TSSpacing.xl)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityIdentifier("reset-section-danger-zone")
    }

    private var helpText: some View {
        ResetStrings.text(
            "settingsReset.dangerZone.help",
            "You will be asked to type RESET to confirm."
        )
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var resetAllButton: some View {
        TSButton(
            variant: .destructive,
            size: .medium,
            isLoading: model.isResettingAll,
            action: { model.requestResetAll() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 13, weight: .semibold))
                        .accessibilityHidden(true)
                    ResetStrings.text("settingsReset.dangerZone.cta", "Reset ALL settings")
                }
            }
        )
        .disabled(model.isResettingAll)
        .accessibilityLabel(ResetStrings.text("settingsReset.dangerZone.cta", "Reset ALL settings"))
        .accessibilityIdentifier("reset-section-reset-all")
    }
}
