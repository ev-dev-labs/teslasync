// Pure, framework-free model + projections + diagnostics for the VehicleCommandCenter feature view — the
// native analogue of everything the web orchestrator derives before returning JSX
// (web/src/features/system/components/VehicleCommandCenter.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable layer a thin renderer.
//
// VehicleCommandCenter is the Vehicle Commands orchestrator. Unlike the presentational sibling surfaces it
// genuinely binds data: a `useQuery` latest-command-status feed and the `useMutation` command / wake
// dispatch (web `useVehicleCommand`), plus `useUnits` (display-unit boundary), `useIsStale` (freshness),
// `useToast`, `useQueryClient`, and `useTranslation`. The hooks bind through the shared S8 seams
// (VehicleCommandCenterSource.kt + the self-owned VehicleCommandCenterViewModel); this file owns the pure
// derivations the composable switches on so they are asserted without a UI host:
//   • the latest-status map + per-command status line (web `cmdMap` + `cmdStatus` + `timeAgo`);
//   • the command-search filter (web `filteredCommands`, null while the query is blank);
//   • the category grouping in CATEGORY_ORDER (web `commandsByCategory` + the CATEGORY_ORDER map);
//   • the favourites subset + default-favourite seed + toggle (web `favorites` state);
//   • the dialog routing (web `requestDialog`: select → input → confirm);
//   • the toggle on/off read off the vehicle state (web ToggleCommandTile `state[def.stateField]`);
//   • the asleep / stale / battery-tone header derivations (web `isAsleep`, `useIsStale`, battery colour).
//
// The 67-command catalogue (web `commands.ts`) is imported data on the web; the native analogue lives in
// VehicleCommandCenterCatalog.kt and is consumed here exactly as the web component imports COMMANDS.
//
// Per-command i18n keys are not in the Android catalog, so labels resolve through the same facade the
// sibling CollapsibleCommandGroup port uses — `resolveOptional` over a folded catalog key with the web
// English `*Fallback` as the default (faithful to web `t(key, fallback)` when a key is absent). The
// orchestration keys that DO exist (commands.search.noResults, commands.staleData, commands.toggleFavorite,
// commands.cat.*) resolve normally.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleCommandCenter — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.OffsetDateTime
import java.util.concurrent.ConcurrentHashMap

// ── Registration + diagnostics (P1/S11) ──────────────────────────────────────────────────────────────

/** Stable identifiers for the surface. */
object VehicleCommandCenterRegistration {
    /** Stable surface id. */
    const val ID: String = "vehicle-command-center"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleCommandCenter"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [VehicleCommandCenterRegistration.SLUG]
 * — never the vehicle id, command name, params, or favourite ids — so a diagnostics line can never leak
 * fleet data or which command the operator was looking at.
 */
object VehicleCommandCenterDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to VehicleCommandCenterRegistration.SLUG))
    }
}

// ── i18n facade (the native `t(key, default)` analogue; identical seam to the sibling ports) ─────────────

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

/**
 * Folds a dotted web i18n key into the Android string-catalog resource name produced by
 * apps/shared/i18n/generators/gen-i18n.ts: a `translation_` prefix, every non-alphanumeric run collapsed
 * to a single underscore, and leading / trailing underscores trimmed. E.g. `commands.search.noResults` →
 * `translation_commands_search_noResults`.
 */
fun foldCatalogKey(webKey: String): String = "translation_" + webKey.replace(NON_IDENTIFIER, "_").trim('_')

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (a by-name resource read) and a map in tests.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

// ── Enums (the native analogues of the web string unions) ────────────────────────────────────────────

/**
 * One vehicle-command category — the native analogue of the web `CommandCategory` union + `CATEGORY_META`
 * (web/src/features/system/commands.ts). [wireName] is the exact web union value (used for search matching
 * and stable ordering); [labelKey] / [labelFallback] mirror the web `CATEGORY_META[category]`.
 */
