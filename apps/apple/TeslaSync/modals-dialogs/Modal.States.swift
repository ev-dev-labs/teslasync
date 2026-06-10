//
//  Modal.States.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  The body router + non-content states the modal switches over. The web `Modal` renders its
//  `children` directly; the native body adds real chrome for every load state so the dialog never
//  shows a blank panel: a loading skeleton, a friendly empty state, an error envelope with retry,
//  plus the live-state freshness chip (header) and the connectivity banner (above the body). The
//  `.data` phase renders the caller-provided content (web `children`). Copy via P1/S10; chrome via
//  P1/S9 tokens.
//

import SwiftUI

// MARK: - Body router

/// The modal body: switches over the resolved phase so loading / empty / error each render real
/// chrome, and shows the caller content (web `children`) for `.data`.
struct ModalBody<DataContent: View>: View {
    let phase: ModalBodyPhase
    let connection: ModalConnection
    let onRetry: () -> Void
    @ViewBuilder let content: () -> DataContent

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if connection != .live {
                ModalConnectivityBanner(connection: connection)
            }
            switch phase {
            case .loading:
                ModalLoadingState()
            case .empty:
                ModalEmptyState()
            case let .error(message):
                ModalErrorState(message: message, onRetry: onRetry)
            case .data:
                content()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-load skeleton: redaction-free skeleton bars so the body doesn't reflow when content
/// resolves. A gentle opacity pulse runs unless Reduce Motion is on.
struct ModalLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            bar(width: 180, height: 14)
            bar(width: nil, height: 11)
            bar(width: nil, height: 11)
            bar(width: 220, height: 11)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(pulsing ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ModalStrings.string("modal.a11y.loading", "Loading")))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.18))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - Empty (no content)

/// The empty state (web `children` resolved to nothing) — a friendly `ContentUnavailableView` rather
/// than a blank box.
struct ModalEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ModalStrings.text("modal.empty.title", "Nothing to show")
            } icon: {
                Image(systemName: "tray")
            }
        } description: {
            ModalStrings.text("modal.empty.body", "There's nothing here yet.")
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web QueryError with retry)

/// The load-failure state with a retry affordance, never a blank box.
struct ModalErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            ModalStrings.text("modal.error.title", "Something went wrong")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            ModalStrings.text("modal.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ModalStrings.text("modal.retry", "Retry"))
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013). The live read needs
/// no chip; the header renders this only for the stale / offline reads.
struct ModalFreshnessChip: View {
    let connection: ModalConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            ModalStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ModalStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ModalConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "modal.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "modal.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "modal.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-body banner shown above the body when the bound source is not live, so the user knows
/// the content may be re-fetched once connectivity returns (ADR-013).
struct ModalConnectivityBanner: View {
    let connection: ModalConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "modal.offlineBanner" : "modal.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded data"
            : "Reconnecting — refreshing…"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ModalStrings.text(key, fallback)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension ModalStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so resolved copy is never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
