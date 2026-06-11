//
//  CookieConsentBanner.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  The cookie / GDPR consent banner — the SwiftUI parity of `components/feedback/CookieConsentBanner.tsx`.
//  A non-blocking bottom-of-viewport card that appears ONLY when the deployment requires consent AND the
//  user has not yet decided (the web two-line `return null` guard), binding through `CookieConsentModel`
//  (P1/S8); no networking lives here.
//
//  States (faithful to the web source — every branch reproduced):
//    • dormant   — consent not required · already accepted · already declined · policy still loading
//                  (cold) / failed-with-no-cache → renders nothing, exactly as the web banner returns
//                  `null` (a non-blocking overlay is simply not presented, never a blank box).
//    • presented — required + decision `unknown` → the full card: shield header, GDPR body, the inline
//                  "Manage preferences" disclosure (two informed-consent cards + the "Always on" pill),
//                  and Accept all / Decline non-essential. No dismiss — dismissing is not consent.
//    • stale / offline / error (cached) — the P4 freshness axis: the cached `requireConsent` stays
//                  applied beneath a status chip (offline → error → stale precedence; retry refreshes).
//

import SwiftUI

// MARK: - CookieConsentBanner (the shared surface)

/// The cookie / GDPR consent banner. Renders the bottom-overlay card while presented and nothing while
/// dormant, binding through `CookieConsentModel`. Mount it with `.cookieConsentBanner(model:)` so it
/// floats above the content without occluding the layout.
public struct CookieConsentBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CookieConsentBanner"

    @State private var model: CookieConsentModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: CookieConsentModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer that builds the in-memory seams from plain values — the parity of the
    /// web parent mounting the banner with a known policy + stored decision. Production callers inject a
    /// model wired to the live `/system/version` + consent-store seams instead.
    public init(
        requireConsent: Bool,
        decision: ConsentDecision = .unknown,
        freshness: ConsentPolicyFreshness = .fresh
    ) {
        let policy = InMemoryConsentPolicySource(
            initial: ConsentPolicyUpdate(status: .loaded, freshness: freshness, requireConsent: requireConsent)
        )
        let store = InMemoryConsentDecisionStore(initial: decision)
        _model = State(initialValue: CookieConsentModel(policy: policy, store: store))
    }

    public var body: some View {
        bannerContent
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: model.isPresented)
    }

    @ViewBuilder
    private var bannerContent: some View {
        if model.isPresented {
            presentedCard
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
        } else {
            // Dormant: a zero-height anchor keeps the lifecycle stable (so the model keeps observing and
            // can flip to presented) while presenting nothing — the native parity of web `return null`.
            Color.clear
                .frame(height: 0)
                .accessibilityHidden(true)
        }
    }

    private var presentedCard: some View {
        CookieConsentCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                CookieConsentHeader()

                CookieConsentDisclosureToggle(expanded: model.showDetails) {
                    model.toggleDetails()
                }

                if model.showDetails {
                    CookieConsentCategoryList()
                }

                if let chip = model.resolved.statusChip {
                    CookieConsentStatusChipView(chip: chip) { model.refresh() }
                }

                CookieConsentActions(
                    onAccept: { model.choose(.accept) },
                    onDecline: { model.choose(.decline) }
                )
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.bottom, TSSpacing.md)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: CookieConsentAdapter.dialogLabel(localize: CookieConsentStrings.string))
        )
    }
}

// MARK: - Host modifier (web `<Layout>` bottom mount)

public extension View {
    /// Mounts the cookie-consent banner as a non-blocking bottom overlay over the content — the native
    /// parity of the web banner mounted in `<Layout>` at the bottom of the viewport. The overlay is
    /// inert while dormant (zero-height anchor) and interactive only when the card is presented.
    func cookieConsentBanner(model: CookieConsentModel) -> some View {
        overlay(alignment: .bottom) {
            CookieConsentBanner(model: model)
        }
    }
}
