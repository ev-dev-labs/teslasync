//
//  BackendTool.Previews.swift
//  TeslaSync — P4 feature view · 0002 · BackendTool (Apple)
//
//  Xcode previews for each surface state (empty / loading / success / error /
//  stale / offline / with-extra). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

#if DEBUG
    import Foundation
    import SwiftUI

    @MainActor private let previewDescriptor = BackendToolDescriptor(
        systemImage: "wrench.and.screwdriver.fill",
        tone: .accent,
        title: "Reset signal cache",
        description: "Clears the in-memory live-signal store for all vehicles.",
        endpoint: "reset-signal-cache",
        method: .post
    )

    private let previewJSON = "{\"cleared\":true,\"vehicles\":3,\"freed_bytes\":18432}"

    /// A clock that returns a base time on its first read (the run's `completedAt`)
    /// and an advanced time afterwards, so the freshness-window preview renders the
    /// stale state deterministically.
    private final class BackendToolPreviewClock: @unchecked Sendable {
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
        outcome: BackendToolRunOutcome? = nil,
        autoResponds: Bool = true,
        run: Bool = false,
        thenPush: [BackendToolRunOutcome] = [],
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 30
    ) -> BackendToolModel {
        let runner = InMemoryBackendToolRunner(outcome: outcome, autoResponds: autoResponds)
        let model = BackendToolModel(runner: runner, now: now, stalenessWindow: stalenessWindow)
        model.start()
        if run { model.run() }
        for extra in thenPush {
            runner.push(extra)
        }
        return model
    }

    @MainActor
    private func stalePreviewModel() -> BackendToolModel {
        let clock = BackendToolPreviewClock(advance: 120)
        return previewModel(
            outcome: .success(json: previewJSON),
            run: true,
            now: { clock.now() },
            stalenessWindow: 30
        )
    }

    #Preview("Empty (idle)") {
        BackendTool(descriptor: previewDescriptor, model: previewModel())
            .frame(width: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BackendTool(descriptor: previewDescriptor, model: previewModel(autoResponds: false, run: true))
            .frame(width: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Success") {
        BackendTool(
            descriptor: previewDescriptor,
            model: previewModel(outcome: .success(json: previewJSON), run: true)
        )
        .frame(width: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        BackendTool(
            descriptor: previewDescriptor,
            model: previewModel(outcome: .failure(message: "404 — endpoint not found"), run: true)
        )
        .frame(width: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BackendTool(descriptor: previewDescriptor, model: stalePreviewModel())
            .frame(width: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BackendTool(
            descriptor: previewDescriptor,
            model: previewModel(
                outcome: .success(json: previewJSON),
                run: true,
                thenPush: [.offline(message: "Network unavailable")]
            )
        )
        .frame(width: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("With extra controls") {
        BackendTool(
            descriptor: previewDescriptor,
            model: previewModel(outcome: .success(json: previewJSON), run: true)
        ) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "car.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: "vin: 5YJ3…AF21")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(width: 340)
        .padding()
        .background(Color.TS.bg)
    }
#endif
