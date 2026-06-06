import AuthenticationServices
import Foundation
#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

/// The OS sign-in surface seam. Production uses `AppleAuthSession`
/// (`ASWebAuthenticationSession`); tests substitute a fake so the OIDC flow is
/// covered without a real browser.
public protocol AuthBrowsing: Sendable {
    /// Opens `url` in the system auth browser and resolves with the redirect URL,
    /// or throws `AuthError.cancelled` if the user dismisses the sheet.
    func authenticate(url: URL, callback: RedirectCallback, prefersEphemeral: Bool) async throws -> URL
}

/// `AuthBrowsing` over `ASWebAuthenticationSession` (ADR-008). Supports both the
/// HTTPS (Universal Link) callback and the custom-scheme fallback.
@MainActor
public final class AppleAuthSession: AuthBrowsing {
    private let anchorProvider = AuthPresentationAnchorProvider()

    public init() {}

    public func authenticate(url: URL, callback: RedirectCallback, prefersEphemeral: Bool) async throws -> URL {
        let asCallback: ASWebAuthenticationSession.Callback = switch callback {
        case let .universalLink(host, path):
            .https(host: host, path: path)
        case let .customScheme(scheme):
            .customScheme(scheme)
        }

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: asCallback) { callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: AppleAuthSession.mapError(error))
                }
            }
            session.presentationContextProvider = anchorProvider
            session.prefersEphemeralWebBrowserSession = prefersEphemeral
            if !session.start() {
                continuation.resume(throwing: AuthError.invalidAuthorizationURL)
            }
        }
    }

    static func mapError(_ error: Error?) -> AuthError {
        guard let error else {
            return .invalidRedirect("no callback URL returned")
        }
        if let sessionError = error as? ASWebAuthenticationSessionError, sessionError.code == .canceledLogin {
            return .cancelled
        }
        return .network(error.localizedDescription)
    }
}

/// Supplies the window `ASWebAuthenticationSession` anchors its sheet to. The
/// callback is delivered on the main thread by the framework, so accessing the
/// app's windows via `MainActor.assumeIsolated` is safe.
final class AuthPresentationAnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if os(macOS)
                return NSApplication.shared.keyWindow
                    ?? NSApplication.shared.windows.first
                    ?? ASPresentationAnchor()
            #else
                let scenes = UIApplication.shared.connectedScenes
                let active = scenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
                let windowScene = active ?? scenes.compactMap { $0 as? UIWindowScene }.first
                return windowScene?.keyWindow
                    ?? windowScene?.windows.first
                    ?? ASPresentationAnchor()
            #endif
        }
    }
}
