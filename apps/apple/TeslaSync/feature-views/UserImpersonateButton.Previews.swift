//
//  UserImpersonateButton.Previews.swift
//  TeslaSync — P4 feature view · 0050 · UserImpersonateButton (Apple)
//
//  Xcode previews for each surface state (loading / unavailable-openMode /
//  already-active / disabled / error / idle / confirming / starting / started /
//  failed / stale / offline). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

#if DEBUG
    import Foundation
    import SwiftUI

    private let previewSubject = "subject-7f3a"

    /// A clock that returns a base time on its first read (the status `lastStatusAt`)
    /// and an advanced time afterwards, so the freshness-window preview renders the
    /// stale state deterministically.
    private final class ImpersonatePreviewClock: @unchecked Sendable {
        private let base = Date()
        private let advance: TimeInterval
        private var reads = 0

        init(advance: TimeInterval) {
            self.advance = advance
        }

        func now() -> Date {
            defer { reads += 1 }
            return reads == 0 ? base : base.addingTimeInterval(advance)
        }
    }

    @MainActor
    private func previewModel(
        subject: String = previewSubject,
        disabled: Bool = false,
        status: ImpersonationStatusEvent? = .loaded(ImpersonationStatus(mode: .restricted)),
        statusAutoEmits: Bool = true,
        start: ImpersonationStartOutcome? = nil,
        startAutoResponds: Bool = true,
        thenStatus: [ImpersonationStatusEvent] = [],
        request: Bool = false,
        confirm: Bool = false,
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 60
    ) -> UserImpersonateButtonModel {
        let provider = InMemoryImpersonationStatusProvider(initial: status, autoEmits: statusAutoEmits)
        let starter = InMemoryImpersonationStarter(outcome: start, autoResponds: startAutoResponds)
        let model = UserImpersonateButtonModel(
            subject: subject,
            disabledByParent: disabled,
            statusProvider: provider,
            starter: starter,
            now: now,
            stalenessWindow: stalenessWindow
        )
        model.start()
        for event in thenStatus {
            provider.push(event)
        }
        if request { model.requestStart() }
        if confirm { model.confirmStart() }
        return model
    }

    @MainActor
    private func stalePreviewModel() -> UserImpersonateButtonModel {
        let clock = ImpersonatePreviewClock(advance: 600)
        return previewModel(now: { clock.now() }, stalenessWindow: 60)
    }

    private func framed(_ view: some View) -> some View {
        view
            .frame(width: 300, alignment: .leading)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle (available)") {
        framed(UserImpersonateButton(model: previewModel()))
    }

    #Preview("Loading") {
        framed(UserImpersonateButton(model: previewModel(status: nil, statusAutoEmits: false)))
    }

    #Preview("Unavailable (open mode)") {
        framed(UserImpersonateButton(model: previewModel(status: .loaded(ImpersonationStatus(mode: .open)))))
    }

    #Preview("Already active") {
        framed(UserImpersonateButton(
            model: previewModel(status: .loaded(ImpersonationStatus(mode: .restricted, activeSubject: "subject-aa10")))
        ))
    }

    #Preview("Disabled (parent)") {
        framed(UserImpersonateButton(model: previewModel(disabled: true)))
    }

    #Preview("Status error") {
        framed(UserImpersonateButton(model: previewModel(status: .failed(message: "503 — status unavailable"))))
    }

    #Preview("Starting") {
        framed(UserImpersonateButton(
            model: previewModel(startAutoResponds: false, request: true, confirm: true)
        ))
    }

    #Preview("Started") {
        framed(UserImpersonateButton(
            model: previewModel(start: .started, request: true, confirm: true)
        ))
    }

    #Preview("Start failed") {
        framed(UserImpersonateButton(
            model: previewModel(start: .failed(message: "Reauthentication required"), request: true, confirm: true)
        ))
    }

    #Preview("Stale") {
        framed(UserImpersonateButton(model: stalePreviewModel()))
    }

    #Preview("Offline (cached)") {
        framed(UserImpersonateButton(
            model: previewModel(thenStatus: [.offline(message: "Network unavailable")])
        ))
    }
#endif
