//
//  QuietHoursPanel.Row.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  One window row — the native parity of a web `<li>` over a `QuietHoursWindow` (the
//  enabled/disabled badge, the "23:00 → 07:00 (tz)" summary, the next-change hint, the
//  Edit / Delete actions, the weekday chips, and the bypass allow-list). Rendered as a
//  card so the cells reflow on compact widths. Also defines the shared chip label reused
//  by the form. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Row (web `<li>`)

/// A single quiet-hours window card.
struct QuietHoursWindowRow: View {
    @Bindable var model: QuietHoursModel
    let item: QuietHoursWindowItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            headerRow
            if let nextLabel = model.nextChangeLabel(for: item) {
                Text(verbatim: nextLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            weekdayChips
            if !item.bypassSeverities.isEmpty {
                bypassRow
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: QuietHoursAccessibility.rowLabel(item, localize: model.localize)))
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.sm) {
            QuietHoursEnabledBadge(enabled: item.enabled, localize: model.localize)
            Text(verbatim: item.summary)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: TSSpacing.sm)
            QuietHoursRowActions(model: model, item: item)
        }
    }

    private var weekdayChips: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(QuietHoursWeekdays.ordered) { weekday in
                QuietHoursChipLabel(
                    text: model.localize(weekday.key, weekday.fallback),
                    isOn: QuietHoursWeekdays.isOn(item.weekdays, bit: weekday.bit),
                    tone: Color.TS.accent
                )
            }
        }
        .accessibilityHidden(true)
    }

    private var bypassRow: some View {
        HStack(spacing: TSSpacing.xs) {
            QuietHoursStrings.text("quietHours.bypassLabel", "Always allow:")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(item.bypassSeverities, id: \.self) { token in
                QuietHoursChipLabel(
                    text: model.severityLabel(forToken: token),
                    isOn: true,
                    tone: Color.TS.statusWarning
                )
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Row actions (web Edit / Delete buttons)

/// The trailing Edit (secondary) + Delete (destructive) actions. Delete shows a spinner
/// while its mutation is in flight and is disabled meanwhile (web `remove.isPending`).
struct QuietHoursRowActions: View {
    @Bindable var model: QuietHoursModel
    let item: QuietHoursWindowItem

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button { model.startEdit(item) } label: {
                actionLabel(glyph: "pencil", key: "quietHours.edit", fallback: "Edit", tone: Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(QuietHoursStrings.text("quietHours.edit", "Edit"))

            Button { Task { await model.removeWindow(item) } } label: {
                deleteLabel
            }
            .buttonStyle(.plain)
            .disabled(model.isDeleting(item.id))
            .accessibilityLabel(QuietHoursStrings.text("quietHours.delete", "Delete"))
        }
    }

    private var deleteLabel: some View {
        HStack(spacing: TSSpacing.xs) {
            if model.isDeleting(item.id) {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "trash").font(.system(size: 11, weight: .semibold))
            }
            QuietHoursStrings.text("quietHours.delete", "Delete")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusDanger.opacity(0.10), in: Capsule())
    }

    private func actionLabel(glyph: String, key: String, fallback: String, tone: Color) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: glyph).font(.system(size: 11, weight: .semibold))
            QuietHoursStrings.text(key, fallback)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.10), in: Capsule())
    }
}

// MARK: - Enabled badge (web `Badge variant=success|neutral`)

/// The enabled/disabled pill (web `<Badge variant={enabled ? 'success' : 'neutral'}>`).
struct QuietHoursEnabledBadge: View {
    let enabled: Bool
    let localize: (String, String) -> String

    var body: some View {
        let tone = enabled ? Color.TS.statusSuccess : Color.TS.textMuted
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(enabled ? 0.14 : 0.10), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
    }

    private var label: String {
        enabled
            ? localize("quietHours.enabled", "Enabled")
            : localize("quietHours.disabled", "Disabled")
    }
}

// MARK: - Shared chip label (weekday / severity pill — reused by the form)

/// A pill label with on/off styling — the native mirror of the web weekday + severity
/// chips. The form wraps this in a `Button`; the row renders it as a static label.
struct QuietHoursChipLabel: View {
    let text: String
    let isOn: Bool
    let tone: Color

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(isOn ? .semibold : .regular)
            .foregroundStyle(isOn ? tone : Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(isOn ? tone.opacity(0.15) : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(isOn ? tone.opacity(0.4) : Color.TS.border, lineWidth: 1))
    }
}
