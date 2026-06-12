//
//  TagInput.Previews.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  Xcode previews for each surface state (ready-populated, ready-empty, at-cap, capped-with-count, with a
//  caller hint, lowercase, loading, error, stale, offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TagInputPreviewData {
        /// The documented canonical use — an alert-rule tag list.
        static let label = "Alert tags"

        static func snapshot(
            tags: [String] = [],
            maxTags: Int? = nil,
            lowercase: Bool = false,
            hint: String? = nil,
            disabled: Bool = false,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: TagInputConnection = .live
        ) -> TagInputSnapshot {
            TagInputSnapshot(
                tags: tags,
                label: label,
                maxTags: maxTags,
                separators: [.comma, .space],
                lowercase: lowercase,
                disabled: disabled,
                hint: hint,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }
    }

    @MainActor
    private func tagInputPreviewModel(
        _ snapshot: TagInputSnapshot,
        validate: ((String) -> String?)? = nil
    ) -> TagInputModel {
        let source = InMemoryTagInputSource(initial: snapshot)
        let model = TagInputModel(source: source, validate: validate)
        model.start()
        return model
    }

    #Preview("Ready · Populated") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["highway", "weekend", "supercharger"])
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Empty") {
        TagInput(model: tagInputPreviewModel(TagInputPreviewData.snapshot()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · Capped (2/3)") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["home", "work"], maxTags: 3)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · At cap (3/3)") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["home", "work", "trip"], maxTags: 3)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · With hint") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["model3"], hint: "Press return to add a tag")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Disabled") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["locked", "readonly"], disabled: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TagInput(model: tagInputPreviewModel(TagInputPreviewData.snapshot(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(errorMessage: "The settings request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["highway"], connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TagInput(model: tagInputPreviewModel(
            TagInputPreviewData.snapshot(tags: ["highway"], connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
