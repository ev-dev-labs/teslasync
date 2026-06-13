// The native Jetpack Compose + Material 3 KeyboardShortcutsModal surface — a parity port of the web
// `KeyboardShortcutsModal` (web/src/components/feedback/KeyboardShortcutsModal.tsx), the global "?" cheat sheet.
// The web component reads the shortcut registry (useAllShortcuts), filters it by a search box + an
// All / Global / This page scope chip group, groups + sorts the survivors, and renders each key combo as <kbd>
// chips — or a friendly "no shortcuts match" message when the filter clears everything. This port reproduces
// every one of those branches with native primitives.
//
// Every derivation flows through the pure registry + projection + seed builder (KeyboardShortcutsModalModel.kt);
// the composable is a thin render layer. Strings resolve from the i18n catalog (P1/S10) `shortcuts.*` +
// `common.close` keys — there is no English literal in this file (the preview-only fixtures excepted). The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Web `open` prop -> host-gated composition: the web renders only when `open=true` (its Modal owns the render
// gate). The Compose idiom — prescribed by the shared `components/ui/Modal` KDoc — is to compose
// `KeyboardShortcutsModal(...)` conditionally (`if (open) KeyboardShortcutsModal(...)`), so this surface maps to
// the `open=true` render and the owning view gates it, exactly as the sibling ConfirmDialog does. The web
// "reset the search box on close" effect is therefore implicit here: closing tears down the composition, so the
// next open starts with an empty search.
//
// Data binding (P1/S8): the modal observes the shared KeyboardShortcutsRegistry (web useAllShortcuts) and the
// process-scoped KeyboardShortcutsFilterStore (web sessionStorage), and seeds the registry with the app-global
// default set (web lib/globalShortcuts.tsx) on first composition. No HTTP — the data source is an in-process
// store, so the cache lifecycle phases (loading / error / stale / offline) have no analogue (see the model
// header).
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the group heading `text-sm font-semibold
// text-[var(--text-secondary)]` maps to [Subhead]; the row description `text-sm text-[var(--text-secondary)]`
// maps to [BodyText]; the `<kbd>` chip (`rounded bg-[var(--surface-2)] border-[var(--glass-border)] font-mono
// text-[var(--text-secondary)] min-w-[24px]`) maps to a rounded, `outline`-bordered, `surfaceVariant`-filled
// box hosting a monospaced [CodeText]; the `+` joiner maps to a [Caption]. Web `space-y-*` / `gap-*` insets map
// to `Spacing` tokens, and the web scope `role="tablist"` maps to the shared [Tabs] (Material 3 tab semantics).
//
// InvalidPackageDeclaration is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/KeyboardShortcutsModal) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.keyboardshortcutsmodal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.navTitleRes
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects. */
object KeyboardShortcutsModalTestTags {
    const val ROOT: String = "keyboard-shortcuts-modal"
    const val SEARCH: String = "keyboard-shortcuts-search"
    const val FILTERS: String = "keyboard-shortcuts-filters"
    const val LIST: String = "keyboard-shortcuts-list"
    const val EMPTY: String = "keyboard-shortcuts-empty"
}

// Web `GOTO_SHORTCUTS` (web/src/hooks/useKeyboardShortcuts.ts) mapped onto the native navigation graph: each
// `g`-then-letter combo resolves to a real Destinations id so the row label is that destination's own localized
// title. Twelve letters match the web path exactly; the two web targets without a native route (`/live-signals`,
// `/climate`) map to their nearest native destination (live signal monitor, climate control).
private val NAV_SHORTCUT_TARGETS: List<Pair<String, String>> =
    listOf(
        "d" to "dashboard",
        "v" to "vehicles",
        "c" to "charging",
        "r" to "drives",
        "t" to "trips",
        "b" to "batteryHealth",
        "a" to "analytics",
        "e" to "efficiency",
        "s" to "settings",
        "n" to "notificationsInbox",
        "l" to "liveSignalMonitor",
        "o" to "automations",
        "x" to "commands",
        "i" to "climateControl",
    )

private const val SEARCH_DEBOUNCE_MS = 120L
private val KEY_CHIP_MIN_WIDTH = 24.dp

/**
 * The already-localized modal chrome copy, resolved from the surface i18n keys (P1/S10). Bundled so the
 * stateless [KeyboardShortcutsModalContent] takes plain strings and stays trivially previewable + UI-testable.
 */
data class KeyboardShortcutsStrings(
    val title: String,
    val close: String,
    val searchHint: String,
    val empty: String,
    val filterAll: String,
    val filterGlobal: String,
    val filterPage: String,
)

