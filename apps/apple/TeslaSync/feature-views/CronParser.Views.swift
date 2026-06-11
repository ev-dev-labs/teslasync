//
//  CronParser.Views.swift
//  TeslaSync — P4 feature view · 0014 · CronParser (Apple)
//
//  Presentational subviews for the Cron Parser surface — the ToolCard-style header, the
//  expression field (with the empty-state example), the wrap-flowing presets, the
//  description panel, the "Next Runs" list, the no-runs note, and the empty hint. All
//  copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9) and built
//  on the shared component library.
//

import SwiftUI

// MARK: - Header (web `ToolCard` icon + title + description)

/// The green ToolCard-style header: a `timer` glyph (web lucide `Timer`) over the title
/// + description.
struct CronParserHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "timer", tone: .success)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                CronParserStrings.text("Cron Parser", "Cron Parser")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                CronParserStrings.text(
                    "Cron Parser Desc",
                    "Parse and explain cron expressions, and preview upcoming run times."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Input field (web `Input`)

/// The single-line cron expression field: a leading timer glyph, a monospaced editor,
/// the example shown while empty, and the field label. Token-driven field chrome.
struct CronInputField: View {
    @Binding var text: String
    let example: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            CronParserStrings.text("Cron Expression", "Cron Expression")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "timer")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                ZStack(alignment: .leading) {
                    if text.isEmpty {
                        Text(verbatim: example)
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(Color.TS.textMuted)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    TextField("", text: $text)
                        .textFieldStyle(.plain)
                        .font(.system(.body, design: .monospaced))
                        .autocorrectionDisabled()
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel(CronParserStrings.text("Cron Expression", "Cron Expression"))
            .accessibilityValue(Text(verbatim: text))
        }
    }
}

// MARK: - Presets (web `flex flex-wrap` of ghost `Button`s)

/// The wrap-flowing preset buttons. A `LazyVGrid` with adaptive columns reflows them
/// across iPhone / iPad / Mac widths.
struct CronPresetRow: View {
    let presets: [CronPreset]
    let onSelect: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.sm, alignment: .leading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(presets) { preset in
                TSButton(
                    variant: .ghost,
                    size: .small,
                    action: { onSelect(preset.value) },
                    label: { CronParserStrings.text(preset.labelKey, preset.labelFallback) }
                )
                .accessibilityHint(CronParserStrings.text("a11y.cron.presetHint", "Fills the expression field"))
            }
        }
    }
}

// MARK: - Description panel (web `{description && …}`)

/// The description panel — a "Description" caption over the human-readable schedule in
/// the success accent (web `text-emerald-300`).
struct CronDescriptionPanel: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            CronParserStrings.text("Description", "Description")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusSuccess)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.bg,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Next runs (web `{nextRuns.length > 0 && …}`)

/// The "Next Runs" list — a caption over one chip per upcoming instant. When the
/// schedule has no upcoming runs the section shows a friendly note instead of a blank
/// box, honoring the "never a blank box" surface contract.
struct CronNextRunsSection: View {
    let rows: [CronRunRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            CronParserStrings.text("Next Runs", "Next Runs")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            if rows.isEmpty {
                CronNoRunsNote()
            } else {
                ForEach(rows) { row in
                    CronRunRowView(row: row)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A single upcoming-run chip: the 1-based index badge (web `Badge variant="info"`) and
/// the formatted instant in a monospaced secondary tone (web `font-mono`).
struct CronRunRowView: View {
    let row: CronRunRow

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSBadge("\(row.index)", tone: .info)
            Text(verbatim: row.label)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.bg,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: runAccessibilityLabel))
    }

    private var runAccessibilityLabel: String {
        let template = CronParserStrings.string("a11y.cron.run", "Run %@: %@")
        return CronEvaluator.fill(template, [String(row.index), row.label])
    }
}

// MARK: - No-runs note + empty hint

/// The friendly "no upcoming runs" note (a valid five-field expression that matches no
/// instant within the one-year search window) — keeps the section from being blank.
struct CronNoRunsNote: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            CronParserStrings.text("cron.noRuns", "No upcoming runs in the next year")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.bg,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// The empty state (web hides both panels when the expression is not five fields) — the
/// surface contract is "never a blank box", so a hint is shown instead.
struct CronEmptyHint: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                CronParserStrings.text("cron.empty.title", "No schedule yet")
            } icon: {
                Image(systemName: "timer")
            }
        } description: {
            CronParserStrings.text(
                "cron.empty.hint",
                "Enter a five-field cron expression above to see its description and next runs."
            )
        }
        .frame(maxWidth: .infinity)
    }
}
