//
//  DateGroupedList.Previews.swift
//  TeslaSync — P4 shared surface · 0080 · DateGroupedList (Apple)
//
//  Xcode previews for each surface state (populated multi-group with relative labels + summaries,
//  populated single-group with neither, and the friendly empty state). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A throwaway feed item for the previews — the generic `Item` the row builder renders.
    private struct DateGroupedListPreviewDrive: Identifiable {
        let id: String
        let title: String
        let detail: String
    }

    private enum DateGroupedListPreviewData {
        static let groups: [DateGroupedListGroup<DateGroupedListPreviewDrive>] = [
            DateGroupedListGroup(
                dateKey: "2026-05-09",
                dateLabel: "May 9, 2026",
                items: [
                    DateGroupedListPreviewDrive(id: "a", title: "Morning commute", detail: "3.1 mi · 14 min"),
                    DateGroupedListPreviewDrive(id: "b", title: "Grocery run", detail: "3.1 mi · 11 min")
                ],
                relativeLabel: "3 days ago",
                summary: "2 drives · 6.2 mi"
            ),
            DateGroupedListGroup(
                dateKey: "2026-04-24",
                dateLabel: "Apr 24, 2026",
                items: [
                    DateGroupedListPreviewDrive(id: "c", title: "Airport drop-off", detail: "21.4 mi · 32 min"),
                    DateGroupedListPreviewDrive(id: "d", title: "Return trip", detail: "18.5 mi · 29 min")
                ],
                relativeLabel: "18 days ago",
                summary: "2 drives · 39.9 mi"
            )
        ]

        static let bare: [DateGroupedListGroup<DateGroupedListPreviewDrive>] = [
            DateGroupedListGroup(
                dateKey: "2026-06-01",
                dateLabel: "Jun 1, 2026",
                items: [
                    DateGroupedListPreviewDrive(id: "e", title: "Service centre visit", detail: "Tire rotation")
                ]
            )
        ]
    }

    private func dateGroupedPreviewRow(_ drive: DateGroupedListPreviewDrive) -> some View {
        HStack(spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: drive.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: drive.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
    }

    @MainActor
    private func staged(_ groups: [DateGroupedListGroup<DateGroupedListPreviewDrive>]) -> some View {
        DateGroupedList(groups: groups, itemKey: { drive, _ in drive.id }, rowContent: { drive, _ in
            dateGroupedPreviewRow(drive)
        })
        .padding()
        .frame(maxWidth: 460, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Populated — relative + summary") {
        staged(DateGroupedListPreviewData.groups)
    }

    #Preview("Populated — bare group") {
        staged(DateGroupedListPreviewData.bare)
    }

    #Preview("Empty") {
        staged([])
    }
#endif
