using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the CommandHistoryWidget's UI-thread-free logic — the JSON parse adapter, the
/// status→presentation maps (feed glyph/brush + compact badge tone/label), the <c>formatCommandName</c>
/// title-caser, the projection (compact last-command chip / feed sort + cap + subtitle + relative time +
/// a11y), the cache-then-network result mapper, the footprint flags, the registry metadata, the
/// diagnostics, the per-vehicle source adapter (vehicle resolution + path/query params + empty
/// short-circuit), and the state-holder view-model's per-state transitions (loading / loaded / empty /
/// error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/CommandHistoryWidget.tsx).
/// </summary>
public sealed class CommandHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static CommandLogEntry Cmd(
        long id = 1,
        string? command = "wake_up",
        string? status = "success",
        string? createdAt = "2026-06-06T12:00:00Z") =>
        new(id, command, status, createdAt);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_array()
    {
        const string json = """
        [
          {"id":1,"vehicle_id":7,"command":"wake_up","params":"{}","status":"success","error":"","created_at":"2026-06-06T12:00:00Z"},
          {"id":2,"vehicle_id":7,"command":"door_unlock","status":"failed","created_at":"2026-06-06T11:00:00Z"}
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = CommandLogEntry.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal("wake_up", list[0].Command);
        Assert.Equal("success", list[0].Status);
        Assert.NotNull(list[0].CreatedAtTime);
        Assert.Equal("door_unlock", list[1].Command);
        Assert.Equal("failed", list[1].Status);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":3}]""");

        var entry = Assert.Single(CommandLogEntry.ParseList(doc.RootElement));

        Assert.Equal(3, entry.Id);
        Assert.Null(entry.Command);
        Assert.Null(entry.Status);
        Assert.Null(entry.CreatedAtTime);
    }

    [Fact]
    public void ParseList_accepts_numeric_string_id_and_camel_created_at()
    {
        using var doc = JsonDocument.Parse("""[{"id":"42","command":"honk_horn","status":"pending","createdAt":"2026-06-06T12:00:00Z"}]""");

        var entry = Assert.Single(CommandLogEntry.ParseList(doc.RootElement));

        Assert.Equal(42, entry.Id);
        Assert.Equal("honk_horn", entry.Command);
        Assert.NotNull(entry.CreatedAtTime);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(CommandLogEntry.ParseList(doc.RootElement));
    }

    // ---- formatCommandName (port of the web title-caser) ---------------------------

    [Theory]
    [InlineData("wake_up", "Wake Up")]
    [InlineData("door_unlock", "Door Unlock")]
    [InlineData("set_charge_limit", "Set Charge Limit")]
    [InlineData("flash_lights", "Flash Lights")]
    [InlineData("honk_horn", "Honk Horn")]
    [InlineData("lock", "Lock")]
    [InlineData("trip_2", "Trip 2")]
    public void FormatCommandName_matches_web(string raw, string expected) =>
        Assert.Equal(expected, CommandHistoryProjection.FormatCommandName(raw));

    [Fact]
    public void FormatCommandName_null_is_em_dash() =>
        Assert.Equal("\u2014", CommandHistoryProjection.FormatCommandName(null));

    // ---- Status → feed presentation map (port of STATUS_MAP / DEFAULT_STATUS) -------

    [Theory]
    [InlineData("success", CommandStatuses.CheckGlyph, "TsColorSuccessBrush")]
    [InlineData("failed", CommandStatuses.ErrorGlyph, "TsColorDangerBrush")]
    [InlineData("pending", CommandStatuses.ClockGlyph, "TsColorWarningBrush")]
    public void FeedTokens_match_web(string status, string glyph, string brushKey)
    {
        var (g, key) = CommandStatuses.FeedTokens(status);
        Assert.Equal(glyph, g);
        Assert.Equal(brushKey, key);
    }

    [Fact]
    public void FeedTokens_unknown_and_null_fall_back_to_terminal_muted()
    {
        var unknown = CommandStatuses.FeedTokens("mysterious");
        var nullStatus = CommandStatuses.FeedTokens(null);

        Assert.Equal((CommandStatuses.TerminalGlyph, "TsColorTextMutedBrush"), unknown);
        Assert.Equal((CommandStatuses.TerminalGlyph, "TsColorTextMutedBrush"), nullStatus);
    }

    [Fact]
    public void FeedTokens_are_case_sensitive_like_web()
    {
        // Web parity: STATUS_MAP is keyed on the exact lowercase wire value; "SUCCESS" misses → default.
        Assert.Equal((CommandStatuses.TerminalGlyph, "TsColorTextMutedBrush"), CommandStatuses.FeedTokens("SUCCESS"));
    }

    // ---- Compact badge map (port of CompactView variant / label) -------------------

    [Theory]
    [InlineData("success", StatusKind.Success)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("pending", StatusKind.Warning)]
    [InlineData("queued", StatusKind.Warning)]
    [InlineData(null, StatusKind.Warning)]
    public void CompactBadgeStatus_matches_web(string? status, StatusKind expected) =>
        Assert.Equal(expected, CommandStatuses.CompactBadgeStatus(status));

    [Theory]
    [InlineData("success", "Success")]
    [InlineData("failed", "Failed")]
    [InlineData("pending", "Pending")]
    [InlineData("anything-else", "Pending")]
    [InlineData(null, "Pending")]
    public void CompactBadgeLabel_matches_web(string? status, string expected) =>
        Assert.Equal(expected, CommandStatuses.CompactBadgeLabel(status, Localizer));

    // ---- Size / footprint flags (web isCompact, maxItems) --------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new CommandHistorySize(cols, rows).IsCompact);

    [Fact]
    public void Size_feed_cap_is_ten() =>
        Assert.Equal(10, CommandHistorySize.MaxFeedItems);

    // ---- Projection: compact chip --------------------------------------------------

    [Fact]
    public void Project_compact_uses_raw_first_item_and_names_the_chip()
    {
        // Web parity: the compact chip reads list[0] (raw order), not the sorted feed head.
        var display = Project(
            Cmd(id: 1, command: "wake_up", status: "success", createdAt: "2026-06-06T09:00:00Z"),
            Cmd(id: 2, command: "door_lock", status: "failed", createdAt: "2026-06-06T12:00:00Z"));

        Assert.Equal("Wake Up", display.CompactCommandName);
        Assert.Equal(StatusKind.Success, display.CompactBadgeStatus);
        Assert.Equal("Success", display.CompactBadgeLabel);
        Assert.Contains("Wake Up", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Success", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_failed_first_item_is_danger()
    {
        var display = Project(Cmd(command: "door_unlock", status: "failed"));
        Assert.Equal("Door Unlock", display.CompactCommandName);
        Assert.Equal(StatusKind.Danger, display.CompactBadgeStatus);
        Assert.Equal("Failed", display.CompactBadgeLabel);
    }

    [Fact]
    public void Project_empty_has_no_items_and_em_dash_chip()
    {
        var display = CommandHistoryProjection.Project(
            Array.Empty<CommandLogEntry>(), CommandHistorySize.Default, Localizer, Now);

        Assert.False(display.HasItems);
        Assert.Empty(display.Items);
        Assert.Equal("\u2014", display.CompactCommandName);
    }

    // ---- Projection: feed ----------------------------------------------------------

    [Fact]
    public void Project_sorts_rows_newest_first_and_caps_to_ten()
    {
        var commands = new List<CommandLogEntry>();
        for (int i = 0; i < 12; i++)
        {
            // i=0 oldest … i=11 newest
            var ts = new DateTimeOffset(2026, 6, 6, 11, i, 0, TimeSpan.Zero);
            commands.Add(Cmd(id: i, command: "ping", status: "success", createdAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = CommandHistoryProjection.Project(commands, CommandHistorySize.Default, Localizer, Now);

        Assert.Equal(10, display.Items.Count);   // web maxItems = 10
        Assert.Equal(11, display.Items[0].Id);    // newest first
        Assert.Equal(2, display.Items[^1].Id);    // 10 newest of 0..11 -> ids 11..2
    }

    [Fact]
    public void Project_row_carries_title_status_subtitle_glyph_and_relative_time()
    {
        var row = Project(Cmd(command: "wake_up", status: "success", createdAt: "2026-06-06T12:00:00Z")).Items[0];

        Assert.Equal("Wake Up", row.Title);
        Assert.Equal("success", row.Subtitle);   // web subtitle = raw status
        Assert.Equal(CommandStatuses.CheckGlyph, row.Glyph);
        Assert.Equal("TsColorSuccessBrush", row.AccentBrushKey);
        Assert.Equal("5m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_row_subtitle_falls_back_to_em_dash_when_status_missing()
    {
        var row = Project(Cmd(command: "wake_up", status: null)).Items[0];
        Assert.Equal("\u2014", row.Subtitle);
        Assert.Equal(CommandStatuses.TerminalGlyph, row.Glyph);
        Assert.Equal("TsColorTextMutedBrush", row.AccentBrushKey);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = Project(Cmd(command: "honk_horn", status: "failed")).Items[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Honk Horn", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("failed", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"command":"wake_up","status":"success","created_at":"2026-06-06T12:00:00Z"}]""");

        var cached = CommandHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = CommandHistoryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("wake_up", offline.Value![0].Command);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var rows = JsonDocument.Parse("""[{"id":1,"command":"wake_up","status":"success"}]""");
        using var empty = JsonDocument.Parse("[]");

        Assert.Equal(LoadStatus.Loaded, CommandHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(rows.RootElement, Now)).Status);

        // A loaded-but-empty array collapses to Empty.
        Assert.Equal(LoadStatus.Empty, CommandHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, CommandHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CommandHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CommandLogEntry>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Loading, vm.State);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Cmd(id: 1), Cmd(id: 2, command: "door_lock")));
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CommandLogEntry>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No commands sent", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_flips_error_chip_without_replacing_body()
    {
        // Web parity: an error surfaces via the freshness "Error" chip + refresh, never a body swap.
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CommandLogEntry>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasItems);   // body shows the empty state, not a separate error surface
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CommandLogEntry>>.Cached(new[] { Cmd(id: 1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CommandLogEntry>>.OfflineCached(
            new[] { Cmd(id: 1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<CommandLogEntry>>.Loading(),
            RepositoryResult<IReadOnlyList<CommandLogEntry>>.Cached(new[] { Cmd(id: 1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<CommandLogEntry>>.Loaded(new[] { Cmd(id: 1), Cmd(id: 2, command: "door_lock") }, Now));
        await vm.LoadAsync();

        Assert.Equal(CommandHistoryState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Items.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new CommandHistorySize(2, 4), Loaded(Cmd(id: 1)));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new CommandHistorySize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(CommandHistoryState.Loaded, vm.State);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<CommandLogEntry>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Command History", vm.Title);
        Assert.Equal("No commands sent", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Cmd(id: 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CommandHistoryViewModel.State), changed);
        Assert.Contains(nameof(CommandHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("command-history", CommandHistoryRegistration.Id);
        Assert.Equal("commands", CommandHistoryRegistration.Category);
        Assert.Equal("CommandHistoryWidget", CommandHistoryRegistration.Slug);
        Assert.Equal(200, CommandHistoryRegistration.DefaultLimit);
        Assert.Equal(new CommandHistorySize(2, 4), CommandHistoryRegistration.DefaultSize);
        Assert.Equal(new CommandHistorySize(1, 2), CommandHistoryRegistration.MinSize);
        Assert.Equal(new CommandHistorySize(4, 40), CommandHistoryRegistration.MaxSize);
        Assert.Equal("Command History", CommandHistoryRegistration.Name(Localizer));
        Assert.Contains("success/fail", CommandHistoryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("command-history", CommandHistoryRegistration.Id);

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, CommandHistoryRegistration.IsWithinBounds(new CommandHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new CommandHistorySize(1, 2), CommandHistoryRegistration.Clamp(new CommandHistorySize(0, 0)));
        Assert.Equal(new CommandHistorySize(4, 40), CommandHistoryRegistration.Clamp(new CommandHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CommandHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CommandHistoryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new CommandHistorySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_history_with_limit()
    {
        using var history = JsonDocument.Parse(
            """[{"id":1,"vehicle_id":7,"command":"wake_up","status":"success","created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(history.RootElement);
        var source = new CommandHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("wake_up", Assert.Single(terminal.Value!).Command);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_commands_history", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.Equal(200, Assert.IsType<int>(request.Query!["limit"]));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var history = JsonDocument.Parse("""[{"id":1,"command":"door_lock","status":"success","created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(history.RootElement);
        var source = new CommandHistorySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal("42", Assert.Single(api.Requests).PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_collapses_to_empty()
    {
        using var empty = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(empty.RootElement);
        var source = new CommandHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CommandHistoryDisplay Project(params CommandLogEntry[] commands) =>
        CommandHistoryProjection.Project(commands, CommandHistorySize.Default, Localizer, Now);

    private static RepositoryResult<IReadOnlyList<CommandLogEntry>> Loaded(params CommandLogEntry[] commands) =>
        RepositoryResult<IReadOnlyList<CommandLogEntry>>.Loaded(commands, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<CommandLogEntry>>>> Drain(ICommandHistorySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<CommandLogEntry>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static CommandHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<CommandLogEntry>>[] emissions) =>
        NewViewModel(CommandHistorySize.Default, emissions);

    private static CommandHistoryViewModel NewViewModel(
        CommandHistorySize size,
        params RepositoryResult<IReadOnlyList<CommandLogEntry>>[] emissions) =>
        new(new FakeCommandHistorySource(emissions), Localizer, size, () => Now);

    private sealed class FakeCommandHistorySource(params RepositoryResult<IReadOnlyList<CommandLogEntry>>[] emissions)
        : ICommandHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<CommandLogEntry>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
