//
//  RequiresAuth.Previews.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  Xcode previews — one per state the surface produces: unlocked (forward-auth + capability → the
//  protected section mounts), locked (open mode, generic provider list), locked with an operator
//  `provider_hint` (verbatim), loading (initial contract poll), error (poll failed → retry), and the
//  stale / offline freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentRequiresAuthTelemetry: RequiresAuthTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum RequiresAuthPreviewData {
        static func forwardAuth(
            providerHint: String? = "authentik",
            capabilities: AuthModeCapabilities = .allEnabled
        ) -> AuthModeSnapshot {
            AuthModeSnapshot(
                mode: .forwardAuth,
                subjectHeader: "X-Forwarded-User",
                subject: "alice",
                providerHint: providerHint,
                capabilities: capabilities
            )
        }

        static func update(
            status: RequiresAuthLoadStatus = .loaded,
            connection: RequiresAuthConnection = .live,
            snapshot: AuthModeSnapshot?
        ) -> RequiresAuthUpdate {
            RequiresAuthUpdate(status: status, snapshot: snapshot, connection: connection)
        }
    }

    @MainActor
    private func requiresAuthPreview(
        capability: RequiresAuthCapability = .totpEnrollment,
        feature: String = "TOTP enrollment",
        update: RequiresAuthUpdate
    ) -> some View {
        RequiresAuth(
            capability: capability,
            feature: feature,
            source: InMemoryRequiresAuthSource(initial: update),
            telemetry: SilentRequiresAuthTelemetry()
        ) {
            RequiresAuthPreviewProtectedSection()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.bg)
    }

    /// A stand-in for the wrapped section so the unlocked preview shows the children mounting.
    private struct RequiresAuthPreviewProtectedSection: View {
        var body: some View {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusSuccess)
                Text(verbatim: "Protected section content")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .frame(maxWidth: .infinity, minHeight: 160)
            .background(
                Color.TS.surface.opacity(0.40),
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
        }
    }

    #Preview("Unlocked · forward-auth") {
        requiresAuthPreview(
            update: RequiresAuthPreviewData.update(snapshot: RequiresAuthPreviewData.forwardAuth())
        )
    }

    #Preview("Locked · open mode") {
        requiresAuthPreview(update: RequiresAuthPreviewData.update(snapshot: .open))
    }

    #Preview("Locked · provider hint") {
        requiresAuthPreview(
            capability: .rbac,
            feature: "Role-based access control",
            update: RequiresAuthPreviewData.update(
                snapshot: RequiresAuthPreviewData.forwardAuth(
                    providerHint: "Authelia",
                    capabilities: .allDisabled
                )
            )
        )
    }

    #Preview("Loading") {
        requiresAuthPreview(
            update: RequiresAuthPreviewData.update(status: .loading, snapshot: nil)
        )
    }

    #Preview("Error") {
        requiresAuthPreview(
            update: RequiresAuthPreviewData.update(status: .failed("Service Unavailable"), snapshot: nil)
        )
    }

    #Preview("Stale") {
        requiresAuthPreview(
            update: RequiresAuthPreviewData.update(connection: .stale, snapshot: .open)
        )
    }

    #Preview("Offline") {
        requiresAuthPreview(
            update: RequiresAuthPreviewData.update(connection: .offline, snapshot: .open)
        )
    }
#endif
