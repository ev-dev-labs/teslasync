//
//  CodeBlock.Previews.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  Xcode previews for each surface state (content / no-language / long-line / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum CodeBlockPreviewData {
        static let swift = """
        func greet(_ name: String) -> String {
            "Hello, \\(name)!"
        }
        """

        static let shell = "docker compose up -d teslasync-api timescaledb redis mosquitto"

        static let long = """
        let url = URL(string: "https://teslasync.local/api/v1/vehicles/1/state?include=drive,charge,climate")!
        """

        static func ready(_ snapshot: CodeBlockSnapshot, _ connection: CodeBlockConnection = .live) -> CodeBlockUpdate {
            CodeBlockUpdate(content: .ready(snapshot), connection: connection, updatedAt: Date())
        }
    }

    @MainActor
    private func previewModel(_ update: CodeBlockUpdate) -> CodeBlockModel {
        let source = InMemoryCodeBlockSource(initial: update)
        let model = CodeBlockModel(source: source, pasteboard: InMemoryCodeBlockPasteboard())
        model.start()
        return model
    }

    #Preview("Content · swift") {
        CodeBlock(model: previewModel(CodeBlockPreviewData.ready(
            CodeBlockSnapshot(language: "swift", text: CodeBlockPreviewData.swift)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No language") {
        CodeBlock(model: previewModel(CodeBlockPreviewData.ready(
            CodeBlockSnapshot(language: nil, text: CodeBlockPreviewData.shell)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Long line · scrolls") {
        CodeBlock(model: previewModel(CodeBlockPreviewData.ready(
            CodeBlockSnapshot(language: "ts", text: CodeBlockPreviewData.long)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        CodeBlock(model: previewModel(CodeBlockPreviewData.ready(
            CodeBlockSnapshot(language: "bash", text: "   \n")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CodeBlock(model: previewModel(CodeBlockUpdate(content: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        CodeBlock(model: previewModel(CodeBlockUpdate(content: .failed("Network request timed out"))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        CodeBlock(model: previewModel(CodeBlockPreviewData.ready(
            CodeBlockSnapshot(language: "go", text: "fmt.Println(\"stale cache\")"), .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        CodeBlock(model: previewModel(CodeBlockPreviewData.ready(
            CodeBlockSnapshot(language: "go", text: "fmt.Println(\"offline cache\")"), .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
