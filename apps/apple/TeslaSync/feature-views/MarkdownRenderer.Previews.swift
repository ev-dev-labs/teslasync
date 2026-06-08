//
//  MarkdownRenderer.Previews.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (rich rendered content, the preparing /
//  skeleton loading fallbacks, empty, error, and the stale / offline freshness envelope), so the chatbot
//  markdown renderer can be eyeballed in Xcode without the live message stream.
//

#if DEBUG
    import SwiftUI

    private enum MarkdownRendererPreviewData {
        /// A rich assistant reply exercising every renderer: headings, emphasis, inline + fenced code, a
        /// link, a bullet list with gfm task items, a blockquote, a gfm table, and a bare autolink.
        static let rich = """
        # Battery Report

        Your **Model 3** charged to *80%* with `regen` enabled — see the [owner's guide](https://tesla.com).

        - Range added: 240 km
        - [x] Precondition complete
        - [ ] Schedule the next charge

        ```swift
        let soc = battery.stateOfCharge
        print("charged to \\(soc)%")
        ```

        > Tip: charge to 90% before a long trip.

        | Metric | Value |
        | :-- | --: |
        | Efficiency | 152 Wh/km |
        | Odometer | 12,418 km |

        More at https://teslasync.io today.
        """

        @MainActor
        static func model(_ update: MarkdownRendererUpdate) -> MarkdownRendererModel {
            MarkdownRendererModel(
                source: InMemoryMarkdownRendererSource(initial: update),
                pasteboard: InMemoryMarkdownPasteboard(),
                copy: .fallback
            )
        }

        static func ready(
            _ markdown: String = rich,
            connection: MarkdownConnection = .live
        ) -> MarkdownRendererUpdate {
            MarkdownRendererUpdate(content: .ready(markdown), connection: connection, updatedAt: Date())
        }
    }

    private struct MarkdownRendererPreviewStage: View {
        let model: MarkdownRendererModel

        var body: some View {
            ScrollView {
                MarkdownRenderer(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Ready (rich)") {
        MarkdownRendererPreviewStage(model: MarkdownRendererPreviewData.model(MarkdownRendererPreviewData.ready()))
    }

    #Preview("Loading (preparing)") {
        MarkdownRendererPreviewStage(
            model: MarkdownRendererPreviewData.model(
                MarkdownRendererUpdate(content: .preparing(MarkdownRendererPreviewData.rich))
            )
        )
    }

    #Preview("Loading (skeleton)") {
        MarkdownRendererPreviewStage(
            model: MarkdownRendererPreviewData.model(MarkdownRendererUpdate(content: .idle))
        )
    }

    #Preview("Empty") {
        MarkdownRendererPreviewStage(model: MarkdownRendererPreviewData.model(MarkdownRendererPreviewData.ready("")))
    }

    #Preview("Error") {
        MarkdownRendererPreviewStage(
            model: MarkdownRendererPreviewData.model(
                MarkdownRendererUpdate(content: .failed("The message couldn't be loaded"))
            )
        )
    }

    #Preview("Stale") {
        MarkdownRendererPreviewStage(
            model: MarkdownRendererPreviewData.model(MarkdownRendererPreviewData.ready(connection: .stale))
        )
    }

    #Preview("Offline") {
        MarkdownRendererPreviewStage(
            model: MarkdownRendererPreviewData.model(MarkdownRendererPreviewData.ready(connection: .offline))
        )
    }
#endif
