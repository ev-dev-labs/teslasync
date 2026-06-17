//
//  MediaPlayerPageRouteRegistration.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/MediaPlayer (Apple) — Navigation
//
//  Navigation registration for the `MediaPlayerPage` parity unit. The web route
//  `/media-player` is modeled natively as a typed `NavigationDestination` value:
//  a host stack adopts `.mediaPlayerDestination()` and pushes a `MediaPlayerLink()`
//  to open the media screen, so the page is reachable + deep-linkable on the
//  macOS / iPad detail column and the iPhone stack (ADR-002/006). The global
//  `AppRoute` enum (Sources/App) is outside this prompt's allowed-files scope, so —
//  following the accepted sibling precedent (TirePressure / GuardMode / Geofences /
//  Safety) — the page is delivered as a NavigationStack-ready `View` plus this
//  typed destination, rather than editing the shared route host. The sidebar row
//  already exists (`nav("/media-player", "Media Player", "headphones")`).
//

import SwiftUI

/// The typed deep-link value for the media screen (web `/media-player`).
struct MediaPlayerLink: Hashable {}

extension View {
    /// Registers `MediaPlayerPage` as the `NavigationDestination` for a
    /// `MediaPlayerLink`, so any host stack can deep-link into the media screen
    /// (web `/media-player`).
    func mediaPlayerDestination() -> some View {
        navigationDestination(for: MediaPlayerLink.self) { _ in
            MediaPlayerPage()
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen without constructing the model.
enum MediaPlayerRouteRegistration {
    /// The web route this screen serves (`/media-player`).
    static let route = "/media-player"

    /// Builds the media screen (web `/media-player`).
    @MainActor
    static func make() -> MediaPlayerPage {
        MediaPlayerPage()
    }
}
