//
//  JwtDecoder.Previews.swift
//  TeslaSync — P4 feature view · 0018 · JwtDecoder (Apple)
//
//  Xcode previews for each decode branch (idle / invalid / decoded). DEBUG-only;
//  skipped by the host compile + format gates (the `#Preview` macro requires the
//  Xcode previews plugin).
//

import Foundation
import SwiftUI

#if DEBUG
    /// The canonical jwt.io sample token used by the decoded preview + tests.
    private let jwtDecoderSampleToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            + ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ"
            + ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

    #Preview("Idle") {
        ScrollView {
            JwtDecoderView(model: JwtDecoderModel())
                .padding()
        }
        .frame(width: 440, height: 380)
        .background(Color.TS.bg)
    }

    #Preview("Decoded") {
        ScrollView {
            JwtDecoderView(model: JwtDecoderModel(input: jwtDecoderSampleToken))
                .padding()
        }
        .frame(width: 440, height: 560)
        .background(Color.TS.bg)
    }

    #Preview("Invalid") {
        ScrollView {
            JwtDecoderView(model: JwtDecoderModel(input: "not-a-valid.jwt"))
                .padding()
        }
        .frame(width: 440, height: 380)
        .background(Color.TS.bg)
    }
#endif
