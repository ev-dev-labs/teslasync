//
//  VinDecoder.Previews.swift
//  TeslaSync — P4 feature view · 0025 · VinDecoder (Apple)
//
//  Xcode previews for each render branch (no-result / decoded / all-unknown).
//  DEBUG-only; skipped by the host compile + format gates (the `#Preview` macro
//  requires the Xcode previews plugin).
//

import Foundation
import SwiftUI

#if DEBUG
    /// A full Model 3 VIN that resolves every reference table (Fremont, 2022).
    private let vinDecoderSampleVin = "5YJ3E1EA1NF000001"

    /// A long-enough VIN whose positions miss every table, so all five lookups
    /// render the localized "Unknown" while the serial still resolves.
    private let vinDecoderUnknownVin = "ZZZ9Z9Z9Z9Z999999"

    #Preview("No result") {
        ScrollView {
            VinDecoderView(model: VinDecoderModel())
                .padding()
        }
        .frame(width: 440, height: 360)
        .background(Color.TS.bg)
    }

    #Preview("Decoded") {
        ScrollView {
            VinDecoderView(model: VinDecoderModel(input: vinDecoderSampleVin))
                .padding()
        }
        .frame(width: 440, height: 560)
        .background(Color.TS.bg)
    }

    #Preview("All unknown") {
        ScrollView {
            VinDecoderView(model: VinDecoderModel(input: vinDecoderUnknownVin))
                .padding()
        }
        .frame(width: 440, height: 560)
        .background(Color.TS.bg)
    }
#endif