enum class CommandCenterCategory(
    val wireName: String,
    val labelKey: String,
    val labelFallback: String,
) {
    Security("security", "commands.cat.security", "Security & Access"),
    Climate("climate", "commands.cat.climate", "Climate & Comfort"),
    ClimateProtection("climate_protection", "commands.cat.climateProtect", "Climate Protection"),
    Charging("charging", "commands.cat.charging", "Charging"),
    Doors("doors", "commands.cat.doors", "Doors & Trunk"),
    Drive("drive", "commands.cat.drive", "Drive"),
    Windows("windows", "commands.cat.windows", "Windows"),
    Sunroof("sunroof", "commands.cat.sunroof", "Sunroof"),
    Schedules("schedules", "commands.cat.schedules", "Schedules"),
    Alerts("alerts", "commands.cat.alerts", "Alerts & Location"),
    Navigation("navigation", "commands.cat.navigation", "Navigation"),
    Software("software", "commands.cat.software", "Software"),
    Vehicle("vehicle", "commands.cat.vehicle", "Vehicle"),
    Media("media", "commands.cat.media", "Media"),
    ;

    companion object {
        /** Resolve a [CommandCenterCategory] from its web [wireName], or `null` when unknown. */
        fun fromWireName(wireName: String): CommandCenterCategory? = entries.firstOrNull { it.wireName == wireName }
    }
}

/** The localized category label — web `t(meta.labelKey, meta.fallback)`. */
fun categoryLabel(
    category: CommandCenterCategory,
    lookup: (String) -> String?,
): String = resolveOptional(lookup, foldCatalogKey(category.labelKey), category.labelFallback)

/** The static category render order — the web `CATEGORY_ORDER` array. */
val CATEGORY_ORDER: List<CommandCenterCategory> =
    listOf(
        CommandCenterCategory.Security,
        CommandCenterCategory.Climate,
        CommandCenterCategory.ClimateProtection,
        CommandCenterCategory.Charging,
        CommandCenterCategory.Doors,
        CommandCenterCategory.Drive,
        CommandCenterCategory.Windows,
        CommandCenterCategory.Sunroof,
        CommandCenterCategory.Schedules,
        CommandCenterCategory.Alerts,
        CommandCenterCategory.Navigation,
        CommandCenterCategory.Software,
        CommandCenterCategory.Vehicle,
        CommandCenterCategory.Media,
    )

/** The render kind of a command tile — the native analogue of the web `def.type` union. */
enum class CommandType { Action, Toggle, Input }

/** Semantic emphasis of a command — the native analogue of web `def.variant ?? 'default'`. */
enum class CommandVariant {
    Default,
    Danger,
    Success,
}

/**
 * Tone of the optional last-status line — the native analogue of web `entry.status === 'success'`. The
 * composable resolves each case to a design-token colour and renders the `✓`/`✗` prefixed age verbatim.
 */
enum class CommandStatusTone {
    None,
    Success,
    Error,
    ;

    companion object {
        /** The success sentinel prefixed onto a successful command status — web `'✓'`. */
        const val SUCCESS_PREFIX: String = "\u2713"

        /** The failure sentinel prefixed onto a failed command status — web `'✗'`. */
        const val FAILURE_PREFIX: String = "\u2717"

        /** Classifies a backend command `status` (web `entry.status === 'success' ? … : …`). */
        fun fromStatus(status: String?): CommandStatusTone =
            when {
                status.isNullOrBlank() -> None
                status == "success" -> Success
                else -> Error
            }
    }
}

/** The kind of command dialog the host must open — the native analogue of web `requestDialog`. */
enum class DialogKind { Input, Select, Confirm }

/** The validation family for an input field — the native analogue of web `validation`. */
enum class InputValidation { Pin, Number, Decimal, Text }

/** Glyph family for a command tile — mapped to a concrete `ImageVector` at the render boundary. */
enum class CommandGlyph {
    Power,
    Lock,
    Unlock,
    Shield,
    ShieldAlert,
    Wind,
    Thermometer,
    Flame,
    Snowflake,
    Bolt,
    Battery,
    Door,
    Car,
    Window,
    Sun,
    Calendar,
    CalendarMinus,
    Speaker,
    Navigation,
    Download,
    PlayMedia,
    Pencil,
    Key,
    Eraser,
    User,
    Dog,
    Tent,
    Volume,
    Gauge,
}

