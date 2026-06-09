//
//  SoftwareUpdateStatusWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  Projection assembly — the cached→projection adapter body, a faithful Swift port
//  of the `SoftwareUpdateStatusWidget.tsx` component body (the current-version
//  headline, the derived stage + chip, the update section's target version,
//  progress bar, ready message, estimate, and schedule). Builds on the pure
//  primitives in SoftwareUpdateStatusWidget.Builder.swift. No SwiftUI / transport
//  here — this is the unit-tested core both platforms agree on.
//

import Foundation

extension SoftwareStatusProjectionBuilder {
    /// Builds the full projection from the cached input, faithful to the web
    /// `SoftwareUpdateStatusWidget` body. `input == nil` is the web `state` falsy
    /// "No software data" empty state.
    public static func build(input: SoftwareStatusInput?) -> SoftwareStatusProjection {
        guard let input else { return .empty }

        let stage = updateStage(
            updateVersion: input.updateVersion,
            downloadPct: input.downloadPct,
            installPct: input.installPct
        )
        let target = nonEmpty(input.updateVersion)
        // Web renders the update section only when an update exists AND we are not
        // up to date; the target version is what the section keys off of.
        let sectionTarget = stage == .upToDate ? nil : target

        let durationMinutes = positiveDuration(input.expectedDurationMinutes)

        return SoftwareStatusProjection(
            hasData: true,
            currentVersion: displayVersion(input.softwareVersion),
            stage: stage,
            statusBadge: badge(for: stage),
            updateVersion: sectionTarget,
            progress: progress(
                stage: stage,
                downloadPct: input.downloadPct,
                installPct: input.installPct
            ),
            expectedDurationMinutes: durationMinutes,
            expectedDurationText: durationMinutes.map { durationText($0) },
            scheduledStart: nonEmpty(input.scheduledStart)
        )
    }

    /// Web `expectedDuration != null && expectedDuration > 0` — keep the estimate
    /// only when strictly positive (and finite).
    static func positiveDuration(_ minutes: Double?) -> Double? {
        guard let minutes, minutes.isFinite, minutes > 0 else { return nil }
        return minutes
    }
}
