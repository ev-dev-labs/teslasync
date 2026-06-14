//
//  VersionSegment.Previews.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  Xcode previews for each surface state (ready / icon-only / update / unseen / loading / empty / error /
//  stale / offline) plus the "About this build" modal content. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope. The previews drive the in-memory source so every branch
//  renders without a network or real time.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ snapshot: VersionSegmentSnapshot,
        buildInfo: VersionSegmentBuildInfo = VersionSegmentBuildInfo(buildVersion: "2026.6.2", buildSHA: "a1b2c3d")
    ) -> VersionSegmentModel {
        let source = InMemoryVersionSegmentSource(initial: snapshot)
        let model = VersionSegmentModel(source: source, buildInfo: buildInfo)
        model.start()
        return model
    }

    private let previewInfo = VersionSegmentInfo(
        appVersion: "2026.6.2",
        chartVersion: "1.4.0",
        goVersion: "go1.25.0",
        os: "linux",
        arch: "arm64",
        uptimeSeconds: 273_600
    )

    #Preview("Ready — full") {
        VersionSegment(model: previewModel(VersionSegmentSnapshot(versionInfo: previewInfo)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready — update available") {
        VersionSegment(model: previewModel(VersionSegmentSnapshot(
            versionInfo: previewInfo,
            updateCheck: UpdateCheckResult(updateAvailable: true, latest: "2026.7.0", message: "Security fixes")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready — unseen changelog") {
        VersionSegment(model: previewModel(VersionSegmentSnapshot(
            versionInfo: previewInfo, changelogUnseenCount: 3
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready — icon only") {
        VersionSegment(
            model: previewModel(VersionSegmentSnapshot(versionInfo: previewInfo, changelogUnseenCount: 2)),
            iconOnly: true
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading — first probe") {
        VersionSegment(model: previewModel(
            VersionSegmentSnapshot(isLoading: true),
            buildInfo: VersionSegmentBuildInfo(buildVersion: nil, buildSHA: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — no version") {
        VersionSegment(model: previewModel(
            VersionSegmentSnapshot(),
            buildInfo: VersionSegmentBuildInfo(buildVersion: nil, buildSHA: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error — probe failed") {
        VersionSegment(model: previewModel(
            VersionSegmentSnapshot(errorMessage: "The /system/version request timed out"),
            buildInfo: VersionSegmentBuildInfo(buildVersion: nil, buildSHA: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale — poll failed") {
        VersionSegment(model: previewModel(VersionSegmentSnapshot(versionInfo: previewInfo, connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline — last known") {
        VersionSegment(model: previewModel(VersionSegmentSnapshot(versionInfo: previewInfo, connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Modal — About this build") {
        let resolved = VersionSegmentProjection.resolve(VersionSegmentInput(
            snapshot: VersionSegmentSnapshot(
                versionInfo: previewInfo,
                updateCheck: UpdateCheckResult(updateAvailable: true, latest: "2026.7.0", message: "Security fixes"),
                changelogUnseenCount: 2
            ),
            buildInfo: VersionSegmentBuildInfo(buildVersion: "2026.6.2", buildSHA: "a1b2c3d")
        ))
        return VersionSegmentModalContent(
            data: resolved.data ?? VersionSegmentData(
                appVersion: "2026.6.2", sha: "a1b2c3d", hasSHA: true, updateAvailable: false,
                latestVersion: nil, updateMessage: nil, uptimeLabel: nil,
                hasUnseenChangelog: false, unseenChangelogCount: 0, provenanceRows: []
            ),
            connection: .stale,
            onOpenChangelog: {},
            onOpenReleaseNotes: {},
            onClose: {},
            onRefresh: {}
        )
        .padding()
        .frame(maxWidth: 420)
        .background(Color.TS.bg)
    }
#endif
