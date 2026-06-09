using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="CommandQuickActionsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>CommandQuickActionsWidget</c>
/// renders through <c>WidgetShell</c> (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx).
/// The state is derived from the <c>useVehicles</c> read that resolves the vehicle the quick-action grid
/// commands; every branch maps onto a visible surface, none is ever hidden. <see cref="Empty"/> mirrors the
/// web <c>{id ? &lt;grid&gt; : &lt;EmptyState&gt;}</c> gate — no vehicle resolved — the "No vehicle selected"
/// surface.
/// </summary>
public enum CommandQuickActionsState
{
    /// <summary>Initial vehicles fetch with no cache — render the skeleton grid (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A vehicle resolved from a fresh (or non-stale cached) list — render the command grid.</summary>
    Loaded,

    /// <summary>No vehicle in the list (or none resolvable) — render the "No vehicle selected" empty surface.</summary>
    Empty,

    /// <summary>The list fetch failed and no cache exists — show the freshness "Error" chip over the empty grid.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render the grid plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render the grid plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>CommandQuickActionsWidget</c> hides the header and labels and shows four commands when
/// <c>cols &lt;= 1 &amp;&amp; rows &lt;= 1</c> (<see cref="IsCompact"/>), shows all eight commands when
/// <c>cols &gt;= 3</c> (<see cref="IsWide"/>), and otherwise shows six — so this footprint drives the
/// compact / wide branches and the visible-command slice.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct CommandQuickActionsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static CommandQuickActionsSize Default => new(2, 2);

    /// <summary>True for the web compact branch (<c>cols &lt;= 1 &amp;&amp; rows &lt;= 1</c>) — icon-only, no header.</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;

    /// <summary>True for the web wide branch (<c>cols &gt;= 3</c>) — all eight commands.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One quick-action command in the catalog — the native analogue of a web <c>COMMANDS</c> entry
/// (<c>{ id, command, icon, labelKey, labelFallback, color }</c>). <see cref="Glyph"/> is the Segoe Fluent
/// code point standing in for the web Lucide icon, and <see cref="AccentBrushKey"/> is the semantic design
/// token standing in for the web Tailwind colour (no ad-hoc hex in the control layer, per the engineering
/// guidelines). <see cref="Command"/> is the exact wire command string POSTed to
/// <c>/vehicles/{id}/command</c> (verified against the backend allow-list).
/// </summary>
/// <param name="Id">Stable button id (web <c>id</c>).</param>
/// <param name="Command">The wire command string (web <c>command</c>).</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="LabelKey">i18n key (web <c>labelKey</c>).</param>
/// <param name="LabelFallback">English fallback (web <c>labelFallback</c>).</param>
/// <param name="AccentBrushKey">Semantic accent token key (web Tailwind <c>color</c>).</param>
public sealed record QuickCommand(
    string Id,
    string Command,
    string Glyph,
    string LabelKey,
    string LabelFallback,
    string AccentBrushKey);

/// <summary>
/// The eight quick-action commands, in the exact web <c>COMMANDS</c> order
/// (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx). The size-driven slice mirrors the web
/// <c>isCompact ? COMMANDS.slice(0, 4) : isWide ? COMMANDS : COMMANDS.slice(0, 6)</c> selection. The wire
/// command strings (<c>actuate_frunk</c>, <c>honk_horn</c>, <c>flash_lights</c>, <c>actuate_trunk</c>, …)
/// are verified against the backend command allow-list (internal/api/command/handler.go).
/// </summary>
public static class CommandCatalog
{
    // Segoe Fluent Icons code points (web Lucide icon → nearest platform glyph).
    private const string LockGlyph = "\uE72E";        // Lock (web Lock)
    private const string UnlockGlyph = "\uE785";      // Unlock (web Unlock)
    private const string TemperatureGlyph = "\uE9CA"; // Temperature (web Thermometer)
    private const string FrigidGlyph = "\uEB3A";      // Frigid (web ThermometerSnowflake)
    private const string CarGlyph = "\uE804";         // Car (web Container — front cargo)
    private const string VolumeGlyph = "\uE767";      // Volume (web Volume2)
    private const string LightbulbGlyph = "\uEA80";   // Lightbulb (web Flashlight)
    private const string HatchGlyph = "\uE8D7";       // Door/hatch (web Container — rear cargo)

    // Semantic accent tokens (web neon/Tailwind colour → nearest design token).
    private const string Success = "TsColorSuccessBrush"; // web text-neon-green
    private const string Danger = "TsColorDangerBrush";   // web text-neon-red
    private const string Info = "TsColorInfoBrush";       // web text-neon-cyan / text-blue-400
    private const string Accent = "TsColorAccentBrush";   // web text-purple-400 / text-indigo-400
    private const string Warning = "TsColorWarningBrush"; // web text-amber-400 / text-yellow-400

