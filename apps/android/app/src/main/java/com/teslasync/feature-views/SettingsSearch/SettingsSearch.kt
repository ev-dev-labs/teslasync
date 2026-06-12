// The native Jetpack Compose + Material 3 SettingsSearch feature view — a parity port of
// web/src/features/settings/components/SettingsSearch.tsx. The web component is the settings page's
// find-as-you-type box: a single search `Input` (leading lucide `Search` glyph, ghost-prompt "Search
// settings…", aria-label "Search settings") with a popover `listbox` of matching settings. Each match
// deep-links to its section anchor (web `navigate(entry.href)`); the matching is delegated to
// `searchSettings` (searchIndex.ts) and covers substring + keyword + fuzzy-subsequence ("lng" → "Language").
//
// This port keeps that contract end to end. Its only web hooks are `useTranslation` (mapped to the P1/S10
// i18n catalog), `useNavigate` (mapped to the [onNavigate] callback — the host owns the NavController, like
// the sibling QuickNav port), and `useId` (an accessibility concern handled natively by Compose semantics).
// It binds NO data hook and performs NO fetch, so — exactly like the sibling QuickNav / RegexTester / ToolCard
// surfaces — there is no loading / error / stale / offline lifecycle to render; modelling those would invent
// behaviour the web spec does not have (honesty covenant §9, no silent drift). What the surface genuinely
// varies is the dropdown: hidden while the field is empty (web `showDropdown = open && query.length > 0`),
// the ranked match rows when something matches, or a friendly "No matching settings." row when nothing does —
// never a hidden surface. Every derivation flows through the pure [SettingsSearchProjection]; this composable
// is a thin render layer that resolves the i18n labels (P1/S10) and draws what the projection returns inside
// the Material 3 `ExposedDropdownMenuBox` (the native counterpart of the web `<Input>` + `<ul role="listbox">`),
// using the shared component library (ui Icon / typography, forms Search glyph). The one-shot PII-safe
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Native idiom note: the web component's keyboard navigation (ArrowUp/ArrowDown/Enter to walk the listbox) and
// its same-hash `scrollIntoView` fallback are desktop-DOM affordances. On Android the idiomatic interaction is
// a tap on a row, which the `ExposedDropdownMenu` already exposes as a focusable, click-actionable item to
// TalkBack; the host performs the navigation + scroll. The ranking/highlight model itself is preserved in the
// pure projection and exercised by the off-device unit gate.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SettingsSearch — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling AddressInput / QuickNav
// / RegexTester surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.settingssearch

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Android string-resource names are `translation_` + the i18n key with every non-resource character folded to
// `_`, matching the P1/S10 generator's `androidName` transform (apps/shared/i18n) — see [Context.resolveSettingString].
private const val I18N_RESOURCE_PREFIX = "translation_"
private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

/**
 * Stateful entry point — the faithful 1:1 port of the web `SettingsSearch`. Records the one-shot `view.opened`
 * diagnostic on first composition (P1/S11), builds the resolved settings index once per locale (the web
 * `useMemo(() => getSettingsIndex(t), [t])`), holds the query text as rotation-surviving state (web
 * `useState('')`), projects it onto the render-ready dropdown via the pure [SettingsSearchProjection], and
 * renders the autocomplete. Picking a row clears the field and emits the chosen entry through [onNavigate]
 * (web `commit`: `setQuery('')` then `navigate(entry.href)`); the host performs the navigation + scroll.
 *
 * @param onNavigate invoked with the selected [SettingsSearchEntry]; the host navigates to its `route` (web
 *   `navigate(entry.href)`). The view never touches the NavController, mirroring the sibling QuickNav port.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SettingsSearch(
    onNavigate: (SettingsSearchEntry) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SettingsSearchDiagnostics.recordViewOpened(logger) }

    val context = LocalContext.current
    val index =
        remember(context) {
            SettingsSearchCatalog.buildIndex { key, default -> context.resolveSettingString(key, default) }
        }

    var query by rememberSaveable { mutableStateOf("") }
    val results = remember(index, query) { SettingsSearchProjection.project(index, query) }

    SettingsSearchContent(
        query = query,
        results = results,
        onQueryChange = { query = it },
        onSelect = { entry ->
            // Web `commit`: clear the field + close the dropdown, then navigate. The host owns navigation
            // (the web `navigate(href)` + same-hash `scrollIntoView` fallback are DOM concerns it handles).
            query = ""
            onNavigate(entry)
        },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Draws the search field (leading [FormsGlyphs.Search]
 * glyph, no visible label but the localized aria-label kept as the field's accessible name, web `aria-label`) and,
 * while the query is non-empty, the dropdown: the ranked match rows or a friendly "No matching settings." row —
 * never a hidden surface. The dropdown gate mirrors the web `showDropdown = open && query.length > 0`.
 */
