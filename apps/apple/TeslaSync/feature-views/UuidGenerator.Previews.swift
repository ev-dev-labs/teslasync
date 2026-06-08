//
//  UuidGenerator.Previews.swift
//  TeslaSync — P4 feature view · 0024 · UuidGenerator (Apple)
//
//  Xcode previews for each surface state (empty + content). DEBUG-only; skipped
//  by the swiftc host gate.
//

import SwiftUI

#if DEBUG
    /// Deterministic generator so the content preview is stable across renders.
    private final class SequenceUuidGenerator: UuidGenerating, @unchecked Sendable {
        private let values: [String]
        private var index = 0

        init(_ values: [String]) {
            self.values = values
        }

        func next() -> String {
            defer { index += 1 }
            return values[index % values.count]
        }
    }

    @MainActor
    private func contentModel() -> UuidGeneratorModel {
        let generator = SequenceUuidGenerator([
            "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            "9c5b94b1-35ad-49bb-b118-8e8fc24abf80",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
        ])
        let model = UuidGeneratorModel(generator: generator)
        model.generate()
        model.generate()
        model.generate()
        return model
    }

    #Preview("Empty") {
        UuidGeneratorView()
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        UuidGeneratorView(model: contentModel())
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }
#endif