    /// <summary>The full, ordered catalog (web <c>COMMANDS</c>).</summary>
    public static IReadOnlyList<QuickCommand> All { get; } = new[]
    {
        new QuickCommand("lock", "lock", LockGlyph, "widget.quickActions.lock", "Lock", Success),
        new QuickCommand("unlock", "unlock", UnlockGlyph, "widget.quickActions.unlock", "Unlock", Danger),
        new QuickCommand("climate_on", "climate_on", TemperatureGlyph, "widget.quickActions.climateOn", "Climate On", Info),
        new QuickCommand("climate_off", "climate_off", FrigidGlyph, "widget.quickActions.climateOff", "Climate Off", Info),
        new QuickCommand("frunk", "actuate_frunk", CarGlyph, "widget.quickActions.frunk", "Frunk", Accent),
        new QuickCommand("honk", "honk_horn", VolumeGlyph, "widget.quickActions.horn", "Horn", Warning),
        new QuickCommand("flash", "flash_lights", LightbulbGlyph, "widget.quickActions.flash", "Flash", Warning),
        new QuickCommand("trunk", "actuate_trunk", HatchGlyph, "widget.quickActions.trunk", "Trunk", Accent),
    };

    /// <summary>
    /// The commands visible for <paramref name="size"/> — the native port of the web
    /// <c>isCompact ? COMMANDS.slice(0, 4) : isWide ? COMMANDS : COMMANDS.slice(0, 6)</c> selection.
    /// </summary>
    public static IReadOnlyList<QuickCommand> Visible(CommandQuickActionsSize size)
    {
        int take = size.IsCompact ? 4 : size.IsWide ? All.Count : 6;
        if (take >= All.Count)
        {
            return All;
        }

        var slice = new QuickCommand[take];
        for (int i = 0; i < take; i++)
        {
            slice[i] = All[i];
        }

        return slice;
    }
}

/// <summary>
/// The vehicle the quick-action grid commands — the native analogue of the web
/// <c>id = vehicleId ?? vehicles?.[0]?.id ?? 0</c> resolution. A non-null reading means the grid is enabled
/// (web truthy <c>id</c>); a null <see cref="Resolve(JsonElement, long?)"/> result models <c>id === 0</c>
/// (the "No vehicle selected" empty surface). <see cref="DisplayName"/> is carried for the Narrator summary
/// and may be empty when the list row omitted it.
/// </summary>
/// <param name="VehicleId">The resolved vehicle id (always &gt; 0 for a non-null reading).</param>
/// <param name="DisplayName">The vehicle display name, or the empty string when unknown.</param>
public sealed record CommandQuickActionsReading(long VehicleId, string DisplayName)
{
    /// <summary>
    /// Resolve the vehicle the grid should command from a <c>GET /vehicles</c> response, mirroring the web
    /// <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>: an explicit <paramref name="explicitVehicleId"/> wins
    /// (the web <c>vehicleId</c> prop), otherwise the first list entry's id is used. Returns
    /// <see langword="null"/> when neither resolves a positive id (web <c>id === 0</c> → the empty surface).
    /// Tolerates both a bare vehicle array and a <c>{ "vehicles": [...] }</c> envelope, and numeric-string ids.
    /// </summary>
    public static CommandQuickActionsReading? Resolve(JsonElement root, long? explicitVehicleId)
    {
        var vehicles = AsVehicleArray(root);

        if (explicitVehicleId is { } explicitId && explicitId > 0)
        {
            return new CommandQuickActionsReading(explicitId, FindDisplayName(vehicles, explicitId));
        }

        if (vehicles is { ValueKind: JsonValueKind.Array } array && array.GetArrayLength() > 0)
        {
            var first = array[0];
            long id = ReadId(first);
            if (id > 0)
            {
                return new CommandQuickActionsReading(id, ReadString(first, "display_name") ?? string.Empty);
            }
        }

        return null;
    }

    private static JsonElement? AsVehicleArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return root;
        }

