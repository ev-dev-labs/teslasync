//
//  ReleaseNotes.Previews.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  Xcode previews for every real branch of the release-notes accordion: the canonical list (first release
//  expanded), a different release expanded (single-open), the full badge + change-type palette (latest /
//  stable / beta and added / changed / fixed / removed / deprecated / security), the per-release
//  empty-changes leaf, and the empty list. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 460, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let paletteEntries: [ReleaseNotesEntry] = [
        ReleaseNotesEntry(
            version: "1.0.0-beta.1",
            date: "2026-04-02",
            badge: .beta,
            changes: [
                ReleaseNotesChange(type: .added, text: "New onboarding flow for first-time setup."),
                ReleaseNotesChange(type: .changed, text: "Refined the dashboard layout for wider displays."),
                ReleaseNotesChange(type: .fixed, text: "Resolved a flicker when switching themes."),
                ReleaseNotesChange(type: .removed, text: "Dropped the legacy CSV export endpoint."),
                ReleaseNotesChange(type: .deprecated, text: "The v1 webhook payload is now deprecated."),
                ReleaseNotesChange(type: .security, text: "Rotated signing keys and hardened CORS.")
            ]
        ),
        ReleaseNotesEntry(
            version: "0.9.0",
            date: "2026-03-30",
            badge: .stable,
            changes: [
                ReleaseNotesChange(type: .added, text: "Battery degradation forecast widget.")
            ]
        )
    ]

    #Preview("Canonical — first expanded") {
        staged("default · newest release open") {
            ReleaseNotes()
        }
    }

    #Preview("Full palette — beta open") {
        staged("latest/stable/beta · every change-type tint") {
            ReleaseNotes(entries: paletteEntries, limit: 3)
        }
    }

    #Preview("Empty changes leaf") {
        staged("open release · no changes · never a blank box") {
            ReleaseNotes(
                entries: [
                    ReleaseNotesEntry(version: "0.2.0", date: "2026-03-21", badge: .stable, changes: [])
                ],
                limit: 3
            )
        }
    }

    #Preview("Empty list") {
        staged("no releases to show") {
            ReleaseNotes(entries: [], limit: 3)
        }
    }
#endif
