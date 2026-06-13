using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>CommandHistoryPage</c> surface — the native mirror of the
/// four data states the web page renders (web/src/features/system/pages/CommandHistoryPage.tsx). The web page
/// runs one <c>useCommandHistory</c> query and renders, in precedence order, the <c>PageContainer</c> loading
/// scaffold, then the failure surface (<c>error</c>), then the timeline's own
/// <c>filtered.length &gt; 0 ? Timeline : EmptyState</c> branch. This enum is the top-level summary the
/// ledger / Narrator key off; per-region visibility is still driven by the projected flags so the failure banner
/// can sit above any timeline branch exactly as the web composes them.
/// </summary>
public enum CommandHistoryState
{
    /// <summary>The command-history query is in flight with no rows yet (web <c>PageContainer loading</c>).</summary>
    Loading,

    /// <summary>The query resolved with no commands for the current filters (web <c>filtered.length === 0</c>).</summary>
    Empty,

    /// <summary>The query failed (web <c>error</c>) — the failure banner is shown above the timeline.</summary>
    Error,

    /// <summary>The query produced at least one command row (web <c>filtered.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>The status filter the timeline is scoped to — the native union of the web <c>STATUS_FILTERS</c>.</summary>
public enum CommandStatusFilter
{
    /// <summary>All commands (web <c>'all'</c>).</summary>
    All,

    /// <summary>Only successful commands (web <c>'success'</c>).</summary>
    Success,

    /// <summary>Only failed commands (web <c>'failed'</c>).</summary>
    Failed,
}

/// <summary>Small null-tolerant JSON readers shared by the command-log / vehicle parsers (UI-free, unit-tested).</summary>
internal static class CommandHistoryJsonReaders
{
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long Id(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }
}

/// <summary>
/// One command-log entry from <c>GET /vehicles/{vehicleID}/commands/history</c> — the native mirror of the web
/// <c>CommandLogEntry</c> (web/src/api/hooks/useCommands.ts). Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant so a partial row never throws. The raw wire timestamp is kept (as the web
/// does) and parsed on demand via <see cref="CreatedAtTime"/>. Pure data — no WinUI types — so the projection
/// is unit-tested without a UI host.
/// </summary>
public sealed record CommandLogEntry(
    long Id,
    long VehicleId,
    string? Command,
    string? Params,
    string? Status,
    string? Error,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET …/commands/history</c> JSON array into a tolerant list of entries.</summary>
    public static IReadOnlyList<CommandLogEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CommandLogEntry>();
        }

        var list = new List<CommandLogEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single command-log JSON object into a <see cref="CommandLogEntry"/>.</summary>
    public static CommandLogEntry FromJson(JsonElement o) => new(
        Id: CommandHistoryJsonReaders.Id(o, "id"),
        VehicleId: CommandHistoryJsonReaders.Id(o, "vehicle_id"),
        Command: CommandHistoryJsonReaders.Str(o, "command"),
        Params: CommandHistoryJsonReaders.Str(o, "params"),
        Status: CommandHistoryJsonReaders.Str(o, "status"),
        Error: CommandHistoryJsonReaders.Str(o, "error"),
        CreatedAt: CommandHistoryJsonReaders.Str(o, "created_at") ?? CommandHistoryJsonReaders.Str(o, "createdAt"));

    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One fleet entry from <c>GET /vehicles</c> that fills the page's vehicle picker — the native mirror of the web
/// <c>useSelectedVehicle</c> fleet list (<c>vehicleId ?? vehicles?.[0]?.id</c>). Only the fields the picker renders
/// are projected (id + display name); parsing is null-tolerant.
/// </summary>
public sealed record CommandHistoryVehicle(long Id, string? DisplayName)
{
    /// <summary>The picker label (web <c>v.display_name || `Vehicle ${v.id}`</c>).</summary>
    public string Label => string.IsNullOrWhiteSpace(DisplayName)
        ? string.Create(CultureInfo.CurrentCulture, $"Vehicle {Id}")
        : DisplayName!;

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into a tolerant list of fleet entries.</summary>
    public static IReadOnlyList<CommandHistoryVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CommandHistoryVehicle>();
        }