/** Resolves every [KeyboardShortcutsStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberKeyboardShortcutsStrings(): KeyboardShortcutsStrings =
    KeyboardShortcutsStrings(
        title = stringResource(R.string.translation_shortcuts_title),
        close = stringResource(R.string.translation_common_close),
        searchHint = stringResource(R.string.translation_shortcuts_search),
        empty = stringResource(R.string.translation_shortcuts_empty),
        filterAll = stringResource(R.string.translation_shortcuts_filter_all),
        filterGlobal = stringResource(R.string.translation_shortcuts_filter_global),
        filterPage = stringResource(R.string.translation_shortcuts_filter_page),
    )

/** Resolves + builds the app-global default seed (universals + navigation) at the Compose boundary. */
@Composable
private fun rememberSeedShortcuts(): List<ShortcutDefinition> {
    val seedStrings =
        ShortcutSeedStrings(
            groupActions = stringResource(R.string.translation_shortcuts_groups_actions),
            groupNavigation = stringResource(R.string.translation_shortcuts_groups_navigation),
            openPalette = stringResource(R.string.translation_shortcuts_openPalette),
            openPaletteAlt = stringResource(R.string.translation_shortcuts_openPaletteAlt),
            openShortcuts = stringResource(R.string.translation_shortcuts_openShortcuts),
            closeModal = stringResource(R.string.translation_shortcuts_close),
        )
    val navTargets =
        NAV_SHORTCUT_TARGETS.map { (key, destinationId) ->
            val label = stringResource(navTitleRes(destinationId))
            NavSeedTarget(key, stringResource(R.string.translation_shortcuts_goto, label))
        }
    return remember(seedStrings, navTargets) { buildDefaultShortcuts(seedStrings, navTargets) }
}

/**
 * Stateful entry point — the faithful port of the web `KeyboardShortcutsModal({ open, onClose })`. Seeds the
 * shared registry with the app-global default set on first composition, records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), observes the registry + filter holder, projects them through the pure
 * [KeyboardShortcutsProjection], and renders the modal. The owning view gates composition (web `open`); see the
 * file header.
 *
 * @param onClose dismiss handler (web `onClose`); the owner closes the sheet.
 * @param currentRoute the active navigation route the "This page" scope + route-scoped entries match against
 *   (web `useLocation().pathname`); empty when the owner has no route context.
 * @param registry the shared shortcut registry to observe + seed (web `useShortcutRegistry`).
 * @param filterStore the process-scoped scope-filter holder (web `sessionStorage`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun KeyboardShortcutsModal(
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    currentRoute: String = "",
    registry: KeyboardShortcutsRegistry = KeyboardShortcutsRegistry.Default,
    filterStore: KeyboardShortcutsFilterStore = KeyboardShortcutsFilterStore.Default,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val seed = rememberSeedShortcuts()
    LaunchedEffect(registry, seed) { registry.register(seed) }
    LaunchedEffect(Unit) { recordKeyboardShortcutsModalOpened(logger) }

    val allShortcuts by registry.shortcuts.collectAsStateWithLifecycle()
    val mode by filterStore.mode.collectAsStateWithLifecycle()
    var search by remember { mutableStateOf("") }
    val strings = rememberKeyboardShortcutsStrings()

    val groups =
        remember(allShortcuts, mode, currentRoute, search) {
            KeyboardShortcutsProjection.groups(allShortcuts, mode, currentRoute, search)
        }

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        KeyboardShortcutsModalContent(
            groups = groups,
            search = search,
            onSearchChange = { search = it },
            mode = mode,
            onModeChange = filterStore::set,
            strings = strings,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Lays out the search field, the
 * All / Global / This page scope tabs, and either the grouped shortcut sections or the friendly empty state.
 */
@Composable
fun KeyboardShortcutsModalContent(
    groups: List<ShortcutGroup>,
    search: String,
    onSearchChange: (String) -> Unit,
    mode: FilterMode,
    onModeChange: (FilterMode) -> Unit,
    strings: KeyboardShortcutsStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(KeyboardShortcutsModalTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SearchInput(
            value = search,
            onValueChange = onSearchChange,
            modifier = Modifier.testTag(KeyboardShortcutsModalTestTags.SEARCH),
            hint = strings.searchHint,
            debounceMs = SEARCH_DEBOUNCE_MS,
        )

        ScopeFilterTabs(mode = mode, onModeChange = onModeChange, strings = strings)

        if (groups.isEmpty()) {
            EmptyState(
                message = strings.empty,
                modifier = Modifier.testTag(KeyboardShortcutsModalTestTags.EMPTY),
                icon = FeedbackGlyphs.Keyboard,
            )
        } else {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag(KeyboardShortcutsModalTestTags.LIST),
                verticalArrangement = Arrangement.spacedBy(Spacing.xl),
            ) {
                groups.forEach { group -> ShortcutGroupSection(group) }
            }
        }
    }
}