// ── Toggle state field (web `def.stateField`) ────────────────────────────────────────────────────────

/** A boolean field of the vehicle state a toggle command reflects — web `state[def.stateField]`. */
enum class ToggleField(
    val wireName: String,
) {
    IsLocked("is_locked"),
    IsCharging("is_charging"),
    IsClimateOn("is_climate_on"),
    SentryMode("sentry_mode"),
}

// ── Command definition (the native analogue of the web `CommandDef`) ──────────────────────────────────

/** The label + sublabel keys/fallbacks of a command — web `labelKey`/`labelFallback`/`sublabelKey`/`sublabelFallback`. */
data class CommandLabels(
    val labelKey: String,
    val labelFallback: String,
    val sublabelKey: String? = null,
    val sublabelFallback: String? = null,
)

/** Min/max numeric bounds for an input field — web `min`/`max`. */
data class InputBounds(
    val min: Int,
    val max: Int,
)

/** One field of a multi-field input dialog — web `InputField`. [hint] is the field's example ghost text. */
data class InputFieldDef(
    val name: String,
    val labelKey: String,
    val labelFallback: String,
    val hint: String? = null,
    val validation: InputValidation = InputValidation.Text,
)

/** Input-dialog configuration — the native analogue of web `InputConfig` (logic lambdas excepted). */
data class InputConfigDef(
    val promptKey: String,
    val promptFallback: String,
    val paramName: String,
    val validation: InputValidation = InputValidation.Text,
    val defaultValue: String? = null,
    val bounds: InputBounds? = null,
    val fields: List<InputFieldDef> = emptyList(),
)

/** One option of a select dialog — web `SelectOption`. */
data class SelectOptionDef(
    val value: String,
    val labelKey: String,
    val labelFallback: String,
    val description: String? = null,
)

/** Select-dialog configuration — web `SelectConfig`. */
data class SelectConfigDef(
    val paramName: String,
    val options: List<SelectOptionDef>,
)

/** Confirmation configuration for a dangerous command — web `confirmKey`/`confirmFallback`/`confirmInput`/`countdown`. */
data class ConfirmConfig(
    val confirmKey: String,
    val confirmFallback: String,
    val confirmInput: String? = null,
    val countdown: Int? = null,
)

/**
 * One command definition — the native 1:1 port of the parts of the web `CommandDef` the orchestrator + its
 * inline tiles read. [LongParameterList] is suppressed because this faithfully mirrors the web interface's
 * flat 20-field shape; grouping the fields would obscure the parity mapping to `commands.ts`.
 *
 * @property params the opaque static argument bag forwarded to the backend (web `def.params`).
 */
@Suppress("LongParameterList")
data class CommandCenterCommand(
    val id: String,
    val command: String,
    val labels: CommandLabels,
    val category: CommandCenterCategory,
    val type: CommandType,
    val glyph: CommandGlyph,
    val commandOff: String? = null,
    val variant: CommandVariant = CommandVariant.Default,
    val stateField: ToggleField? = null,
    val dangerous: Boolean = false,
    val defaultFavorite: Boolean = false,
    val confirm: ConfirmConfig? = null,
    val input: InputConfigDef? = null,
    val select: SelectConfigDef? = null,
    val params: Map<String, String> = emptyMap(),
)

/** The localized primary label — web `t(def.labelKey, def.labelFallback)`. */
fun commandLabel(
    command: CommandCenterCommand,
    lookup: (String) -> String?,
): String = resolveOptional(lookup, foldCatalogKey(command.labels.labelKey), command.labels.labelFallback)

/**
 * The localized secondary label, or `null` when the command has none — web
 * `def.sublabelFallback && t(def.sublabelKey ?? '', def.sublabelFallback)`.
 */