        var list = new List<CommandHistoryVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new CommandHistoryVehicle(
                    CommandHistoryJsonReaders.Id(item, "id"),
                    CommandHistoryJsonReaders.Str(item, "display_name") ?? CommandHistoryJsonReaders.Str(item, "displayName")));
            }
        }

        return list;
    }
}

/// <summary>
/// The render-time data model the <see cref="CommandHistoryPageViewModel"/> builds for the projection — the union
/// of the resolved <c>useCommandHistory</c> payload and the web URL state (selected vehicle, status filter, search
/// query, page). Pure data so the projection is asserted headlessly.
/// </summary>
public sealed record CommandHistoryModel(
    IReadOnlyList<CommandHistoryVehicle> Vehicles,
    long? SelectedVehicleId,
    IReadOnlyList<CommandLogEntry> Commands,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    CommandStatusFilter StatusFilter,
    string SearchQuery,
    bool IsSearchPending,
    int Page,
    int PageSize);

/// <summary>One projected stat tile (web <c>StatCard</c>).</summary>
public sealed record CommandStatCardDisplay(string Label, string Value, string Glyph, string AutomationName);

/// <summary>One projected vehicle picker option (web <c>ControlSelect</c> option).</summary>
public sealed record CommandVehicleOption(long Id, string Label);

/// <summary>One projected status-filter tab (web <c>TabNav</c> tab).</summary>
public sealed record CommandStatusTabDisplay(CommandStatusFilter Key, string Label, string Glyph, bool IsActive);

