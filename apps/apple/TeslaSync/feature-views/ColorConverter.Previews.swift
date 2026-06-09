//
//  ColorConverter.Previews.swift
//  TeslaSync — P4 feature view · 0013 · ColorConverter (Apple)
//
//  Xcode previews for each surface branch (parseable hex across a few colors /
//  the unparseable hint). DEBUG-only; skipped by the host compile + format gates.
//

import SwiftUI

#if DEBUG
    #Preview("Blue (#3b82f6)") {
        ColorConverter(model: ColorConverterModel(hex: "#3b82f6"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Emerald (#10b981)") {
        ColorConverter(model: ColorConverterModel(hex: "#10b981"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("White (#ffffff)") {
        ColorConverter(model: ColorConverterModel(hex: "#ffffff"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Empty (invalid hex)") {
        ColorConverter(model: ColorConverterModel(hex: "#xyz"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }
#endif
