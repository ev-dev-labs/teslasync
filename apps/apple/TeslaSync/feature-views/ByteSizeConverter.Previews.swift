//
//  ByteSizeConverter.Previews.swift
//  TeslaSync — P4 feature view · 0012 · ByteSizeConverter (Apple)
//
//  Xcode previews for each surface branch (parseable value across several units /
//  unparseable hint). DEBUG-only; skipped by the host compile + format gates.
//

import SwiftUI

#if DEBUG
    #Preview("Bytes (1024)") {
        ByteSizeConverter(model: ByteSizeConverterModel(value: "1024", unit: .bytes))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Kilobytes (1024)") {
        ByteSizeConverter(model: ByteSizeConverterModel(value: "1024", unit: .kilobytes))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Gigabytes (2.5)") {
        ByteSizeConverter(model: ByteSizeConverterModel(value: "2.5", unit: .gigabytes))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Empty (no value)") {
        ByteSizeConverter(model: ByteSizeConverterModel(value: "", unit: .bytes))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }
#endif
