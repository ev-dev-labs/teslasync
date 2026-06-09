//
//  VersionInfoWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0111 · VersionInfoWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / content, across compact, standard, and wide layouts). DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: VersionInfoUpdate) -> VersionInfoModel {
        let source = InMemoryVersionInfoSource(initial: update)
        let model = VersionInfoModel(source: source)
        model.start()
        return model
    }

    private let fullVersion = VersionInfoData(
        chartVersion: "v2.18.3",
        goVersion: "go1.25.1",
        buildDate: "2026-06-01",
        gitCommit: "a1b2c3d4e5f6a7b8",
        uptime: "12d 4h 37m",
        osName: "linux",
        arch: "arm64"
    )

    private let fullCapture = VersionCaptureStats(
        signalsPerSec: 142.7,
        messagesToday: 1_284_553,
        bytesProcessed: 4_938_271_233,
        avgLatencyMs: 3.4
    )

    private let fullSnapshot = VersionInfoSnapshot(version: fullVersion, capture: fullCapture)

    /// The server omits build_date / git_commit / uptime / capture counters: the
    /// defensive reads fall through to the em dash / zero.
    private let sparseSnapshot = VersionInfoSnapshot(
        version: VersionInfoData(chartVersion: "v2.18.3", goVersion: "go1.25.1", osName: "linux", arch: "arm64"),
        capture: nil
    )

    #Preview("Content (standard)") {
        VersionInfoWidget(
            model: previewModel(
                VersionInfoUpdate(status: .loaded, connection: .live, snapshot: fullSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 260, height: 230)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        VersionInfoWidget(
            model: previewModel(
                VersionInfoUpdate(status: .loaded, connection: .live, snapshot: fullSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        )
        .frame(width: 460, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (sparse)") {
        VersionInfoWidget(
            model: previewModel(
                VersionInfoUpdate(status: .loaded, connection: .live, snapshot: sparseSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 260, height: 230)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        VersionInfoWidget(
            model: previewModel(
                VersionInfoUpdate(status: .loaded, connection: .live, snapshot: fullSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VersionInfoWidget(model: previewModel(VersionInfoUpdate(status: .loading, snapshot: nil)))
            .frame(width: 260, height: 230)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VersionInfoWidget(model: previewModel(VersionInfoUpdate(status: .loaded, snapshot: nil)))
            .frame(width: 260, height: 230)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VersionInfoWidget(
            model: previewModel(VersionInfoUpdate(status: .failed("Network unavailable"), snapshot: nil))
        )
        .frame(width: 260, height: 230)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        VersionInfoWidget(
            model: previewModel(
                VersionInfoUpdate(
                    status: .loaded,
                    connection: .stale,
                    snapshot: fullSnapshot,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            )
        )
        .frame(width: 260, height: 230)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        VersionInfoWidget(
            model: previewModel(
                VersionInfoUpdate(
                    status: .loaded,
                    connection: .offline,
                    snapshot: fullSnapshot,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 260, height: 230)
        .padding()
        .background(Color.TS.bg)
    }
#endif
