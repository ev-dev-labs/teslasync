//
//  LiveControls.Previews.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  Xcode previews for the toolbar + each P4 state (live / frozen / dual counter /
//  legacy single counter / empty / loading / error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: LiveControlsInput) -> LiveControlsModel {
        let source = InMemoryLiveControlsSource(initial: input)
        let model = LiveControlsModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewSurface(_ input: LiveControlsInput) -> some View {
        LiveControls(model: previewModel(input))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    /// Streaming, dual-scope counts, only step-previous available.
    private let liveState = LiveControlsState(
        isLive: true,
        windowMinutes: 10,
        canStepPrev: true,
        canStepNext: false,
        windowCount: 12,
        totalCount: 87
    )

    /// Frozen, stepping in both directions, dual-scope counts.
    private let frozenState = LiveControlsState(
        isLive: false,
        windowMinutes: 30,
        canStepPrev: true,
        canStepNext: true,
        windowCount: 12,
        totalCount: 87
    )

    /// Legacy single-scope fallback (web `bufferCount` only) → "{{n}} buffered".
    private let legacyState = LiveControlsState(
        isLive: true,
        windowMinutes: 5,
        canStepPrev: false,
        canStepNext: false,
        bufferCount: 34
    )

    /// Nothing buffered in either scope → the friendly empty counter.
    private let emptyState = LiveControlsState(
        isLive: true,
        windowMinutes: 10,
        windowCount: 0,
        totalCount: 0
    )

    #Preview("Live (dual counter)") {
        previewSurface(LiveControlsInput(phase: .loaded(liveState)))
    }

    #Preview("Frozen (stepping)") {
        previewSurface(LiveControlsInput(phase: .loaded(frozenState)))
    }

    #Preview("Legacy single counter") {
        previewSurface(LiveControlsInput(phase: .loaded(legacyState)))
    }

    #Preview("Empty (no transitions)") {
        previewSurface(LiveControlsInput(phase: .loaded(emptyState)))
    }

    #Preview("Loading") {
        previewSurface(LiveControlsInput(phase: .loading))
    }

    #Preview("Error") {
        previewSurface(LiveControlsInput(phase: .failed))
    }

    #Preview("Stale (auto-refresh)") {
        previewSurface(LiveControlsInput(phase: .loaded(liveState), isStale: true))
    }

    #Preview("Offline (cached)") {
        previewSurface(LiveControlsInput(phase: .loaded(frozenState), isOffline: true))
    }
#endif