/// <summary>
/// One projected, render-ready timeline row — the native analogue of a web Timeline <c>item</c> (icon + title +
/// subtitle + relative time + color). Pure data; the WinUI view maps it onto a severity-coloured timeline marker.
/// </summary>
public sealed record CommandTimelineRowDisplay(
    long Id,
    string Title,
    string Subtitle,
    DateTimeOffset? Timestamp,
    string Severity,
    string Glyph,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every value formatted at the display
/// boundary. Holds all six panels (the four stat tiles, the filters region and the timeline region), the four
/// data-state flags and the pagination chrome. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record CommandHistoryDisplay(
    CommandHistoryState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool HasError,
    string ErrorBannerText,
    string BackToCommandsLabel,
    string SelectVehicleLabel,
    IReadOnlyList<CommandVehicleOption> VehicleOptions,
    long? SelectedVehicleId,
    IReadOnlyList<CommandStatCardDisplay> StatCards,
    IReadOnlyList<CommandStatusTabDisplay> StatusTabs,
    string SearchPlaceholder, // parity:allow projected web search-input placeholder string (commandHistory.searchPlaceholder)
    string SearchAria,
    string SearchQuery,
    bool IsSearchPending,
    string SearchPendingLabel,
    string TimelineTitle,
    string ShowingText,
    bool ShowTimeline,
    IReadOnlyList<CommandTimelineRowDisplay> TimelineRows,
    bool ShowEmpty,
    string EmptyMessage,
    bool ShowPagination,
    int Page,
    int PageSize,
    int FilteredTotal,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="CommandHistoryModel"/> to its <see cref="CommandHistoryDisplay"/> — the native
/// port of the render logic in web/src/features/system/pages/CommandHistoryPage.tsx. Every visible literal resolves
/// through the i18n facade using the exact web key names; the stats (24h count, success rate, most-used,
/// last-sent) are computed from the full history exactly as the web <c>useMemo</c> does; timestamps format through
/// <see cref="DateTimeFormatting"/> so the C# output matches the web truth. No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class CommandHistoryProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    private const string Separator = " \u00b7 ";

    // Segoe Fluent Icons glyphs standing in for the web lucide stat-card / tab icons.
    private const string GlyphTerminal = "\uE756";  // CommandPrompt (web Terminal)
    private const string GlyphTrending = "\uE9D2";  // Health / trend (web TrendingUp)
    private const string GlyphAward = "\uE735";     // FavoriteStar (web Award)
    private const string GlyphClock = "\uE823";     // Clock (web Clock)
    private const string GlyphCheck = "\uE930";     // Completed (web CheckCircle)
    private const string GlyphError = "\uEA39";     // ErrorBadge (web XCircle)

    /// <summary>
    /// The native port of the web page's <c>COMMAND_LABELS</c> map — friendly display names for the known Tesla
    /// command identifiers. Anything not present falls back to the title-cased identifier
    /// (<see cref="FormatCommandName"/>), exactly as the web <c>formatCommandName</c> does.
    /// </summary>
    public static IReadOnlyDictionary<string, string> CommandLabels { get; } = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["lock"] = "Lock",
        ["unlock"] = "Unlock",
        ["wake_up"] = "Wake Up",
        ["climate_on"] = "Climate ON",
        ["climate_off"] = "Climate OFF",
        ["honk_horn"] = "Honk Horn",
        ["flash_lights"] = "Flash Lights",
        ["charge_start"] = "Start Charging",
        ["charge_stop"] = "Stop Charging",
        ["set_charge_limit"] = "Set Charge Limit",
        ["set_temps"] = "Set Temperature",
        ["actuate_trunk"] = "Open/Close Trunk",
        ["actuate_frunk"] = "Open Frunk",
        ["window_control"] = "Window Control",
        ["sun_roof_control"] = "Sunroof Control",
        ["remote_start_drive"] = "Remote Start",
        ["set_sentry_mode"] = "Sentry Mode",
        ["set_speed_limit"] = "Speed Limit",
        ["clear_speed_limit"] = "Clear Speed Limit",
        ["set_valet_mode"] = "Valet Mode",
        ["reset_valet_pin"] = "Reset Valet PIN",
        ["schedule_software_update"] = "Schedule Update",
        ["cancel_software_update"] = "Cancel Update",
        ["media_toggle_playback"] = "Media Play/Pause",
        ["media_next_track"] = "Next Track",
        ["media_prev_track"] = "Previous Track",
        ["media_volume_up"] = "Volume Up",
        ["media_volume_down"] = "Volume Down",
        ["adjust_volume"] = "Adjust Volume",
        ["navigation_request"] = "Navigate",
        ["share"] = "Share to Vehicle",
        ["trigger_homelink"] = "Trigger HomeLink",
        ["set_bioweapon_mode"] = "Bioweapon Defense",
        ["set_climate_keeper"] = "Climate Keeper",
        ["set_cop_temp"] = "Cabin Overheat Protection",
        ["dog_mode_on"] = "Dog Mode ON",
        ["dog_mode_off"] = "Dog Mode OFF",
        ["camp_mode_on"] = "Camp Mode ON",
        ["camp_mode_off"] = "Camp Mode OFF",
        ["set_scheduled_departure"] = "Scheduled Departure",
        ["set_scheduled_charging"] = "Scheduled Charging",
        ["set_preconditioning_max"] = "Max Preconditioning",
        ["auto_conditioning_start"] = "Start Preconditioning",
        ["auto_conditioning_stop"] = "Stop Preconditioning",
        ["remote_seat_heater_request"] = "Seat Heater",
        ["remote_seat_cooler_request"] = "Seat Cooler",
        ["remote_steering_wheel_heater_request"] = "Steering Wheel Heater",
        ["close_charge_port"] = "Close Charge Port",
        ["open_charge_port"] = "Open Charge Port",
        ["set_pin_to_drive"] = "PIN to Drive",
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + URL state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for the 24h window and relative-time formatting.</param>
    public static CommandHistoryDisplay Project(CommandHistoryModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("commandHistory.title", "Command History");
        string subtitle = localizer.GetString("commandHistory.subtitle", "Audit log of all vehicle commands");

        var all = model.Commands ?? Array.Empty<CommandLogEntry>();

        // ── Failure banner (web error) ────────────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorBanner = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? string.Create(CultureInfo.CurrentCulture, $"{loadFailed}: {model.ErrorDetail}")
            : loadFailed;

        // ── Stats (web useMemo over the FULL history, not the filtered slice) ──────────────────────────
        var stats = ComputeStats(all, now);
        var statCards = BuildStatCards(stats, localizer, now);

        // ── Vehicle picker (web useSelectedVehicle) ────────────────────────────────────────────────────
        var vehicleOptions = (model.Vehicles ?? Array.Empty<CommandHistoryVehicle>())
            .Select(v => new CommandVehicleOption(v.Id, v.Label))
            .ToList();

        // ── Filters (web TabNav + search) ──────────────────────────────────────────────────────────────
        var statusTabs = BuildStatusTabs(model.StatusFilter, localizer);
        string searchQuery = model.SearchQuery ?? string.Empty;

        // ── Filtered + paginated rows (web filtered/paginatedCommands useMemo) ─────────────────────────
        var filtered = ApplyFilters(all, model.StatusFilter, searchQuery);
        int page = Math.Max(1, model.Page);
        int pageSize = model.PageSize > 0 ? model.PageSize : CommandHistoryRegistration.PageSize;
        var paginated = filtered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(c => BuildTimelineRow(c, now))
            .ToList();

        bool hasRows = filtered.Count > 0;
        bool showLoading = model.Loading && all.Count == 0;

        // ── Timeline header (web timelineTitle + showing count) ────────────────────────────────────────
        string timelineTitle = localizer.GetString("commandHistory.timelineTitle", "Command Timeline");
        string showingText = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("commandHistory.showing", "{0} commands"),
            filtered.Count);

        // ── Empty state (web noFilterResults / noCommands) ─────────────────────────────────────────────
        bool hasActiveFilter = !string.IsNullOrEmpty(searchQuery) || model.StatusFilter != CommandStatusFilter.All;
        string emptyMessage = hasActiveFilter
            ? localizer.GetString("commandHistory.noFilterResults", "No commands match the current filters")
            : localizer.GetString("commandHistory.noCommands", "No commands have been sent yet");

        var state = ResolveState(model, hasRows);

        return new CommandHistoryDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: showLoading,
            HasError: model.HasError,
            ErrorBannerText: errorBanner,
            BackToCommandsLabel: localizer.GetString("commandHistory.backToCommands", "Commands"),
            SelectVehicleLabel: localizer.GetString("commandHistory.selectVehicle", "Select vehicle"),
            VehicleOptions: vehicleOptions,
            SelectedVehicleId: model.SelectedVehicleId,
            StatCards: statCards,
            StatusTabs: statusTabs,
            SearchPlaceholder: localizer.GetString("commandHistory.searchPlaceholder", "Search commands\u2026"), // parity:allow required web i18n key commandHistory.searchPlaceholder
            SearchAria: localizer.GetString("commandHistory.searchCommands", "Search commands"),
            SearchQuery: searchQuery,
            IsSearchPending: model.IsSearchPending,
            SearchPendingLabel: localizer.GetString("filter.pending", "Filtering\u2026"),
            TimelineTitle: timelineTitle,
            ShowingText: showingText,
            ShowTimeline: hasRows,
            TimelineRows: paginated,
            ShowEmpty: !hasRows,
            EmptyMessage: emptyMessage,
            ShowPagination: filtered.Count > pageSize,
            Page: page,
            PageSize: pageSize,
            FilteredTotal: filtered.Count,
            AutomationName: string.Create(CultureInfo.CurrentCulture, $"{title}. {subtitle}"));
    }

    /// <summary>
    /// Resolve a raw command identifier to its display name — the native port of the web <c>formatCommandName</c>
    /// (<c>COMMAND_LABELS[cmd] ?? cmd.replace(/_/g, ' ').replace(/\b\w/g, c =&gt; c.toUpperCase())</c>): a known
    /// identifier maps through <see cref="CommandLabels"/>, otherwise underscores become spaces and the first
    /// ASCII word-character of each run is upper-cased. A <see langword="null"/> command collapses to the em-dash.
    /// </summary>
    public static string FormatCommandName(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return EmDash;
        }

        if (CommandLabels.TryGetValue(raw, out var label))
        {
            return label;
        }

        var chars = raw.ToCharArray();
        bool atWordStart = true;
        for (int i = 0; i < chars.Length; i++)
        {
            char c = chars[i];
            if (c == '_')
            {
                chars[i] = ' ';
                atWordStart = true;
                continue;
            }

            if (IsAsciiWord(c))
            {
                if (atWordStart)
                {
                    chars[i] = char.ToUpperInvariant(c);
                }

                atWordStart = false;
            }
            else
            {
                atWordStart = true;
            }
        }

        return new string(chars);
    }

    /// <summary>
    /// Build the timeline-row subtitle — the native port of the web <c>buildSubtitle</c>: the parsed
    /// <c>params</c> key/value pairs (or the raw params on parse failure), then any <c>error</c>, falling back to
    /// the absolute timestamp when neither is present, joined with " · ".
    /// </summary>
    public static string BuildSubtitle(CommandLogEntry cmd, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(cmd);

        var parts = new List<string>();

        if (!string.IsNullOrEmpty(cmd.Params) && cmd.Params != "{}")
        {
            string? formatted = TryFormatParams(cmd.Params);
            if (formatted is not null)
            {
                parts.Add(formatted);
            }
        }

        if (!string.IsNullOrEmpty(cmd.Error))
        {
            parts.Add(string.Create(CultureInfo.CurrentCulture, $"Error: {cmd.Error}"));
        }

        if (parts.Count == 0)
        {
            parts.Add(DateTimeFormatting.Format(cmd.CreatedAtTime, DateTimeVariant.Full, now));
        }

        return string.Join(Separator, parts);
    }

    private static CommandStats ComputeStats(IReadOnlyList<CommandLogEntry> all, DateTimeOffset now)
    {
        int total24h = 0;
        int successCount = 0;
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var dayAgo = now.AddDays(-1);

        foreach (var c in all)
        {
            if (c.CreatedAtTime is { } ts && ts > dayAgo)
            {
                total24h++;
            }

            if (c.Status == "success")
            {
                successCount++;
            }

            if (!string.IsNullOrEmpty(c.Command))
            {
                counts.TryGetValue(c.Command!, out var n);
                counts[c.Command!] = n + 1;
            }
        }

        int successRate = all.Count > 0
            ? (int)Math.Round(successCount * 100.0 / all.Count, MidpointRounding.AwayFromZero)
            : 0;

        string? mostUsed = null;
        int best = -1;
        foreach (var pair in counts)
        {
            if (pair.Value > best)
            {
                best = pair.Value;
                mostUsed = pair.Key;
            }
        }

        // Web parity: lastCommand is allCommands[0] (the API returns newest-first).
        CommandLogEntry? last = all.Count > 0 ? all[0] : null;
        return new CommandStats(total24h, successRate, mostUsed, last);
    }

    private static List<CommandStatCardDisplay> BuildStatCards(
        CommandStats stats, ILocalizer localizer, DateTimeOffset now)
    {
        string mostUsedValue = stats.MostUsed is null ? EmDash : FormatCommandName(stats.MostUsed);
        string lastSentValue = stats.LastCommand is null
            ? EmDash
            : DateTimeFormatting.Format(stats.LastCommand.CreatedAtTime, DateTimeVariant.Relative, now);

        string total24hLabel = localizer.GetString("commandHistory.total24h", "Commands (24h)");
        string successRateLabel = localizer.GetString("commandHistory.successRate", "Success Rate");
        string mostUsedLabel = localizer.GetString("commandHistory.mostUsed", "Most Used");
        string lastSentLabel = localizer.GetString("commandHistory.lastSent", "Last Sent");

        string total24hValue = stats.Total24h.ToString(CultureInfo.CurrentCulture);
        string successRateValue = string.Create(CultureInfo.CurrentCulture, $"{stats.SuccessRate}%");

        return new List<CommandStatCardDisplay>(4)
        {
            new(total24hLabel, total24hValue, GlyphTerminal, string.Create(CultureInfo.CurrentCulture, $"{total24hLabel}: {total24hValue}")),
            new(successRateLabel, successRateValue, GlyphTrending, string.Create(CultureInfo.CurrentCulture, $"{successRateLabel}: {successRateValue}")),
            new(mostUsedLabel, mostUsedValue, GlyphAward, string.Create(CultureInfo.CurrentCulture, $"{mostUsedLabel}: {mostUsedValue}")),
            new(lastSentLabel, lastSentValue, GlyphClock, string.Create(CultureInfo.CurrentCulture, $"{lastSentLabel}: {lastSentValue}")),
        };
    }

    private static List<CommandStatusTabDisplay> BuildStatusTabs(CommandStatusFilter active, ILocalizer localizer)
    {
        return new List<CommandStatusTabDisplay>(3)
        {
            new(CommandStatusFilter.All, localizer.GetString("commandHistory.filterAll", "All"), GlyphTerminal, active == CommandStatusFilter.All),
            new(CommandStatusFilter.Success, localizer.GetString("commandHistory.filterSuccess", "Success"), GlyphCheck, active == CommandStatusFilter.Success),
            new(CommandStatusFilter.Failed, localizer.GetString("commandHistory.filterFailed", "Failed"), GlyphError, active == CommandStatusFilter.Failed),
        };
    }

    private static IReadOnlyList<CommandLogEntry> ApplyFilters(
        IReadOnlyList<CommandLogEntry> all, CommandStatusFilter statusFilter, string searchQuery)
    {
        IEnumerable<CommandLogEntry> result = all;

        if (statusFilter != CommandStatusFilter.All)
        {
            string wanted = statusFilter == CommandStatusFilter.Success ? "success" : "failed";
            result = result.Where(c => c.Status == wanted);
        }

        string q = searchQuery.Trim();
        if (q.Length > 0)
        {
            string lowered = q.ToLowerInvariant();
            result = result.Where(c =>
                (c.Command is { } cmd && cmd.ToLowerInvariant().Contains(lowered, StringComparison.Ordinal)) ||
                FormatCommandName(c.Command).ToLowerInvariant().Contains(lowered, StringComparison.Ordinal));
        }

        return ReferenceEquals(result, all) ? all : result.ToList();
    }

    private static CommandTimelineRowDisplay BuildTimelineRow(CommandLogEntry cmd, DateTimeOffset now)
    {
        bool success = cmd.Status == "success";
        string title = FormatCommandName(cmd.Command);
        string subtitle = BuildSubtitle(cmd, now);
        string relative = DateTimeFormatting.Format(cmd.CreatedAtTime, DateTimeVariant.Relative, now);
        string severity = success ? "success" : "critical";
        string glyph = success ? GlyphCheck : GlyphError;
        string brush = success ? "TsColorSuccessBrush" : "TsColorDangerBrush";
        string automation = string.Create(CultureInfo.CurrentCulture, $"{title}. {subtitle}. {relative}");

        return new CommandTimelineRowDisplay(cmd.Id, title, subtitle, cmd.CreatedAtTime, severity, glyph, brush, automation);
    }

    private static CommandHistoryState ResolveState(CommandHistoryModel model, bool hasRows)
    {
        if (model.HasError && model.Commands.Count == 0)
        {
            return CommandHistoryState.Error;
        }

        if (model.Loading && model.Commands.Count == 0)
        {
            return CommandHistoryState.Loading;
        }

        return hasRows ? CommandHistoryState.Success : CommandHistoryState.Empty;
    }

    private static string? TryFormatParams(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return raw;
            }

            var pairs = new List<string>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                pairs.Add(string.Create(CultureInfo.CurrentCulture, $"{prop.Name}: {ScalarText(prop.Value)}"));
            }

            return pairs.Count > 0 ? string.Join(", ", pairs) : null;
        }
        catch (JsonException)
        {
            return raw;
        }
    }

    private static string ScalarText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => value.GetRawText(),
    };

    private static bool IsAsciiWord(char c) =>
        c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9');

    private sealed record CommandStats(int Total24h, int SuccessRate, string? MostUsed, CommandLogEntry? LastCommand);
}

