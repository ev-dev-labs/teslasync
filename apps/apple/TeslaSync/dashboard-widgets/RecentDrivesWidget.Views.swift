//
//  RecentDrivesWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0079 · RecentDrivesWidget (Apple)
//
//  The presentational subviews composed by `RecentDrivesWidget`: a single tappable drive row,
//  the stale/offline connectivity banner, and the loading skeleton list. All consume pre-projected
//  rows + pre-localized strings (P1/S10) and the shared P1/S9 tokens — no networking, no Tailwind.
//

import SwiftUI

// MARK: - Drive row (web list item / `Link to /drives/{id}`)

/// One drive row: a prominent distance + unit, the `… min · …% → …%` detail line, and a short date,
/// wrapped in a button that opens the drive detail (web `Link to /drives/{id}`).
struct RecentDrivesWidgetDriveRowView: View {
    let row: RecentDrivesWidgetDriveRow
    let onOpen: (() -> Void)?

    var body: some View {
        Button {
            onOpen?()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: row.distanceText)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(verbatim: row.detailText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: row.dateText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs + 2)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(onOpen == nil)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
        .accessibilityAddTraits(onOpen == nil ? [] : .isButton)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the list when the bound source is not live, so cached rows
/// are clearly labeled (web freshness-indicator intent).
struct RecentDrivesWidgetRecentDrivesConnectivityBanner: View {
    let connection: RecentDrivesWidgetConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.recentDrives.offlineBanner" : "widget.recentDrives.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known drives"
            : "Reconnecting — drives may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: RecentDrivesWidgetStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton list

/// The initial-fetch skeleton: a stack of shimmer rows matching the loaded list's rhythm
/// (web `WidgetShell` `loading`). Honors Reduce Motion via `TSSkeleton`.
struct RecentDrivesLoadingRows: View {
    var rowCount = 4

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(width: 84, height: 13, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 132, height: 10, cornerRadius: TSRadius.sm)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 36, height: 10, cornerRadius: TSRadius.sm)
                }
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs + 2)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: RecentDrivesWidgetStrings.string(
            "widget.recentDrives.loading",
            "Loading recent drives"
        )))
    }
}
