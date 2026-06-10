//
//  QuietHoursPanel.Views.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The panel header (icon chip, title + freshness chip, subtitle, and the "Add window"
//  action) and the window list composed by `QuietHoursPanel` — the native parity of the
//  web panel header row + the `<ul>` of rows. All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). No networking and no web Tailwind ports
//  live here. The window row itself lives in QuietHoursPanel.Row.swift.
//

import SwiftUI

// MARK: - Localization Text helper

extension QuietHoursStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values
    /// are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Header (web IconBox + Heading + HelperText + "Add window")

/// The panel header: the moon glyph chip, the title + freshness chip, the subtitle, and
/// the trailing "Add window" button — shown unless the form is already open (web
/// `!draft && <Button>`).
struct QuietHoursHeader: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            titleBlock
            Spacer(minLength: TSSpacing.sm)
            if !model.hasDraft {
                QuietHoursAddButton(model: model)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "moon.zzz.fill")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 40, height: 40)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                QuietHoursStrings.text("quietHours.title", "Quiet hours / Do-Not-Disturb")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                QuietHoursFreshnessChip(connection: model.connection)
            }
            QuietHoursStrings.text("quietHours.subtitle", Self.subtitleFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private static let subtitleFallback =
        "Defer non-critical notifications during sleep, meetings, or other time-of-day windows."
}

// MARK: - Add button (web primary "Add window")

/// The header "Add window" button that opens a fresh draft (web `startCreate`).
struct QuietHoursAddButton: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        Button { model.startCreate() } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
                QuietHoursStrings.text("quietHours.addWindow", "Add window")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.accent.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(QuietHoursStrings.text("quietHours.addWindow", "Add window"))
    }
}

// MARK: - Window list (web `<ul>` of rows → StaggerContainer of cards)

/// The staggered list of window rows (web `windows.map(...)`).
struct QuietHoursList: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                TSStaggerItem(index: index) {
                    QuietHoursWindowRow(model: model, item: item)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}
