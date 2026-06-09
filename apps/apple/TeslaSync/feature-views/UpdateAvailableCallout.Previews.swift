//
//  UpdateAvailableCallout.Previews.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  Xcode previews for each render branch — the presented callout's web fragment
//  combinations (full / no-current / no-checkedAt / no-latest), the P4 freshness leaf
//  (live / stale / offline), and the withdrawn phases (loading / up-to-date / check failed)
//  which render nothing on purpose (web parent `!hasUpdate` → no DOM), made visible as an
//  intentional absence. DEBUG-only; compiled by the app targets.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: UpdateAvailableInput) -> UpdateAvailableModel {
        let source = InMemoryUpdateAvailableSource(initial: input)
        let model = UpdateAvailableModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewSurface(_ input: UpdateAvailableInput) -> some View {
        ScrollView {
            UpdateAvailableCallout(model: previewModel(input))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private let previewCheckedAt = Date(timeIntervalSince1970: 1_736_942_400) // 2025-01-15T12:00:00Z

    // MARK: Presented — the three web fragment combinations

    #Preview("Presented · full (current + checkedAt)") {
        previewSurface(.loaded(
            current: "1.0.0",
            latest: "1.2.0",
            checkedAt: previewCheckedAt
        ))
    }

    #Preview("Presented · no current") {
        previewSurface(.loaded(
            current: nil,
            latest: "1.2.0",
            checkedAt: previewCheckedAt
        ))
    }

    #Preview("Presented · no checkedAt") {
        previewSurface(.loaded(
            current: "1.0.0",
            latest: "1.2.0",
            checkedAt: nil
        ))
    }

    #Preview("Presented · no latest (version-less heading)") {
        previewSurface(.loaded(
            current: "1.0.0",
            latest: nil,
            checkedAt: previewCheckedAt
        ))
    }

    // MARK: Presented — the P4 freshness leaf axis

    #Preview("Presented · stale") {
        previewSurface(.loaded(
            current: "1.0.0",
            latest: "1.2.0",
            checkedAt: previewCheckedAt,
            connection: .stale
        ))
    }

    #Preview("Presented · offline") {
        previewSurface(.loaded(
            current: "1.0.0",
            latest: "1.2.0",
            checkedAt: previewCheckedAt,
            connection: .offline
        ))
    }

    // MARK: Withdrawn — the web parent `!hasUpdate` absences (render nothing on purpose)

    #Preview("Withdrawn · loading") {
        previewSurface(UpdateAvailableInput(loadState: .loading))
    }

    #Preview("Withdrawn · up to date") {
        previewSurface(.loaded(current: "1.2.0", latest: "1.2.0", updateAvailable: false))
    }

    #Preview("Withdrawn · check failed") {
        previewSurface(UpdateAvailableInput(loadState: .failed))
    }
#endif