/** The web scope `role="tablist"` (All / Global / This page), as the shared Material 3 [Tabs]. */
@Composable
private fun ScopeFilterTabs(
    mode: FilterMode,
    onModeChange: (FilterMode) -> Unit,
    strings: KeyboardShortcutsStrings,
) {
    val tabs =
        listOf(
            TabItem(FilterMode.All.id, strings.filterAll),
            TabItem(FilterMode.Global.id, strings.filterGlobal),
            TabItem(FilterMode.Page.id, strings.filterPage),
        )
    Tabs(
        tabs = tabs,
        selectedKey = mode.id,
        onSelect = { onModeChange(FilterMode.fromId(it)) },
        modifier = Modifier.fillMaxWidth().testTag(KeyboardShortcutsModalTestTags.FILTERS),
    )
}

/** One group section — the web `<section>` with its `<h3>` label and the rows beneath it. */
@Composable
private fun ShortcutGroupSection(group: ShortcutGroup) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Subhead(group.title)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            group.shortcuts.forEach { shortcut -> ShortcutRow(shortcut) }
        }
    }
}

/** One shortcut row — the web `flex items-center justify-between` description + key-combo line. */
@Composable
private fun ShortcutRow(shortcut: ShortcutDefinition) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(text = shortcut.description, modifier = Modifier.weight(1f))
        KeyCombo(keys = shortcut.keys)
    }
}

/**
 * The key combo — the web `<kbd>` chips joined by `+`. A merged `contentDescription` ("Ctrl + K") gives
 * TalkBack one coherent spoken name for the combo instead of reading each chip + joiner separately.
 */
@Composable
private fun KeyCombo(keys: List<String>) {
    Row(
        modifier =
            Modifier.semantics(mergeDescendants = true) {
                contentDescription = keys.joinToString(separator = " + ")
            },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        keys.forEachIndexed { index, key ->
            if (index > 0) Caption(text = "+")
            KeyChip(key = key)
        }
    }
}

/** A single `<kbd>` chip: rounded, outlined, surface-variant filled, monospaced, with the web 24 dp min width. */
@Composable
private fun KeyChip(key: String) {
    val shape = RoundedCornerShape(Radius.sm)
    Box(
        modifier =
            Modifier
                .clip(shape)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .widthIn(min = KEY_CHIP_MIN_WIDTH)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        CodeText(text = key)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    KeyboardShortcutsStrings(
        title = "Keyboard Shortcuts",
        close = "Close",
        searchHint = "Search shortcuts…",
        empty = "No shortcuts match your search.",
        filterAll = "All",
        filterGlobal = "Global",
        filterPage = "This page",
    )

private const val PREVIEW_NAV_GROUP = "Navigation (press g then…)"

private val PREVIEW_GROUPS =
    listOf(
        ShortcutGroup(
            title = PREVIEW_NAV_GROUP,
            shortcuts =
                listOf(
                    ShortcutDefinition("global.goto.d", listOf("g", "d"), "Go to Dashboard", PREVIEW_NAV_GROUP),
                    ShortcutDefinition("global.goto.v", listOf("g", "v"), "Go to Vehicles", PREVIEW_NAV_GROUP),
                ),
        ),
        ShortcutGroup(
            title = "Actions",
            shortcuts =
                listOf(
                    ShortcutDefinition("global.palette.ctrlk", listOf("Ctrl", "K"), "Open command palette", "Actions"),
                    ShortcutDefinition("global.shortcuts.help", listOf("?"), "Show keyboard shortcuts", "Actions"),
                ),
        ),
    )

@Preview(name = "Populated — grouped shortcuts", showBackground = true, widthDp = 360)
@Composable
private fun KeyboardShortcutsPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KeyboardShortcutsModalContent(
            groups = PREVIEW_GROUPS,
            search = "",
            onSearchChange = {},
            mode = FilterMode.All,
            onModeChange = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty — no shortcuts match the filter", showBackground = true, widthDp = 360)
@Composable
private fun KeyboardShortcutsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KeyboardShortcutsModalContent(
            groups = emptyList(),
            search = "zzz",
            onSearchChange = {},
            mode = FilterMode.Page,
            onModeChange = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