        // Defensive: tolerate a { "vehicles": [...] } envelope even though the API returns a bare array.
        if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("vehicles", out var nested)
            && nested.ValueKind == JsonValueKind.Array)
        {
            return nested;
        }

        return null;
    }

    private static string FindDisplayName(JsonElement? vehicles, long vehicleId)
    {
        if (vehicles is { ValueKind: JsonValueKind.Array } array)
        {
            foreach (var vehicle in array.EnumerateArray())
            {
                if (ReadId(vehicle) == vehicleId)
                {
                    return ReadString(vehicle, "display_name") ?? string.Empty;
                }
            }
        }

        return string.Empty;
    }

    private static long ReadId(JsonElement vehicle)
    {
        if (vehicle.ValueKind != JsonValueKind.Object || !vehicle.TryGetProperty("id", out var idValue))
        {
            return 0;
        }

        return idValue.ValueKind switch
        {
            JsonValueKind.Number when idValue.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(idValue.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}

/// <summary>
/// One render-ready command tile — the projected button the view renders. Pure data so the projection is
/// unit-tested without a UI host. <see cref="Label"/> and <see cref="AutomationName"/> are already resolved
/// through the i18n facade (web <c>t(labelKey, labelFallback)</c>, also the button <c>aria-label</c>).
/// </summary>
/// <param name="Id">Stable button id (web <c>id</c>).</param>
/// <param name="Command">The wire command string POSTed when tapped.</param>
/// <param name="Glyph">Segoe Fluent glyph.</param>
/// <param name="Label">Localized label (hidden in the compact branch).</param>
/// <param name="AccentBrushKey">Semantic accent token key for the glyph tint.</param>
/// <param name="AutomationName">Narrator name (the localized label — web <c>aria-label</c>).</param>
public sealed record CommandTile(
    string Id,
    string Command,
    string Glyph,
    string Label,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready quick-action grid for one footprint — the native analogue of the
/// command tiles the web component maps over after slicing by size. Pure data; the per-tile running spinner
/// and the disable-all-while-busy state are layered on at render time from the view-model's
/// <see cref="CommandQuickActionsViewModel.ActiveCommand"/>.
/// </summary>
/// <param name="Tiles">The visible command tiles, in catalog order.</param>
/// <param name="IsCompact">Whether the compact branch is active (icon-only, no header).</param>
/// <param name="IsWide">Whether the wide branch is active (all eight commands).</param>
/// <param name="Columns">The grid column count for the footprint (web responsive grid).</param>
public sealed record CommandQuickActionsDisplay(
    IReadOnlyList<CommandTile> Tiles,
    bool IsCompact,
    bool IsWide,
    int Columns);

/// <summary>
/// Pure projection from a footprint to the render-ready <see cref="CommandQuickActionsDisplay"/> — the native
/// port of the web component's size-driven command slice + responsive grid columns + per-command
/// <c>t(labelKey, labelFallback)</c> label resolution. Every label resolves through the i18n facade; no
/// English literal reaches the view.
/// </summary>
public static class CommandQuickActionsProjection
{
    /// <summary>Segoe Fluent "LightningBolt" glyph — the web header / empty-state <c>Zap</c> icon.</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Project the visible command tiles for <paramref name="size"/>, resolving every label via the localizer.</summary>
    public static CommandQuickActionsDisplay Project(CommandQuickActionsSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var commands = CommandCatalog.Visible(size);
        var tiles = new List<CommandTile>(commands.Count);
        foreach (var command in commands)
        {
            string label = localizer.GetString(command.LabelKey, command.LabelFallback);
            tiles.Add(new CommandTile(
                command.Id,
                command.Command,
                command.Glyph,
                label,
                command.AccentBrushKey,
                label));
        }

        return new CommandQuickActionsDisplay(tiles, size.IsCompact, size.IsWide, Columns(size));
    }

    /// <summary>The grid column count for <paramref name="size"/> — compact 2, wide 4, otherwise 3 (web responsive grid).</summary>
    public static int Columns(CommandQuickActionsSize size) =>
        size.IsCompact ? 2 : size.IsWide ? 4 : 3;
}

/// <summary>
/// The result of a quick-action command POST — the native mirror of the web <c>CommandResult</c>
/// (<c>{ success, message }</c>). The backend returns <c>{ success, result | error }</c> with no
/// <c>message</c> field, so — exactly like the web's <c>data.message || 'Command sent successfully'</c> /
/// <c>data.message || 'Command failed'</c> — <see cref="Message"/> is normally empty and the view-model
/// substitutes the localized fallback. Kept pure so the parse is unit-tested without a network.
/// </summary>
/// <param name="Success">Whether the command was accepted (web <c>data.success</c>).</param>
/// <param name="Message">The optional server message (web <c>data.message</c>; normally absent).</param>
public sealed record CommandResult(bool Success, string Message)
{
    /// <summary>Parse a command POST response. A non-object body, or one without <c>success</c>, reads as a failure.</summary>
    public static CommandResult FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return new CommandResult(false, string.Empty);
        }

        bool success = root.TryGetProperty("success", out var s) && s.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when s.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(s.GetString(), out var b) && b,
            _ => false,
        };

        string message = root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String
            ? m.GetString() ?? string.Empty
            : string.Empty;

        return new CommandResult(success, message);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> vehicle-list emissions onto resolved
/// <c>RepositoryResult&lt;CommandQuickActionsReading&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline). A successful emission that resolves no vehicle collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>id === 0</c> empty surface.
/// Kept pure so the resolve-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class CommandQuickActionsResultMapper
{
    /// <summary>Resolve <paramref name="raw"/>'s vehicle (honouring <paramref name="explicitVehicleId"/>) and preserve the load status.</summary>
    public static RepositoryResult<CommandQuickActionsReading> Map(RepositoryResult<JsonElement> raw, long? explicitVehicleId)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CommandQuickActionsReading? Resolve() =>
            raw.HasValue ? CommandQuickActionsReading.Resolve(raw.Value, explicitVehicleId) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CommandQuickActionsReading>.Loading(),
            LoadStatus.Cached => Resolve() is { } cached
                ? RepositoryResult<CommandQuickActionsReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<CommandQuickActionsReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Resolve() is { } refreshing
                ? RepositoryResult<CommandQuickActionsReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<CommandQuickActionsReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Resolve() is { } loaded
                ? RepositoryResult<CommandQuickActionsReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<CommandQuickActionsReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<CommandQuickActionsReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Resolve() is { } offline
                ? RepositoryResult<CommandQuickActionsReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<CommandQuickActionsReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<CommandQuickActionsReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