fun commandSublabel(
    command: CommandCenterCommand,
    lookup: (String) -> String?,
): String? {
    val key = command.labels.sublabelKey
    val fallback = command.labels.sublabelFallback
    if (key == null || fallback.isNullOrBlank()) return null
    return resolveOptional(lookup, foldCatalogKey(key), fallback)
}

// ── Vehicle + state + command-log (the web `Vehicle` / `VehicleState` / `CommandLogEntry`) ───────────────

/**
 * The target vehicle — the native analogue of the web `Vehicle` prop. [updatedAt] is the ISO-8601 stamp
 * the freshness chip + stale banner read (web `vehicle.updated_at`).
 */
data class CommandCenterVehicle(
    val id: Long,
    val vin: String,
    val displayName: String,
    val model: String,
    val state: String,
    val batteryLevel: Int,
    val batteryRange: Double,
    val updatedAt: String,
) {
    /** The displayed name — web `vehicle.display_name || vehicle.vin`. */
    val name: String get() = displayName.ifBlank { vin }
}

/**
 * The live vehicle state — the native analogue of the web `VehicleState`. All quantities are SI (Phase-48):
 * [ratedRange] in metres, [insideTemp] in °C; the render boundary converts via the shared `UnitFormatter`.
 */
data class CommandCenterVehicleState(
    val batteryLevel: Int,
    val ratedRange: Double?,
    val isLocked: Boolean,
    val isCharging: Boolean,
    val isClimateOn: Boolean,
    val sentryMode: Boolean,
    val insideTemp: Double?,
    val speed: Double,
)

/** One command-log row — the native analogue of the web `CommandLogEntry`. */
data class CommandLogEntry(
    val id: Long,
    val vehicleId: Long,
    val command: String,
    val params: String,
    val status: String,
    val error: String,
    val createdAt: String,
)

/** The terminal outcome of a dispatched command — the native analogue of the web `lastResult`. */
data class CommandResultFeedback(
    val success: Boolean,
    val message: String,
)

/** A request to open one of the three command dialogs — the native analogue of the web `activeDialog`. */
data class DialogRequest(
    val kind: DialogKind,
    val command: CommandCenterCommand,
)

/** One ordered category group of commands — the native analogue of a `CATEGORY_ORDER` row's rendered group. */
data class CommandCenterCategoryGroup(
    val category: CommandCenterCategory,
    val commands: List<CommandCenterCommand>,
)

// ── Relative command age (web `timeAgo`) ─────────────────────────────────────────────────────────────

/** A bucketed relative age for a command-log entry — the native analogue of the web `timeAgo` output. */
sealed interface CommandAge {
    /** Younger than one minute — web `'just now'`. */
    data object JustNow : CommandAge

    /** `{value}m ago`. */
    data class Minutes(
        val value: Long,
    ) : CommandAge

    /** `{value}h ago`. */
    data class Hours(
        val value: Long,
    ) : CommandAge

    /** `{value}d ago`. */
    data class Days(
        val value: Long,
    ) : CommandAge
}

// ── Tile tap resolution (web tile `handleClick` / `onRequestDialog`) ──────────────────────────────────

/** The outcome of tapping a command tile — drives whether the host executes or opens a dialog. */
enum class TileTap {
    /** Run the command immediately. */
    Execute,

    /** Ask the host to open the routed dialog (input/select/confirm). */
    RequestDialog,
}

// ── Projections (the pure derivations the composable switches on) ─────────────────────────────────────

private const val MINUTES_PER_HOUR = 60L
private const val MINUTES_PER_DAY = 24L * 60L
private const val MILLIS_PER_MINUTE = 60_000L
private const val BATTERY_HALF_THRESHOLD = 50

/** Pure derivations a thin composable reads — the native mirror of the web component's pre-JSX work. */
object VehicleCommandCenterProjection {
    /** True when the vehicle is asleep/offline (web `vehicle.state === 'asleep' || 'offline'`). */
    fun isAsleep(state: String): Boolean = state == "asleep" || state == "offline"

