//
//  TimeMachineBanner.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  The historical "viewing data as of …" banner surface — the SwiftUI parity of
//  `components/feedback/TimeMachineBanner.tsx`. The web component renders a sticky `info` banner
//  whenever the SPA is in time-machine mode (the `?as_of=` URL parameter is set), with an inline
//  date-time picker to reveal and change the historical anchor; the native surface is the device
//  analogue, binding through `TimeMachineBannerModel` (P1/S8). No URL / persistence lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the initial as-of resolution in flight → skeleton banner chrome.
//    • empty   — live mode with the picker closed (web `effective == null && !pickerOpen` → `null`) →
//                a calm "viewing live data" card with a "Pick a date" affordance, never a blank box.
//    • error   — the as-of feed failed → a retryable error tile (web `QueryError` peer).
//    • data    — time-machine active (or the picker open): the info banner with the formatted anchor,
//                the read-only note, the "Pick a date" toggle, "Return to live", and the inline picker.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the surface with a
//                one-shot auto-refresh (re-read) on the stale transition.
//
//  Mounting parity: the web banner sits at the top of `<Layout>`, above the service-status banner.
//  The app mounts `TimeMachineBanner(model: .live())` in the same position.
//

import SwiftUI

// MARK: - TimeMachineBanner (the shared surface)

/// The historical-viewing banner — the SwiftUI parity of `TimeMachineBanner.tsx`. Renders every state
/// plus the P4 leaf connectivity states, binding through `TimeMachineBannerModel`.
public struct TimeMachineBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — re-exposed from the model so app callers can
    /// reference `TimeMachineBanner.surfaceSlug` while the canonical value lives in the pure core.
    public static let surfaceSlug = TimeMachineBannerModel.surfaceSlug

    @State private var model: TimeMachineBannerModel

    public init(model: TimeMachineBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled / preview / test usage — the native parity of the web
    /// `testHookAsOf` + `testHookPickerOpen` seams. The supplied anchor + picker flag drive the
    /// rendered state without touching persistence; production mounts `TimeMachineBanner(model: .live())`.
    public init(
        asOf: Date? = nil,
        pickerOpen: Bool = false,
        connection: TimeMachineConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        telemetry: any TimeMachineBannerTelemetry = OSLogTimeMachineBannerTelemetry()
    ) {
        let source = InMemoryTimeMachineBannerSource(initial: TimeMachineInput(
            asOf: asOf,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        ))
        _model = State(initialValue: TimeMachineBannerModel(
            source: source,
            telemetry: telemetry,
            pickerOpen: pickerOpen
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                TimeMachineFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TimeMachineLoadingView()
        case .empty:
            TimeMachineEmptyView { model.openPicker() }
        case let .error(message):
            TimeMachineErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.resolved.data {
                TimeMachineBannerCard(
                    data: data,
                    pickerOpen: model.pickerOpen,
                    onTogglePicker: { model.togglePicker() },
                    onReturnToLive: { model.returnToLive() },
                    onSubmit: { model.submit($0) },
                    onCancelPicker: { model.closePicker() }
                )
            }
        }
    }
}
