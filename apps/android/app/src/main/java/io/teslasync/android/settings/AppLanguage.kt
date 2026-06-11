package io.teslasync.android.settings

/**
 * A selectable app language (P3/A8, ADR-014). The catalog mirrors the locales the shared i18n string
 * catalog actually ships (`values/` English plus `values-ar`/`values-he`), so the app never offers a
 * language it cannot render. A null/blank tag means "follow the system language". Framework-free so
 * the selection + normalization rules are unit-tested; the display names are resolved at the UI
 * boundary, and applying a tag to the running app is the platform job of [PerAppLanguageController].
 */
object AppLanguage {
    /** The sentinel persisted form for "follow the system language". */
    const val SYSTEM_TAG: String = ""

    /** The base BCP-47 language tags the bundled string catalog supports, in display order. */
    val supportedTags: List<String> = listOf("en", "ar", "he")

    /** The right-to-left tags among [supportedTags] (the manifest already declares supportsRtl). */
    val rtlTags: Set<String> = setOf("ar", "he")

    /**
     * Normalizes an arbitrary stored/selected tag to one the catalog supports, or null for "system".
     * A blank tag, an unknown family or null all resolve to null; a regional tag (e.g. `ar-EG`) folds
     * to its supported base (`ar`).
     */
    fun normalize(tag: String?): String? {
        val base =
            tag
                ?.trim()
                ?.lowercase()
                ?.substringBefore('-')
                .orEmpty()
        return base.takeIf { it.isNotEmpty() && it in supportedTags }
    }

    /** True when [tag] selects a specific, supported language (i.e. not "follow system"). */
    fun isExplicit(tag: String?): Boolean = normalize(tag) != null

    /** True when the resolved language is right-to-left (drives any locale-aware UI affordance). */
    fun isRtl(tag: String?): Boolean = normalize(tag) in rtlTags

    /** The persisted form for [tag]: the normalized base tag, or [SYSTEM_TAG] for "follow system". */
    fun toPersisted(tag: String?): String = normalize(tag) ?: SYSTEM_TAG

    /** The settings value for a persisted [stored] string: a supported tag, or null for "follow system". */
    fun fromPersisted(stored: String?): String? = normalize(stored)
}