@Composable
fun SettingsSearchContent(
    query: String,
    results: SettingsSearchResults,
    onQueryChange: (String) -> Unit,
    onSelect: (SettingsSearchEntry) -> Unit,
    modifier: Modifier = Modifier,
) {
    val accessibleLabel = stringResource(R.string.translation_settings_search_label)
    val hint = stringResource(R.string.translation_settings_search_placeholder) // parity:allow web i18n key for the search field hint
    var suppressMenu by remember { mutableStateOf(false) }
    // Web `showDropdown = open && query.length > 0`. Status Idle ⟺ empty query ⇒ no menu.
    val menuExpanded = results.status != SettingsSearchStatus.Idle && !suppressMenu

    ExposedDropdownMenuBox(
        expanded = menuExpanded,
        onExpandedChange = { wantOpen -> suppressMenu = !wantOpen },
        modifier = modifier,
    ) {
        SettingsSearchField(
            query = query,
            accessibleLabel = accessibleLabel,
            hint = hint,
            anchor = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable),
            onQueryChange = { text ->
                suppressMenu = false
                onQueryChange(text)
            },
        )
        ExposedDropdownMenu(
            expanded = menuExpanded,
            onDismissRequest = { suppressMenu = true },
        ) {
            when (results.status) {
                SettingsSearchStatus.Empty -> NoResultsRow()
                SettingsSearchStatus.Results ->
                    results.entries.forEach { entry ->
                        SettingsResultRow(
                            entry = entry,
                            onClick = {
                                suppressMenu = true
                                onSelect(entry)
                            },
                        )
                    }
                SettingsSearchStatus.Idle -> Unit
            }
        }
    }
}

/**
 * The search text field — an [OutlinedTextField] anchored to the dropdown with a leading [FormsGlyphs.Search]
 * glyph (web lucide `Search`) and the localized ghost-prompt [hint] shown while the field is empty. The web
 * component renders no visible label, so the localized aria-label is kept as the field's accessible name via
 * semantics so screen readers still announce it (web `aria-label`).
 */
@Composable
private fun SettingsSearchField(
    query: String,
    accessibleLabel: String,
    hint: String,
    anchor: Modifier,
    onQueryChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier =
            anchor
                .fillMaxWidth()
                .semantics { contentDescription = accessibleLabel },
        singleLine = true,
        placeholder = { Text(hint) }, // parity:allow Material 3 OutlinedTextField placeholder slot name
        leadingIcon = { Icon(FormsGlyphs.Search, contentDescription = null, size = IconSize.Sm) },
        shape = MaterialTheme.shapes.medium,
    )
}

/**
 * One matched-setting row — the web `<button role="option">`: the setting's title on the first line and its
 * muted description on the second (web `entry.title` + `entry.description`). The whole row is a clickable
 * [DropdownMenuItem] (web `onClick={() => commit(entry)}`) that TalkBack announces with its title + description.
 */
@Composable
private fun SettingsResultRow(
    entry: SettingsSearchEntry,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        onClick = onClick,
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(entry.title, maxLines = 1)
                if (entry.description.isNotBlank()) {
                    Caption(entry.description)
                }
            }
        },
    )
}

/** The friendly "No matching settings." row when the query matched nothing (web `matches.length === 0` row). */
@Composable
private fun NoResultsRow() {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = {
            BodyText(
                stringResource(R.string.translation_settings_search_noResults),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}

/**
 * Resolves an i18n `(key, default)` against the shared catalog (P1/S10) — the native analogue of the web
 * `t(key, default)`: the localized string when the catalog carries the key, otherwise the English [default]
 * (so entries whose keys the generated catalog does not yet carry — e.g. privacy/helix — still render their
 * web wording, exactly as i18next's `t(key, default)` falls back). The by-name lookup is the only way to
 * express "resolve if present, else fall back" (a compile-time `R.string` reference cannot), so
 * `DiscouragedApi` is suppressed; release builds keep resource names (shrinking is off — see app/build.gradle.kts).
 */
@SuppressLint("DiscouragedApi")
private fun Context.resolveSettingString(
    key: String,
    default: String,
): String {
    val resourceName = I18N_RESOURCE_PREFIX + NON_RESOURCE_CHARS.replace(key, "_")
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else default
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_MATCHES =
    listOf(
        SettingsSearchEntry(
            id = "appearance.theme",
            route = "/settings#appearance",
            section = "appearance",
            title = "Theme",
            description = "Choose light, dark, or system mode and pick an accent color.",
            keywords = listOf("dark", "light", "color", "accent", "mode"),
        ),
        SettingsSearchEntry(
            id = "appearance.chartPalette",
            route = "/settings#appearance",
            section = "appearance",
            title = "Chart palette",
            description = "Color-blind safe (Okabe-Ito) or stylistic neon chart colors.",
            keywords = listOf("cb", "colorblind", "okabe", "neon", "colors"),
        ),
    )

@Preview(name = "SettingsSearch — idle (empty query)", showBackground = true)
@Composable
private fun SettingsSearchIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsSearchContent(
            query = "",
            results = SettingsSearchResults(SettingsSearchStatus.Idle),
            onQueryChange = {},
            onSelect = {},
        )
    }
}

@Preview(name = "SettingsSearch — results", showBackground = true)
@Composable
private fun SettingsSearchResultsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsSearchContent(
            query = "color",
            results = SettingsSearchResults(SettingsSearchStatus.Results, PREVIEW_MATCHES),
            onQueryChange = {},
            onSelect = {},
        )
    }
}

@Preview(name = "SettingsSearch — empty (no match)", showBackground = true)
@Composable
private fun SettingsSearchEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SettingsSearchContent(
            query = "zzzzzz",
            results = SettingsSearchResults(SettingsSearchStatus.Empty),
            onQueryChange = {},
            onSelect = {},
        )
    }
}
