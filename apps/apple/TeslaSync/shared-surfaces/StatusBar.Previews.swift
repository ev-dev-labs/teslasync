//
//  StatusBar.Previews.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  Xcode previews for every real branch of the status bar (ready, loading, offline, stale, error, empty,
//  icon-only, the inspector) and the individual popover / sheet pieces (the vehicle switcher list, the jobs
//  list, the About-this-build sheet). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG

    #Preview("Ready · all segments") {
        StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input()))
            .frame(width: 600)
    }

    #Preview("Loading · skeleton") {
        StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(phase: .loading)))
            .frame(width: 600)
    }

    #Preview("Offline · cached + chip") {
        StatusBar(model: StatusBarSampleData.model(
            StatusBarSampleData.input(connectivity: .offline, liveStatus: .disconnected)
        ))
        .frame(width: 600)
    }

    #Preview("Stale · freshness chip") {
        StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(liveStatus: .stale)))
            .frame(width: 600)
    }

    #Preview("Error · backend + retry") {
        StatusBar(model: StatusBarSampleData.model(StatusBarSampleData.input(apiHealth: .offline)))
            .frame(width: 600)
    }

    #Preview("Empty · no vehicle / no jobs") {
        StatusBar(model: StatusBarSampleData.model(
            StatusBarSampleData.input(vehicleCount: 0, jobCount: 0)
        ))
        .frame(width: 600)
    }

    #Preview("Icon-only · dense") {
        StatusBar(model: StatusBarSampleData.model(
            StatusBarSampleData.input(prefs: StatusBarPrefs(enabled: true, iconOnly: true))
        ))
        .frame(width: 600)
    }

    #Preview("Inspector · all branches") {
        StatusBarInspector()
    }

    #Preview("Vehicle switcher list") {
        StatusBarVehicleList(
            vm: StatusBarSampleData.model(StatusBarSampleData.input()).presentation.vehicle,
            onSelect: { _ in }
        )
    }

    #Preview("Jobs list") {
        StatusBarJobsList(vm: StatusBarSampleData.model(StatusBarSampleData.input()).presentation.background)
    }

    #Preview("About this build sheet") {
        StatusBarVersionSheetView(
            sheet: StatusBarSampleData.model(StatusBarSampleData.input(updateAvailable: true))
                .presentation.version.sheet,
            onChangelog: {},
            onReleaseNotes: {},
            onClose: {}
        )
    }
#endif
