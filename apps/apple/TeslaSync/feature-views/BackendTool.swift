//
//  BackendTool.swift
//  TeslaSync — P4 feature view · 0002 · BackendTool (Apple)
//
//  The composable BackendTool feature view — the SwiftUI parity of
//  features/admin/components/devtools/BackendTool.tsx. A reusable dev-tool card
//  that fires a single dev-tools endpoint (web `useMutation`) and renders every
//  state (idle / loading / success / error / stale / offline) through
//  `BackendToolModel` (P1/S8). No networking lives here.
//

import SwiftUI

// MARK: - Descriptor (web `BackendToolProps`)

/// The static presentation + request inputs for a dev tool, mirroring the web
/// `BackendToolProps` (icon, color, title, description, endpoint, method). `title`
/// and `description` are caller-resolved display strings (rendered verbatim, exactly
/// as the web `ToolCard` renders its props).
public struct BackendToolDescriptor: Equatable {
    public var systemImage: String
    public var tone: TSTone
    public var title: String
    public var description: String
    public var endpoint: String
    public var method: BackendToolMethod

    public init(
        systemImage: String,
        tone: TSTone,
        title: String,
        description: String,
        endpoint: String,
        method: BackendToolMethod = .get
    ) {
        self.systemImage = systemImage
        self.tone = tone
        self.title = title
        self.description = description
        self.endpoint = endpoint
        self.method = method
    }
}

// MARK: - BackendTool (the feature surface)

/// The composable BackendTool surface — the SwiftUI parity of
/// `features/admin/components/devtools/BackendTool.tsx`. Renders the tool card
/// (web `ToolCard`), an optional caller `extra` slot (web `children`), the Run
/// action with its run-status badge, and the result panel (web `ResultPanel`),
/// binding through `BackendToolModel`. Emits the P1/S11 `view.opened` event.
public struct BackendTool<Extra: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        BackendToolSurface.slug
    }

    private let descriptor: BackendToolDescriptor
    @State private var model: BackendToolModel
    private let extra: () -> Extra

    public init(
        descriptor: BackendToolDescriptor,
        model: BackendToolModel,
        @ViewBuilder extra: @escaping () -> Extra
    ) {
        self.descriptor = descriptor
        _model = State(initialValue: model)
        self.extra = extra
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                BackendToolHeader(
                    descriptor: descriptor,
                    connection: model.connection,
                    showsFreshness: model.showsStatusBadge
                )
                extra()
                BackendToolActionRow(
                    title: descriptor.title,
                    phase: model.phase,
                    status: BackendToolStatus.project(phase: model.phase),
                    onRun: { model.run() }
                )
                BackendToolResultPanel(
                    title: descriptor.title,
                    phase: model.phase,
                    result: model.result,
                    connection: model.connection,
                    onRetry: { model.run() }
                )
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - No-extra convenience

public extension BackendTool where Extra == EmptyView {
    /// A BackendTool with no caller `extra` slot (web component with no `children`).
    init(descriptor: BackendToolDescriptor, model: BackendToolModel) {
        self.init(descriptor: descriptor, model: model) { EmptyView() }
    }
}
