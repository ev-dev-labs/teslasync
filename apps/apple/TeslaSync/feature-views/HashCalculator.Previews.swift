//
//  HashCalculator.Previews.swift
//  TeslaSync — P4 feature view · 0015 · HashCalculator (Apple)
//
//  Xcode previews for each surface state (idle / ready / computing / result /
//  error). DEBUG-only; skipped by the swiftc host gate and the app build.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewSurface(
        input: String = "",
        phase: HashCalculatorModel.Phase = .idle
    ) -> some View {
        HashCalculatorView(model: HashCalculatorModel(input: input, phase: phase))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle (empty)") {
        previewSurface()
    }

    #Preview("Ready (typed)") {
        previewSurface(input: "TeslaSync fleet telemetry")
    }

    #Preview("Computing") {
        previewSurface(input: "TeslaSync fleet telemetry", phase: .computing)
    }

    #Preview("Result") {
        previewSurface(
            input: "The quick brown fox jumps over the lazy dog",
            phase: .result(HashCalculatorEngine.sha256Hex("The quick brown fox jumps over the lazy dog"))
        )
    }

    #Preview("Error") {
        previewSurface(input: "TeslaSync fleet telemetry", phase: .failed)
    }
#endif
