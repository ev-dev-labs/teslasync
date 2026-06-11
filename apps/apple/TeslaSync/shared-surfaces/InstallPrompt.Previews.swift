//
//  InstallPrompt.Previews.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  Xcode previews for each surface state (active prompt / empty-installed / empty-dismissed /
//  empty-unavailable / loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    #Preview("Active prompt") {
        InstallPrompt(canInstall: true, onInstall: { true })
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — installed") {
        InstallPrompt(canInstall: true, isInstalled: true)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — dismissed") {
        InstallPrompt(canInstall: true, dismissed: true)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — unavailable") {
        InstallPrompt(canInstall: false)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        InstallPrompt(isLoading: true)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        InstallPrompt(errorMessage: "The install-availability probe failed to complete")
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        InstallPrompt(canInstall: true, connection: .stale, onInstall: { true })
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        InstallPrompt(canInstall: true, connection: .offline, onInstall: { true })
            .padding()
            .background(Color.TS.bg)
    }
#endif