/// <summary>
/// Canonical registry metadata for the Command History page surface — the navigation route name, page size and the
/// generated operation ids the client feed binds to. Mirrors the web route <c>/command-history</c> and the
/// <c>useCommandHistory</c> hook's <c>limit=200</c> page-size.
/// </summary>
public static class CommandHistoryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CommandHistoryPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>CommandHistory</c>).</summary>
    public const string RouteName = "CommandHistory";

    /// <summary>The timeline page size (web <c>PAGE_SIZE</c>).</summary>
    public const int PageSize = 25;

    /// <summary>The history fetch limit (web <c>useCommandHistory</c> <c>?limit=200</c>).</summary>
    public const int HistoryLimit = 200;

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useSelectedVehicle</c> fleet list).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles/{vehicleID}/commands/history</c>.</summary>
    public const string HistoryOperation = "get_api_v1_vehicles_vehicleID_commands_history";

    /// <summary>The path-parameter name in the history operation template.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>The localized page title (web <c>commandHistory.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("commandHistory.title", "Command History");
    }

    /// <summary>The localized page subtitle (web <c>commandHistory.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("commandHistory.subtitle", "Audit log of all vehicle commands");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>CommandHistoryPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a command name, status, VIN or vehicle id —
/// so a diagnostics line can never leak what a driver did to their car. Thread-safe.
/// </summary>
public sealed class CommandHistoryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CommandHistoryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandHistoryPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={CommandHistoryRegistration.Slug}"));
    }
}
