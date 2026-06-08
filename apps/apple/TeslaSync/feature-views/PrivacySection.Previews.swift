//
//  PrivacySection.Previews.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  Xcode previews for each surface state (content on/off · empty recents · each consent
//  decision · loading · error · stale · offline · confirmation sheet). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// No-op telemetry sink so previews don't emit diagnostics.
    private struct NoopPrivacyTelemetry: PrivacyTelemetry {
        func viewOpened(surface _: String) {}
    }

    @MainActor
    private func previewModel(
        status: PrivacyEnvironmentStatus = .loaded,
        freshness: PrivacyFreshness = .fresh,
        requireConsent: Bool = true,
        recent: Int = 12,
        consent: PrivacyConsentState = .unknown,
        silenced: Bool = false
    ) -> PrivacyModel {
        let environment = InMemoryPrivacyEnvironmentSource(
            initial: PrivacyEnvironmentUpdate(
                status: status,
                freshness: freshness,
                requireConsent: requireConsent,
                updatedAt: Date()
            )
        )
        let silenceStore = PrivacySectionInMemoryConfirmSilenceStore(
            silenced: silenced ? [PrivacyModel.confirmSilenceKey] : []
        )
        let model = PrivacyModel(
            environment: environment,
            recentPages: InMemoryRecentPagesStore(count: recent),
            consentStore: InMemoryConsentStore(state: consent),
            silenceStore: silenceStore,
            telemetry: NoopPrivacyTelemetry()
        )
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ section: PrivacySection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }

    #Preview("Consent required") {
        previewShell(PrivacySection(model: previewModel(requireConsent: true, consent: .unknown)))
    }

    #Preview("Consent accepted") {
        previewShell(PrivacySection(model: previewModel(requireConsent: true, consent: .accepted)))
    }

    #Preview("Consent declined") {
        previewShell(PrivacySection(model: previewModel(requireConsent: true, consent: .declined)))
    }

    #Preview("Preview-only (consent off)") {
        previewShell(PrivacySection(model: previewModel(requireConsent: false, consent: .unknown)))
    }

    #Preview("Empty recents") {
        previewShell(PrivacySection(model: previewModel(recent: 0, consent: .accepted)))
    }

    #Preview("Loading") {
        previewShell(PrivacySection(model: previewModel(status: .loading)))
    }

    #Preview("Error (cached)") {
        previewShell(
            PrivacySection(model: previewModel(status: .failed("HTTP 503"), requireConsent: true, consent: .declined))
        )
    }

    #Preview("Stale") {
        previewShell(PrivacySection(model: previewModel(freshness: .stale, consent: .accepted)))
    }

    #Preview("Offline (cached)") {
        previewShell(PrivacySection(model: previewModel(freshness: .offline, consent: .accepted)))
    }

    #Preview("Dynamic Type") {
        previewShell(PrivacySection(model: previewModel(consent: .accepted)))
            .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif
