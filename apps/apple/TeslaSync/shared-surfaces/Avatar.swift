//
//  Avatar.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  The shared Avatar primitive — the SwiftUI parity of `components/data-display/Avatar.tsx`. The
//  web component renders, in priority order, a remote image (falling back to initials/glyph on
//  load error), deterministic 2-letter initials on a hashed colour disc, or a generic glyph
//  (person for `user`, the Helix brand mark for `bot`), with an optional corner presence dot and
//  an optional tooltip. This surface reproduces that composition and every render branch, binding
//  through `AvatarModel` (P1/S8); no networking lives in the view beyond the platform image load.
//
//  States (every one renders — no hidden / blank surface):
//    • image loading  — remote `src` in flight → the deterministic fallback disc shows beneath.
//    • image loaded   — the remote image fills the disc, cross-fading in (Reduce-Motion aware).
//    • image failed   — load error → the fallback disc (web `onError` → initials/glyph).
//    • initials       — a name yields 2 initials on the hashed Okabe-Ito colour disc.
//    • glyph          — no name → the generic person / Helix glyph (attributed or neutral disc).
//    • presence       — the optional online/idle/offline corner dot, spoken as the a11y value.
//

import SwiftUI

// MARK: - Avatar (the shared surface)

/// The shared Avatar primitive — the SwiftUI parity of `components/data-display/Avatar.tsx`.
/// Renders every visual branch from the web source, binding through `AvatarModel`.
public struct Avatar: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AvatarMeta.surfaceSlug

    @State private var model: AvatarModel

    public init(model: AvatarModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production descriptor-backed source — the parity of
    /// mounting `<Avatar … />` with its props.
    public init(_ descriptor: AvatarDescriptor) {
        _model = State(initialValue: AvatarModel(source: LiveAvatarSource(descriptor: descriptor)))
    }

    /// Convenience initializer matching the web `AvatarProps` field-for-field, so call sites read
    /// like the web component (`Avatar(name: "Ada Lovelace", status: .online)`).
    public init(
        userId: String? = nil,
        name: String? = nil,
        src: String? = nil,
        size: AvatarSize = .sm,
        shape: AvatarShape = .circle,
        status: AvatarStatus? = nil,
        showTooltip: Bool = false,
        kind: AvatarKind = .user
    ) {
        self.init(AvatarDescriptor(
            userId: userId,
            name: name,
            src: src,
            size: size,
            shape: shape,
            status: status,
            showTooltip: showTooltip,
            kind: kind
        ))
    }

    public var body: some View {
        AvatarContent(
            resolved: model.resolved,
            src: model.descriptor.src,
            identity: model.identityLabel,
            presence: model.presenceLabel,
            tooltip: model.tooltipLabel
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}
