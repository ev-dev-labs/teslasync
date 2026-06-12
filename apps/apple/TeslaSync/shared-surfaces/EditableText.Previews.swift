//
//  EditableText.Previews.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  Xcode previews for each surface state (display-populated body + heading, display-empty with a
//  prompt, display-empty "Not set", disabled, save-failure, loading, error, stale, offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum EditableTextFieldPreviewData {
        static let label = "Rename geofence Home"

        static func input(
            value: String,
            prompt: String? = nil,
            variant: EditableTextFieldVariant = .body,
            isDisabled: Bool = false,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: EditableTextFieldConnection = .live
        ) -> EditableTextFieldInput {
            EditableTextFieldInput(
                value: value,
                ariaLabel: label,
                prompt: prompt,
                variant: variant,
                isDisabled: isDisabled,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }
    }

    @MainActor
    private func editableTextFieldPreviewModel(
        _ input: EditableTextFieldInput,
        saveError: Error? = nil
    ) -> EditableTextFieldModel {
        let source = InMemoryEditableTextFieldSource(initial: input)
        source.echoSavedValue = true
        source.saveError = saveError
        let model = EditableTextFieldModel(source: source)
        model.start()
        return model
    }

    #Preview("Display · Populated (body)") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "Home")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Display · Populated (heading)") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "Garage", variant: .heading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Display · Empty (prompt)") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "", prompt: "Untitled location")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Display · Empty (Not set)") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Disabled") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "Locked name", isDisabled: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Save failure") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "Home"),
            saveError: EditableTextFieldSaveError("That name is already taken")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "", isLoading: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "", errorMessage: "The settings request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "Home", connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EditableTextField(model: editableTextFieldPreviewModel(
            EditableTextFieldPreviewData.input(value: "Home", connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
