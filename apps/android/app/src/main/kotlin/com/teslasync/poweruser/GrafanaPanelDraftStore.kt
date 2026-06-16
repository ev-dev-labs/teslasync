// SharedPreferences-backed implementation of the [GrafanaDraftStore] persistence seam — the native analogue of
// the web page's localStorage `'ai.grafanaPanel.draft'` read/write pair (web `loadPersistedJson` /
// `persistJson`). The web page persists the manual editor contents so a long JSON envelope survives an
// accidental navigation away + back (and a process restart); SharedPreferences gives the same durability on
// Android without a new dependency. Mirrors the precedent [io.teslasync.android.settings.SharedPreferencesAppSettingsStore]
// (applicationContext + MODE_PRIVATE + apply()), and like the web `persistJson` removes the key when the draft
// is cleared so an empty editor leaves no residue.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located factory alongside the namesake class.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.grafanapanel

import android.content.Context

/**
 * Durable [GrafanaDraftStore] over the app's private [android.content.SharedPreferences]. The single string entry
 * is keyed by [GrafanaPanelPageRegistration.DRAFT_STORE_KEY] (web `GRAFANA_PANEL_DRAFT_KEY`); a blank save removes
 * it (web `persistJson` `removeItem`). Reads/writes are small (≤ a few KB) so the synchronous `apply()` path is
 * fine, exactly as the web page notes modern browsers handle the localStorage write in <1 ms.
 */
class SharedPreferencesGrafanaDraftStore(
    context: Context,
) : GrafanaDraftStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun load(): String = prefs.getString(GrafanaPanelPageRegistration.DRAFT_STORE_KEY, null) ?: ""

    override fun save(value: String) {
        prefs
            .edit()
            .apply {
                if (value.isNotEmpty()) {
                    putString(GrafanaPanelPageRegistration.DRAFT_STORE_KEY, value)
                } else {
                    remove(GrafanaPanelPageRegistration.DRAFT_STORE_KEY)
                }
            }.apply()
    }

    private companion object {
        /** Dedicated prefs file for power-user editor drafts; keeps the entry off the app-settings file. */
        const val PREFS = "teslasync.poweruser.grafana"
    }
}

/** Builds the production [GrafanaDraftStore] for [context] (the host wires this from the composition `Context`). */
fun grafanaDraftStore(context: Context): GrafanaDraftStore = SharedPreferencesGrafanaDraftStore(context)