    /** True when the battery should read green rather than amber (web `(battery_level ?? 0) > 50`). */
    fun batteryAboveHalf(level: Int?): Boolean = (level ?: 0) > BATTERY_HALF_THRESHOLD

    /**
     * Index the latest-command feed by command name (web `new Map(latestCmds.map(c => [c.command, c]))`).
     * A duplicate command keeps the last occurrence, matching the JS `Map` constructor.
     */
    fun latestByCommand(latest: List<CommandLogEntry>): Map<String, CommandLogEntry> = latest.associateBy { it.command }

    /** Bucket a non-negative age in millis into a [CommandAge] (web `timeAgo`). */
    fun commandAge(deltaMillis: Long): CommandAge {
        val minutes = (deltaMillis / MILLIS_PER_MINUTE).coerceAtLeast(0)
        return when {
            minutes < 1 -> CommandAge.JustNow
            minutes < MINUTES_PER_HOUR -> CommandAge.Minutes(minutes)
            minutes < MINUTES_PER_DAY -> CommandAge.Hours(minutes / MINUTES_PER_HOUR)
            else -> CommandAge.Days(minutes / MINUTES_PER_DAY)
        }
    }

    /**
     * The latest log entry for a command, falling back to its toggle-off twin — web
     * `cmdStatus(def.command) ?? (def.commandOff ? cmdStatus(def.commandOff) : undefined)`.
     */
    fun statusEntryFor(
        command: CommandCenterCommand,
        byCommand: Map<String, CommandLogEntry>,
    ): CommandLogEntry? = byCommand[command.command] ?: command.commandOff?.let { byCommand[it] }

    /**
     * The dialog to open for a command — web `requestDialog`: a select config wins, then an input config,
     * then a dangerous flag; otherwise no dialog (the tile executes directly).
     */
    fun dialogKindFor(command: CommandCenterCommand): DialogKind? =
        when {
            command.select != null -> DialogKind.Select
            command.input != null -> DialogKind.Input
            command.dangerous -> DialogKind.Confirm
            else -> null
        }

    /**
     * The tap outcome for a tile — it requests a dialog when one is routed ([dialogKindFor] non-null),
     * otherwise it executes. Mirrors the web tiles' `handleClick` (dangerous/input/select → dialog).
     */
    fun tileTap(command: CommandCenterCommand): TileTap = if (dialogKindFor(command) != null) TileTap.RequestDialog else TileTap.Execute

    /** Whether a toggle command currently reads "on" from the vehicle state (web `state[def.stateField]`). */
    fun toggleIsOn(
        command: CommandCenterCommand,
        state: CommandCenterVehicleState?,
    ): Boolean {
        val field = command.stateField
        if (field == null || state == null) return false
        return when (field) {
            ToggleField.IsLocked -> state.isLocked
            ToggleField.IsCharging -> state.isCharging
            ToggleField.IsClimateOn -> state.isClimateOn
            ToggleField.SentryMode -> state.sentryMode
        }
    }

    /**
     * The command sent when a toggle is tapped — its off twin when currently on, else its on command
     * (web ToggleCommandTile dispatching `isOn ? commandOff : command`). Falls back to the on command when
     * no off twin exists.
     */
    fun toggleCommandFor(
        command: CommandCenterCommand,
        state: CommandCenterVehicleState?,
    ): String = if (toggleIsOn(command, state)) command.commandOff ?: command.command else command.command

    /**
     * The search filter — web `filteredCommands`: `null` while the query is blank (favourites + category
     * groups shown), otherwise the matches on localized label, category wire name, or command name.
     */
    fun filterCommands(
        commands: List<CommandCenterCommand>,
        query: String,
        labelOf: (CommandCenterCommand) -> String,
    ): List<CommandCenterCommand>? {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return null
        val needle = trimmed.lowercase()
        return commands.filter { command ->
            labelOf(command).lowercase().contains(needle) ||
                command.category.wireName.contains(needle) ||
                command.command.contains(needle)
        }
    }

