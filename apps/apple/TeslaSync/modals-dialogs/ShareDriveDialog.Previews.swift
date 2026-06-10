//
//  ShareDriveDialog.Previews.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  Xcode previews — one per state the surface produces: the create form (no links yet), the populated
//  links list, the success result panel, the create-pending button, loading (initial fetch), error
//  (list failed → retry), and the stale / offline freshness variants. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentShareDriveTelemetry: ShareDriveTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op clipboard so previews don't touch the pasteboard.
    private struct SilentShareDriveClipboard: ShareDriveClipboard {
        func copy(_: String) {}
    }

    /// A controller that resolves create immediately with a fixed token (for the result panel) and
    /// echoes revoke success, without a network call.
    @MainActor
    private final class PreviewShareDriveController: ShareDriveController {
        var onCreateResult: (@MainActor (ShareCreateOutcome) -> Void)?
        var onRevokeResult: (@MainActor (ShareRevokeOutcome) -> Void)?
        func create(input _: CreateShareInput, driveId _: String) {
            onCreateResult?(.success(token: "previewtoken"))
        }

        func revoke(token: String) {
            onRevokeResult?(.success(token: token))
        }
    }

    /// A controller that records create/revoke but never resolves, so previews can show the pending
    /// (spinner) states.
    @MainActor
    private final class DeferringShareDriveController: ShareDriveController {
        var onCreateResult: (@MainActor (ShareCreateOutcome) -> Void)?
        var onRevokeResult: (@MainActor (ShareRevokeOutcome) -> Void)?
        func create(input _: CreateShareInput, driveId _: String) {}
        func revoke(token _: String) {}
    }

    private enum ShareDrivePreviewData {
        /// A fixed clock so the preview rows' expiry status is deterministic.
        static let now = Date(timeIntervalSince1970: 1_781_049_600)

        static var links: [ShareLink] {
            [
                ShareLink(
                    id: 1,
                    token: "sf2la",
                    title: "SF to LA Road Trip",
                    views: 128,
                    expiresAt: now.addingTimeInterval(20 * 86400)
                ),
                ShareLink(
                    id: 2,
                    token: "expired1",
                    title: nil,
                    views: 3,
                    expiresAt: now.addingTimeInterval(-2 * 86400)
                ),
                ShareLink(id: 3, token: "commute", title: "Daily commute", views: 0, expiresAt: nil)
            ]
        }

        static func update(
            status: ShareLinksLoadStatus = .loaded,
            links: [ShareLink] = [],
            connection: ShareDriveConnection = .live
        ) -> ShareDriveUpdate {
            ShareDriveUpdate(status: status, links: links, connection: connection)
        }
    }

    @MainActor
    private func sharePreview(
        _ update: ShareDriveUpdate,
        controller: any ShareDriveController = PreviewShareDriveController(),
        configure: (ShareDriveModel) -> Void = { _ in }
    ) -> ShareDriveDialog {
        let model = ShareDriveModel(
            driveId: "42",
            source: InMemoryShareDriveSource(initial: update),
            telemetry: SilentShareDriveTelemetry(),
            controller: controller,
            clipboard: SilentShareDriveClipboard(),
            urlBuilder: DefaultShareDriveURLBuilder(origin: "https://app.teslasync.io"),
            dates: DefaultShareDriveDateFormatting(
                timeZone: TimeZone(identifier: "UTC") ?? .current,
                locale: Locale(identifier: "en_US")
            ),
            now: { ShareDrivePreviewData.now }
        )
        configure(model)
        return ShareDriveDialog(model: model)
    }

    #Preview("Create") {
        sharePreview(ShareDrivePreviewData.update())
    }

    #Preview("Create — filled") {
        sharePreview(ShareDrivePreviewData.update()) { model in
            model.title = "SF to LA Road Trip"
            model.includeTelemetry = true
            model.expiry = .days90
        }
    }

    #Preview("Links") {
        sharePreview(ShareDrivePreviewData.update(links: ShareDrivePreviewData.links))
    }

    #Preview("Result") {
        sharePreview(ShareDrivePreviewData.update(links: ShareDrivePreviewData.links)) { $0.generate() }
    }

    #Preview("Creating") {
        sharePreview(ShareDrivePreviewData.update(), controller: DeferringShareDriveController()) { $0.generate() }
    }

    #Preview("Loading") {
        sharePreview(ShareDrivePreviewData.update(status: .loading))
    }

    #Preview("Error") {
        sharePreview(ShareDrivePreviewData.update(status: .failed("Couldn't reach the server")))
    }

    #Preview("Stale") {
        sharePreview(ShareDrivePreviewData.update(links: ShareDrivePreviewData.links, connection: .stale))
    }

    #Preview("Offline") {
        sharePreview(ShareDrivePreviewData.update(links: ShareDrivePreviewData.links, connection: .offline))
    }
#endif
