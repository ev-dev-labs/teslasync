//
//  UrlEncoder.Previews.swift
//  TeslaSync — P4 feature view · 0023 · UrlEncoder (Apple)
//
//  Xcode previews for each surface state (empty / encoded / decode-mode / invalid).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(mode: UrlEncoderMode = .encode, input: String = "") -> UrlEncoderModel {
        UrlEncoderModel(mode: mode, input: input)
    }

    #Preview("Empty (encode)") {
        UrlEncoderView(model: previewModel())
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Encoded") {
        UrlEncoderView(model: previewModel(mode: .encode, input: "hello world&foo=bar"))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Decode") {
        UrlEncoderView(model: previewModel(mode: .decode, input: "hello%20world%26foo%3Dbar"))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Invalid input") {
        UrlEncoderView(model: previewModel(mode: .decode, input: "%zz%"))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }
#endif
