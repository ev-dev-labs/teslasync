//
//  ImpersonationBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  Xcode previews for each surface state (active counting / active minutes / active expired / active
//  ending / empty-inactive / empty-unavailable / loading / error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ImpersonationBannerPreviewData {
        /// A fixed reference instant so the countdown previews render deterministically.
        static let now = Date(timeIntervalSince1970: 1_700_000_000)

        static func subject(
            target: String = "subject-aa10",
            inSeconds: TimeInterval?
        ) -> ImpersonationBannerSubject {
            ImpersonationBannerSubject(
                target: target,
                originalAdmin: "admin-root",
                expiresAt: inSeconds.map { now.addingTimeInterval($0) }
            )
        }
    }

    #Preview("Active — counting") {
        ImpersonationBanner(
            status: .active(ImpersonationBannerPreviewData.subject(inSeconds: 95 * 60 + 12)),
            now: { ImpersonationBannerPreviewData.now }
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Active — minutes") {
        ImpersonationBanner(
            status: .active(ImpersonationBannerPreviewData.subject(inSeconds: 5 * 60 + 3)),
            now: { ImpersonationBannerPreviewData.now }
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Active — expired") {
        ImpersonationBanner(
            status: .active(ImpersonationBannerPreviewData.subject(inSeconds: -5)),
            now: { ImpersonationBannerPreviewData.now }
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Active — ending") {
        ImpersonationBanner(
            status: .active(ImpersonationBannerPreviewData.subject(inSeconds: 42 * 60)),
            isEnding: true,
            now: { ImpersonationBannerPreviewData.now }
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — inactive") {
        ImpersonationBanner(status: .inactive)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — unavailable") {
        ImpersonationBanner(status: .unavailable)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ImpersonationBanner(isLoading: true)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ImpersonationBanner(errorMessage: "The impersonation status request timed out")
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ImpersonationBanner(
            status: .active(ImpersonationBannerPreviewData.subject(inSeconds: 18 * 60)),
            connection: .stale,
            now: { ImpersonationBannerPreviewData.now }
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ImpersonationBanner(
            status: .active(ImpersonationBannerPreviewData.subject(inSeconds: 18 * 60)),
            connection: .offline,
            now: { ImpersonationBannerPreviewData.now }
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
