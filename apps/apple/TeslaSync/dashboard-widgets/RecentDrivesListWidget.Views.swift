//
//  RecentDrivesListWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  The presentational drive-row subview composed by `RecentDrivesListWidget`'s list — a
//  left distance/duration column, an optional center address column (wide only), and a right
//  SoC/battery-used/date column. Consumes the pre-projected `RecentDriveRow` strings and the
//  shared P1/S9 tokens; no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Drive row (web list `Link` row)

/// One drive row: a left distance/duration column, an optional center address column (wide
/// only), and a right SoC/battery-used/date column — the native parity of the web list row.
/// Tapping opens the drive via the injected `onOpen` callback (web `Link` to `/drives/{id}`).
struct RecentDriveRowView: View {
    let row: RecentDriveRow
    let showsAddresses: Bool
    let onOpen: (() -> Void)?

    var body: some View {
        Group {
            if let onOpen {
                Button(action: onOpen) { rowContent }
                    .buttonStyle(.plain)
            } else {
                rowContent
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
        .accessibilityAddTraits(onOpen == nil ? [] : .isButton)
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            distanceColumn
            if showsAddresses { addressColumn }
            Spacer(minLength: TSSpacing.xs)
            metaColumn
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .contentShape(Rectangle())
    }

    private var distanceColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: row.distanceText)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: row.distanceUnit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock")
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: row.durationText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(minWidth: 68, alignment: .leading)
    }

    private var addressColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            addressRow(systemImage: "mappin", tone: Color.TS.statusSuccess, text: row.startAddress)
            addressRow(systemImage: "mappin", tone: Color.TS.statusDanger, text: row.endAddress)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func addressRow(systemImage: String, tone: Color, text: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 9))
                .foregroundStyle(tone.opacity(0.7))
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var metaColumn: some View {
        VStack(alignment: .trailing, spacing: 2) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "battery.100")
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: row.socText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
            HStack(spacing: TSSpacing.xs) {
                if let batteryUsedText = row.batteryUsedText {
                    Text(verbatim: batteryUsedText)
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.accent)
                }
                Text(verbatim: row.dateText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(alignment: .trailing)
    }
}
