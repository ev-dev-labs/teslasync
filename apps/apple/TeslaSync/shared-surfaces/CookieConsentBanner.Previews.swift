//
//  CookieConsentBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  Xcode previews for each surface branch (presented · details expanded · stale / offline / error
//  cached · the dormant branches · Dynamic Type). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope. The previews drive the in-memory seams — no network, no store.
//

import SwiftUI

#if DEBUG
    private enum CookieConsentPreviewData {
        @MainActor
        static func model(
            requireConsent: Bool = true,
            decision: ConsentDecision = .unknown,
            status: ConsentPolicyStatus = .loaded,
            freshness: ConsentPolicyFreshness = .fresh,
            showDetails: Bool = false
        ) -> CookieConsentModel {
            let policy = InMemoryConsentPolicySource(
                initial: ConsentPolicyUpdate(status: status, freshness: freshness, requireConsent: requireConsent)
            )
            let store = InMemoryConsentDecisionStore(initial: decision)
            let model = CookieConsentModel(policy: policy, store: store)
            model.start()
            if showDetails { model.toggleDetails() }
            return model
        }
    }

    /// Stand-in page content so the dormant previews show the banner is correctly absent over real UI.
    private struct CookieConsentPreviewStage: View {
        var body: some View {
            VStack(spacing: TSSpacing.md) {
                Image(systemName: "car.fill").font(.system(size: 40)).foregroundStyle(Color.TS.accent)
                Text(verbatim: "TeslaSync").font(Font.TS.title).foregroundStyle(Color.TS.textPrimary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
        }
    }

    #Preview("Presented") {
        CookieConsentBanner(model: CookieConsentPreviewData.model())
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Presented — details expanded") {
        CookieConsentBanner(model: CookieConsentPreviewData.model(showDetails: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        CookieConsentBanner(model: CookieConsentPreviewData.model(freshness: .stale))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        CookieConsentBanner(model: CookieConsentPreviewData.model(freshness: .offline))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error (cached)") {
        CookieConsentBanner(model: CookieConsentPreviewData.model(status: .failed("version request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Dormant — not required") {
        CookieConsentPreviewStage()
            .cookieConsentBanner(model: CookieConsentPreviewData.model(requireConsent: false))
    }

    #Preview("Dormant — already accepted") {
        CookieConsentPreviewStage()
            .cookieConsentBanner(model: CookieConsentPreviewData.model(decision: .accepted))
    }

    #Preview("Mounted over content") {
        CookieConsentPreviewStage()
            .cookieConsentBanner(model: CookieConsentPreviewData.model())
    }

    #Preview("Dynamic Type — accessibility XL") {
        CookieConsentBanner(model: CookieConsentPreviewData.model(showDetails: true))
            .padding()
            .background(Color.TS.bg)
            .environment(\.sizeCategory, .accessibilityExtraLarge)
    }
#endif
