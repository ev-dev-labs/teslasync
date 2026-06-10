//
//  TourLauncher.Views.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  The populated content for `TourLauncher`: the modal header (sparkle glyph + "Take a tour" +
//  freshness chip + close), the intro subtitle, the per-tour rows (completed-check / play glyph,
//  title, "Recommended for this page" + "Completed" chips, description, and the Start / Replay
//  action), and the footer ("Reset all tours" + "Close"). All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The launcher header: the sparkle glyph, the "Take a tour" title + freshness chip, and the
/// trailing close button (web `Modal` title bar with its `onClose` "×").
struct TourLauncherHeader: View {
    let connection: TourLauncherConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                TourLauncherStrings.text("tour.launcher.title", "Take a tour")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                TourLauncherFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "sparkles")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TourLauncherStrings.text("tourLauncher.closeAria", "Close tour launcher"))
    }
}

// MARK: - Subtitle (web intro paragraph)

/// The launcher's one-line intro (web `tour.launcher.subtitle`).
struct TourLauncherSubtitle: View {
    var body: some View {
        TourLauncherStrings.text(
            "tour.launcher.subtitle",
            "Bite-sized walkthroughs of each area. Replay any tour anytime."
        )
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Content (web populated `<ul>` + footer)

/// The populated body shown for `.content`: the inline reload error (when a refresh failed while
/// rows remain) and the list of tour rows.
struct TourLauncherList: View {
    @Bindable var model: TourLauncherModel
    let onStart: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if let message = model.inlineErrorMessage {
                TourLauncherInlineError(message: message)
            }
            ForEach(model.rows) { row in
                TourLauncherRowView(
                    row: row,
                    accessibilityLabel: model.accessibilityRowLabel(for: row),
                    actionLabel: model.accessibilityActionLabel(for: row),
                    onStart: { onStart(row.id) }
                )
            }
        }
    }
}

// MARK: - Tour row (web `<li>`)

/// One tour row: the status glyph, the title + chips + description, and the Start / Replay action.
/// The recommended row is tinted + bordered with the accent the way the web highlights it.
struct TourLauncherRowView: View {
    let row: TourRow
    let accessibilityLabel: String
    let actionLabel: String
    let onStart: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TourRowGlyph(completed: row.completed)
            infoColumn
            Spacer(minLength: TSSpacing.sm)
            actionButton
        }
        .padding(TSSpacing.md)
        .background(rowBackground)
        .overlay(rowBorder)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var infoColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: row.title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if row.recommended { TourRecommendedBadge() }
                if row.completed { TourCompletedBadge() }
            }
            Text(verbatim: row.description)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actionButton: some View {
        TSButton(variant: row.recommended ? .primary : .ghost, size: .small, action: onStart) {
            Text(verbatim: TourLauncherStrings.string(row.action.titleKey, row.action.titleFallback))
        }
        .accessibilityLabel(Text(verbatim: actionLabel))
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(row.recommended ? Color.TS.accent.opacity(0.06) : Color.TS.surfaceGlass)
    }

    private var rowBorder: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(
                row.recommended ? Color.TS.accent.opacity(0.40) : Color.TS.border,
                lineWidth: 1
            )
    }
}

// MARK: - Row glyph + chips

/// The leading status glyph: a check for a completed tour, else a play glyph (web `Check` /
/// `PlayCircle`).
struct TourRowGlyph: View {
    let completed: Bool

    var body: some View {
        Image(systemName: completed ? "checkmark" : "play.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(completed ? Color.TS.statusSuccess : Color.TS.textSecondary)
            .frame(width: 34, height: 34)
            .background(tint, in: RoundedRectangle(cornerRadius: TSRadius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm)
                    .strokeBorder(border, lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var tint: Color {
        completed ? Color.TS.statusSuccess.opacity(0.10) : Color.TS.surfaceGlass
    }

    private var border: Color {
        completed ? Color.TS.statusSuccess.opacity(0.30) : Color.TS.border
    }
}

/// The "Recommended for this page" chip (web sparkles badge), shown on the route-matched row.
struct TourRecommendedBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "sparkles").font(.system(size: 9, weight: .bold)).accessibilityHidden(true)
            TourLauncherStrings.text("tour.launcher.recommendedHere", "Recommended for this page")
                .font(Font.TS.label)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .background(Color.TS.accent.opacity(0.12), in: Capsule())
        .accessibilityHidden(true)
    }
}

/// The "Completed" chip (web emerald badge), shown on a finished tour.
struct TourCompletedBadge: View {
    var body: some View {
        TourLauncherStrings.text("tour.launcher.completed", "Completed")
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(Color.TS.statusSuccess.opacity(0.12), in: Capsule())
            .accessibilityHidden(true)
    }
}

// MARK: - Footer (web reset-all + close)

/// The launcher footer: the "Reset all tours" text button (left) and the "Close" button (right),
/// separated from the body by a divider (web footer row).
struct TourLauncherFooter: View {
    let onResetAll: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            HStack {
                resetButton
                Spacer(minLength: TSSpacing.sm)
                closeButton
            }
        }
    }

    private var resetButton: some View {
        Button(action: onResetAll) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.counterclockwise").font(.system(size: 11, weight: .semibold))
                TourLauncherStrings.text("tour.launcher.resetAll", "Reset all tours").font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TourLauncherStrings.text("tour.launcher.resetAll", "Reset all tours"))
    }

    private var closeButton: some View {
        TSButton(variant: .ghost, size: .small, action: onClose) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                Text(verbatim: TourLauncherStrings.string("tour.launcher.close", "Close"))
            }
        }
        .accessibilityLabel(TourLauncherStrings.text("tour.launcher.close", "Close"))
    }
}

// MARK: - Localization Text helper

extension TourLauncherStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