    /** The commands grouped by category in [CATEGORY_ORDER], skipping empty groups — web `commandsByCategory`. */
    fun groupedInOrder(commands: List<CommandCenterCommand>): List<CommandCenterCategoryGroup> {
        val byCategory = commands.groupBy { it.category }
        return CATEGORY_ORDER.mapNotNull { category ->
            val group = byCategory[category]
            if (group.isNullOrEmpty()) null else CommandCenterCategoryGroup(category, group)
        }
    }

    /** The favourited subset in catalogue order — web `commands.filter(c => favorites.includes(c.id))`. */
    fun favoriteCommands(
        favorites: List<String>,
        commands: List<CommandCenterCommand>,
    ): List<CommandCenterCommand> {
        if (favorites.isEmpty()) return emptyList()
        val ids = favorites.toHashSet()
        return commands.filter { it.id in ids }
    }

    /** The default-favourite ids — web `COMMANDS.filter(c => c.defaultFavorite).map(c => c.id)`. */
    fun defaultFavorites(commands: List<CommandCenterCommand>): List<String> = commands.filter { it.defaultFavorite }.map { it.id }

    /** Whether a command id is favourited (web `favorites.includes(cmdId)`). */
    fun isFavorite(
        favorites: List<String>,
        commandId: String,
    ): Boolean = commandId in favorites

    /** Toggle a command id in the favourites list — web `prev.includes(id) ? remove : add`. */
    fun toggleFavorite(
        favorites: List<String>,
        commandId: String,
    ): List<String> = if (commandId in favorites) favorites - commandId else favorites + commandId
}

/**
 * Parses an ISO-8601 timestamp (web `created_at` / `updated_at`) to epoch millis, or `null` when it does
 * not parse — the same tolerant `Instant`-then-`OffsetDateTime` fallback the sibling widget models use.
 */
fun parseTimestampMillis(iso: String): Long? =
    runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()

// ── Favourites persistence (the native localStorage analogue, keyed exactly like the web surface) ────────

private const val FAVORITES_PREFIX = "teslasync-cmd-favorites-"
private const val FAVORITES_SEPARATOR = "\n"

/** The persistence key for a vehicle's favourites — byte-for-byte the web `teslasync-cmd-favorites-${id}`. */
fun favoritesStorageKey(vehicleId: Long): String = "$FAVORITES_PREFIX$vehicleId"

/** Serializes favourite ids for storage (newline-joined; the store format is internal to the platform). */
fun serializeFavorites(ids: List<String>): String = ids.joinToString(FAVORITES_SEPARATOR)

/** Parses a stored favourites blob back to ids, dropping blanks; a `null`/blank blob yields `null`. */
fun parseFavorites(stored: String?): List<String>? {
    if (stored == null) return null
    return stored.split(FAVORITES_SEPARATOR).filter { it.isNotBlank() }
}

/**
 * A by-key favourites store — the native seam for the web `localStorage` the surface uses to persist each
 * vehicle's favourite commands. Injectable so the contract is unit-tested; the composable defaults to the
 * process-scoped [SessionCommandFavoritesStore].
 */
interface CommandFavoritesStore {
    /** The persisted favourite ids for [vehicleId], or `null` when none were ever stored. */
    fun read(vehicleId: Long): List<String>?

    /** Persists [ids] for [vehicleId]. */
    fun write(
        vehicleId: Long,
        ids: List<String>,
    )
}

/** Process-scoped [CommandFavoritesStore] backing the production composable. Thread-safe. */
object SessionCommandFavoritesStore : CommandFavoritesStore {
    private val entries = ConcurrentHashMap<Long, String>()

    override fun read(vehicleId: Long): List<String>? = parseFavorites(entries[vehicleId])

    override fun write(
        vehicleId: Long,
        ids: List<String>,
    ) {
        entries[vehicleId] = serializeFavorites(ids)
    }

    /** Clears all remembered favourites — used by instrumented tests for isolation between cases. */
    fun clear() {
        entries.clear()
    }
}
