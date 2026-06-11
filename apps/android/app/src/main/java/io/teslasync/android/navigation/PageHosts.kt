package io.teslasync.android.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavBackStackEntry

/** Renders the screen content for a destination, given its [NavBackStackEntry] (route arguments). */
typealias PageHostContent = @Composable (NavBackStackEntry) -> Unit

/**
 * Pluggable registry of page hosts, keyed by [Destination.id]. This is the seam A7 page prompts
 * use to attach real screen content to a route without this navigation module depending on any
 * feature page.
 *
 * The navigation graph in [TeslaSyncNavHost] registers a destination for every route either way;
 * when no host is registered (as in this foundation, where A7 has not run yet) the route resolves
 * to the shared not-found screen rather than any fabricated stand-in — the destination stays
 * metadata-only, satisfying the "no fake screens" rule.
 */
object PageHosts {
    private val hosts: MutableMap<String, PageHostContent> = linkedMapOf()

    /** Registers (or replaces) the host content for [id]. Called from A7 page wiring at app start. */
    fun register(
        id: String,
        content: PageHostContent,
    ) {
        hosts[id] = content
    }

    /** Removes a previously registered host (primarily for tests). */
    fun unregister(id: String) {
        hosts.remove(id)
    }

    /** The host content for [id], or null when the page has not been wired yet. */
    fun hostFor(id: String): PageHostContent? = hosts[id]

    /** Whether a host has been registered for [id]. */
    fun hasHost(id: String): Boolean = hosts.containsKey(id)

    /** The set of destination ids that currently have a registered host. */
    val registeredIds: Set<String> get() = hosts.keys.toSet()
}
