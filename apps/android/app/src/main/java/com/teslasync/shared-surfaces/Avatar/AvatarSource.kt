// The single data seam the Avatar shared surface binds to, plus its static factory — the native analogue of
// where the web component's identity props originate (web/src/components/data-display/Avatar.tsx). The web
// Avatar is presentational: its `userId` / `name` / `src` / `status` / `kind` are supplied by the parent
// (the current user from settings, a known commenter, or the static bot identity the chatbot uses). This
// seam is that boundary, narrowed to the one identity the surface needs, so the view depends on an
// abstraction (a real adapter over the shared S8 layer in production, a fake in tests) and performs NO HTTP
// itself (the P1/S8 boundary, ADR-002).
//
// A [Flow] — not a plain value — because presence ([AvatarIdentity.status]) is genuinely live: a host can
// re-emit when a vehicle/user goes online → idle → offline and the avatar's dot updates in place. The common
// case (a static current-user avatar, or the bot mark) is covered by [staticAvatarSource], which emits once.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Avatar) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.avatar

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The seam the [AvatarViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake), never
 * on a concrete store or the network. [identity] streams the avatar's current [AvatarIdentity]; it re-emits
 * whenever a data-derived field (most often presence [AvatarStatus]) changes. No HTTP touches the view.
 */
fun interface AvatarSource {
    /** Streams the avatar's current identity; re-emits on every change (e.g. a presence transition). */
    fun identity(): Flow<AvatarIdentity>
}

/**
 * Builds an [AvatarSource] that emits a fixed [identity] once — the production seam for a static avatar (the
 * current user resolved from settings, a known name, or the chatbot's bot mark). A host with live presence
 * implements [AvatarSource] directly so its flow re-emits; a test fake does the same.
 */
fun staticAvatarSource(identity: AvatarIdentity): AvatarSource = AvatarSource { flowOf(identity) }
