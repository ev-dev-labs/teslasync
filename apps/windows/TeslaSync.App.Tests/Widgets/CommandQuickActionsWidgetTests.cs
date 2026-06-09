using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the CommandQuickActionsWidget's UI-thread-free logic — the command catalog +
/// size-driven slice (web <c>COMMANDS.slice</c>), the vehicle-resolution reading (web
/// <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>), the projection (tiles, columns, i18n labels, a11y names), the
/// command-result parse (web <c>CommandResult</c>), the cache-then-network result mapper, the vehicle-list
/// source adapter, the command sender (POST path + body), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline) plus
/// the command execution (active-while-running, disable-all, onSettled clear, success/failure announcement).
/// Mirrors the web spec (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx).
/// </summary>
public sealed class CommandQuickActionsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static CommandQuickActionsReading Vehicle(long id = 7, string name = "Model 3") => new(id, name);

    // ---- Command catalog (web COMMANDS parity) -------------------------------------

    [Fact]
    public void Catalog_has_eight_commands_in_web_order()
    {
        var ids = CommandCatalog.All.Select(c => c.Id).ToArray();
        Assert.Equal(
            new[] { "lock", "unlock", "climate_on", "climate_off", "frunk", "honk", "flash", "trunk" },
            ids);
    }

    [Theory]
    [InlineData("lock", "lock")]
    [InlineData("unlock", "unlock")]
    [InlineData("climate_on", "climate_on")]
    [InlineData("climate_off", "climate_off")]
    [InlineData("frunk", "actuate_frunk")]
    [InlineData("honk", "honk_horn")]
    [InlineData("flash", "flash_lights")]
    [InlineData("trunk", "actuate_trunk")]
    public void Catalog_wire_commands_match_web(string id, string command) =>
        Assert.Equal(command, CommandCatalog.All.Single(c => c.Id == id).Command);

    [Fact]
    public void Catalog_label_keys_match_web()
    {
        Assert.Equal("widget.quickActions.lock", CommandCatalog.All[0].LabelKey);
        Assert.Equal("widget.quickActions.climateOn", CommandCatalog.All[2].LabelKey);
        Assert.Equal("widget.quickActions.horn", CommandCatalog.All[5].LabelKey);
        Assert.Equal("widget.quickActions.trunk", CommandCatalog.All[7].LabelKey);
    }

    [Fact]
    public void Catalog_accents_use_semantic_tokens_not_neon()
    {
        foreach (var command in CommandCatalog.All)
        {
            Assert.StartsWith("TsColor", command.AccentBrushKey, StringComparison.Ordinal);
            Assert.EndsWith("Brush", command.AccentBrushKey, StringComparison.Ordinal);
            Assert.DoesNotContain("neon", command.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Catalog_glyphs_are_non_empty()
    {
        foreach (var command in CommandCatalog.All)
        {
            Assert.False(string.IsNullOrEmpty(command.Glyph));
        }
    }

    // ---- Size-driven slice (web isCompact/​isWide slices) ---------------------------

    [Fact]
    public void Visible_compact_takes_four()
    {
        var visible = CommandCatalog.Visible(new CommandQuickActionsSize(1, 1));
        Assert.Equal(4, visible.Count);
        Assert.Equal(new[] { "lock", "unlock", "climate_on", "climate_off" }, visible.Select(c => c.Id));
    }

    [Fact]
    public void Visible_default_takes_six()
    {
        var visible = CommandCatalog.Visible(CommandQuickActionsSize.Default);
        Assert.Equal(6, visible.Count);
        Assert.Equal(new[] { "lock", "unlock", "climate_on", "climate_off", "frunk", "honk" }, visible.Select(c => c.Id));
    }

    [Fact]
    public void Visible_wide_takes_all_eight()
    {
        var visible = CommandCatalog.Visible(new CommandQuickActionsSize(3, 2));
        Assert.Equal(8, visible.Count);
    }

    [Theory]
    [InlineData(1, 1, true, false)]
    [InlineData(1, 2, false, false)] // min footprint is not compact (rows > 1)
    [InlineData(2, 2, false, false)] // default
    [InlineData(3, 2, false, true)]
    [InlineData(4, 40, false, true)] // max footprint
    public void Size_compact_and_wide_flags(int cols, int rows, bool compact, bool wide)
    {
        var size = new CommandQuickActionsSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    [Theory]
    [InlineData(1, 1, 2)] // compact → 2 columns
    [InlineData(2, 2, 3)] // default → 3 columns
    [InlineData(3, 2, 4)] // wide → 4 columns
    public void Projection_columns_match_web_grid(int cols, int rows, int columns) =>
        Assert.Equal(columns, CommandQuickActionsProjection.Columns(new CommandQuickActionsSize(cols, rows)));

    // ---- Projection (tiles + i18n labels + a11y names) -----------------------------

    [Fact]
    public void Projection_default_yields_six_tiles_with_labels()
    {
        var display = CommandQuickActionsProjection.Project(CommandQuickActionsSize.Default, Localizer);

        Assert.Equal(6, display.Tiles.Count);
        Assert.False(display.IsCompact);
        Assert.False(display.IsWide);
        Assert.Equal(3, display.Columns);
        Assert.Equal("Lock", display.Tiles[0].Label);
        Assert.Equal("Climate On", display.Tiles[2].Label);
    }

    [Fact]
    public void Projection_compact_yields_four_tiles()
    {
        var display = CommandQuickActionsProjection.Project(new CommandQuickActionsSize(1, 1), Localizer);

        Assert.Equal(4, display.Tiles.Count);
        Assert.True(display.IsCompact);
        Assert.Equal(2, display.Columns);
    }

    [Fact]
    public void Projection_every_tile_has_an_accessibility_name_equal_to_its_label()
    {
        var display = CommandQuickActionsProjection.Project(new CommandQuickActionsSize(3, 2), Localizer);

        Assert.Equal(8, display.Tiles.Count);
        foreach (var tile in display.Tiles)
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
            Assert.Equal(tile.Label, tile.AutomationName);
            Assert.False(string.IsNullOrEmpty(tile.Command));
            Assert.False(string.IsNullOrEmpty(tile.AccentBrushKey));
        }
    }

    // ---- Reading.Resolve (web vehicleId ?? vehicles?.[0]?.id ?? 0) ------------------

    [Fact]
    public void Resolve_picks_first_vehicle_from_bare_array()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"display_name":"Model 3"},{"id":9,"display_name":"Model Y"}]""");

        var reading = CommandQuickActionsReading.Resolve(doc.RootElement, null);

        Assert.NotNull(reading);
        Assert.Equal(7, reading!.VehicleId);
        Assert.Equal("Model 3", reading.DisplayName);
    }

    [Fact]
    public void Resolve_explicit_id_wins_and_pulls_name_from_list()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"display_name":"Model 3"},{"id":42,"display_name":"Roadster"}]""");

        var reading = CommandQuickActionsReading.Resolve(doc.RootElement, 42);

        Assert.NotNull(reading);
        Assert.Equal(42, reading!.VehicleId);
        Assert.Equal("Roadster", reading.DisplayName);
    }

    [Fact]
    public void Resolve_explicit_id_wins_even_for_empty_list()
    {
        using var doc = JsonDocument.Parse("[]");

        var reading = CommandQuickActionsReading.Resolve(doc.RootElement, 42);

        Assert.NotNull(reading);
        Assert.Equal(42, reading!.VehicleId);
        Assert.Equal(string.Empty, reading.DisplayName);
    }

    [Fact]
    public void Resolve_empty_array_is_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(CommandQuickActionsReading.Resolve(doc.RootElement, null));
    }

    [Fact]
    public void Resolve_accepts_numeric_string_id()
    {
        using var doc = JsonDocument.Parse("""[{"id":"7","display_name":"Model 3"}]""");

        var reading = CommandQuickActionsReading.Resolve(doc.RootElement, null);

        Assert.Equal(7, reading!.VehicleId);
    }

    [Fact]
    public void Resolve_tolerates_vehicles_envelope()
    {
        using var doc = JsonDocument.Parse("""{"vehicles":[{"id":7}]}""");

        var reading = CommandQuickActionsReading.Resolve(doc.RootElement, null);

        Assert.Equal(7, reading!.VehicleId);
    }

    [Fact]
    public void Resolve_first_vehicle_without_id_is_null()
    {
        using var doc = JsonDocument.Parse("""[{"display_name":"No id"}]""");
        Assert.Null(CommandQuickActionsReading.Resolve(doc.RootElement, null));
    }

    // ---- CommandResult parse (web CommandResult) -----------------------------------

    [Fact]
    public void CommandResult_reads_success_true()
    {
        using var doc = JsonDocument.Parse("""{"success":true,"result":"success"}""");
        var result = CommandResult.FromResponse(doc.RootElement);

        Assert.True(result.Success);
        Assert.Equal(string.Empty, result.Message); // backend returns no `message` field (web fallback path)
    }

    [Fact]
    public void CommandResult_reads_success_false_with_error_body()
    {
        using var doc = JsonDocument.Parse("""{"success":false,"error":"boom"}""");
        Assert.False(CommandResult.FromResponse(doc.RootElement).Success);
    }

    [Fact]
    public void CommandResult_reads_message_when_present()
    {
        using var doc = JsonDocument.Parse("""{"success":true,"message":"Locked"}""");
        var result = CommandResult.FromResponse(doc.RootElement);

        Assert.True(result.Success);
        Assert.Equal("Locked", result.Message);
    }

    [Fact]
    public void CommandResult_non_object_is_failure()
    {
        using var doc = JsonDocument.Parse("\"oops\"");
        Assert.False(CommandResult.FromResponse(doc.RootElement).Success);
    }

    // ---- Result mapper (resolve + preserve status) ---------------------------------

    [Fact]
    public void Mapper_preserves_loading()
    {
        var mapped = CommandQuickActionsResultMapper.Map(RepositoryResult<JsonElement>.Loading(), null);
        Assert.Equal(LoadStatus.Loading, mapped.Status);
    }

    [Fact]
    public void Mapper_resolves_loaded_vehicle()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"display_name":"Model 3"}]""");
        var mapped = CommandQuickActionsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), null);

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Equal(7, mapped.Value!.VehicleId);
    }

    [Fact]
    public void Mapper_empty_list_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = CommandQuickActionsResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), null);

        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_preserves_offline_with_resolved_vehicle()
    {
        using var doc = JsonDocument.Parse("""[{"id":7}]""");
        var mapped = CommandQuickActionsResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            null);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.Equal(7, mapped.Value!.VehicleId);
        Assert.True(mapped.IsStale);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("command-quick-actions", CommandQuickActionsRegistration.Id);
        Assert.Equal("commands", CommandQuickActionsRegistration.Category);
        Assert.Equal("CommandQuickActionsWidget", CommandQuickActionsRegistration.Slug);
        Assert.Equal(new CommandQuickActionsSize(2, 2), CommandQuickActionsRegistration.DefaultSize);
        Assert.Equal(new CommandQuickActionsSize(1, 2), CommandQuickActionsRegistration.MinSize);
        Assert.Equal(new CommandQuickActionsSize(4, 40), CommandQuickActionsRegistration.MaxSize);
        Assert.Equal("Quick Actions", CommandQuickActionsRegistration.Name(Localizer));
        Assert.Contains("Lock", CommandQuickActionsRegistration.Description(Localizer), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, CommandQuickActionsRegistration.IsWithinBounds(new CommandQuickActionsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new CommandQuickActionsSize(1, 2), CommandQuickActionsRegistration.Clamp(new CommandQuickActionsSize(0, 0)));
        Assert.Equal(new CommandQuickActionsSize(4, 40), CommandQuickActionsRegistration.Clamp(new CommandQuickActionsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CommandQuickActionsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CommandQuickActionsWidget", Assert.Single(lines));
    }

    // ---- Source (vehicle-list adapter) ---------------------------------------------

    [Fact]
    public async Task Source_reads_vehicle_list_and_resolves_primary()
    {
        using var vehicles = JsonDocument.Parse("""[{"id":7,"display_name":"Model 3"}]""");
        var api = new FakeApiClient().ReturnsValue(vehicles.RootElement);
        var source = new CommandQuickActionsSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(7, terminal.Value!.VehicleId);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles", request.OperationId);
        Assert.Null(request.PathParams);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var vehicles = JsonDocument.Parse("""[{"id":7,"display_name":"Model 3"}]""");
        var api = new FakeApiClient().ReturnsValue(vehicles.RootElement);
        var source = new CommandQuickActionsSource(api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(42, results[^1].Value!.VehicleId);
    }

    [Fact]
    public async Task Source_empty_list_collapses_to_empty()
    {
        using var vehicles = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(vehicles.RootElement);
        var source = new CommandQuickActionsSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Command sender (POST /vehicles/{id}/command) ------------------------------

    [Fact]
    public async Task CommandSender_posts_command_with_path_and_body()
    {
        using var response = JsonDocument.Parse("""{"success":true,"result":"success"}""");
        var api = new FakeApiClient().ReturnsValue(response.RootElement);
        var sender = new VehicleCommandSender(api);

        var result = await sender.SendAsync(7, "lock");

        Assert.True(result.Success);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_vehicles_vehicleID_command", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.NotNull(request.Body);
        var bodyJson = JsonSerializer.Serialize(request.Body);
        Assert.Contains("\"command\":\"lock\"", bodyJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CommandSender_parses_failure_response()
    {
        using var response = JsonDocument.Parse("""{"success":false,"error":"boom"}""");
        var api = new FakeApiClient().ReturnsValue(response.RootElement);
        var sender = new VehicleCommandSender(api);

        Assert.False((await sender.SendAsync(7, "unlock")).Success);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CommandQuickActionsReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Loading, vm.State);
        Assert.False(vm.HasVehicle);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_vehicle()
    {
        using var vm = NewViewModel(RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Loaded, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.Equal(7, vm.VehicleId);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.Equal(6, vm.VisibleCommands.Count);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_no_vehicle()
    {
        using var vm = NewViewModel(RepositoryResult<CommandQuickActionsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Empty, vm.State);
        Assert.False(vm.HasVehicle);
        Assert.Equal("No vehicle selected", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_flips_error_chip_without_a_vehicle()
    {
        using var vm = NewViewModel(
            RepositoryResult<CommandQuickActionsReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasVehicle); // body shows the empty surface, chip shows "Error"
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_vehicle()
    {
        using var vm = NewViewModel(
            RepositoryResult<CommandQuickActionsReading>.Cached(Vehicle(7), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasVehicle);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_vehicle()
    {
        using var vm = NewViewModel(RepositoryResult<CommandQuickActionsReading>.OfflineCached(
            Vehicle(7), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Offline, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CommandQuickActionsReading>.Loading(),
            RepositoryResult<CommandQuickActionsReading>.Cached(Vehicle(7), Now, stale: false),
            RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();

        Assert.Equal(CommandQuickActionsState.Loaded, vm.State);
        Assert.True(vm.HasVehicle);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_visible_commands()
    {
        using var vm = NewViewModel(CommandQuickActionsSize.Default, new StubCommandSender(),
            RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();
        Assert.Equal(6, vm.VisibleCommands.Count);
        Assert.True(vm.ShowHeader);

        vm.Size = new CommandQuickActionsSize(1, 1);
        Assert.Equal(4, vm.VisibleCommands.Count);
        Assert.True(vm.IsCompact);
        Assert.False(vm.ShowHeader);

        vm.Size = new CommandQuickActionsSize(3, 2);
        Assert.Equal(8, vm.VisibleCommands.Count);
        Assert.True(vm.IsWide);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CommandQuickActionsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Quick Actions", vm.Title);
        Assert.Equal("No vehicle selected", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_vehicle()
    {
        using var vm = NewViewModel(RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CommandQuickActionsViewModel.State), changed);
        Assert.Contains(nameof(CommandQuickActionsViewModel.HasVehicle), changed);
    }

    // ---- View-model command execution (web handleCommand / activeCommand) ----------

    [Fact]
    public async Task ExecuteCommand_marks_active_during_and_clears_on_settle()
    {
        var sender = new GateCommandSender();
        using var vm = NewViewModel(sender, RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();

        var task = vm.ExecuteCommandAsync("lock");

        Assert.Equal("lock", vm.ActiveCommand);
        Assert.True(vm.IsBusy);
        Assert.False(vm.CanExecute("unlock")); // web disabled={!!activeCommand}
        Assert.Equal(7, sender.VehicleId);
        Assert.Equal("lock", sender.Command);

        sender.Complete(new CommandResult(true, string.Empty));
        await task;

        Assert.Null(vm.ActiveCommand);
        Assert.False(vm.IsBusy);
        Assert.Equal("Command sent successfully", vm.LastCommandAnnouncement); // web fallback
    }

    [Fact]
    public async Task ExecuteCommand_failure_announces_failure_and_clears()
    {
        var sender = new StubCommandSender((_, _) => new CommandResult(false, string.Empty));
        using var vm = NewViewModel(sender, RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();

        await vm.ExecuteCommandAsync("lock");

        Assert.Null(vm.ActiveCommand);
        Assert.Equal("Command failed", vm.LastCommandAnnouncement);
    }

    [Fact]
    public async Task ExecuteCommand_throwing_sender_clears_active_and_announces()
    {
        var sender = new StubCommandSender((_, _) => throw new InvalidOperationException("boom"));
        using var vm = NewViewModel(sender, RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();

        await vm.ExecuteCommandAsync("lock");

        Assert.Null(vm.ActiveCommand);
        Assert.False(vm.IsBusy);
        Assert.False(string.IsNullOrEmpty(vm.LastCommandAnnouncement));
    }

    [Fact]
    public async Task ExecuteCommand_is_a_no_op_without_a_vehicle()
    {
        var sender = new StubCommandSender((_, _) => new CommandResult(true, string.Empty));
        using var vm = NewViewModel(sender, RepositoryResult<CommandQuickActionsReading>.Empty(Now));
        await vm.LoadAsync();

        await vm.ExecuteCommandAsync("lock");

        Assert.Empty(sender.Calls);
        Assert.Null(vm.ActiveCommand);
        Assert.False(vm.CanExecute("lock"));
    }

    [Fact]
    public async Task ExecuteCommand_ignores_a_second_command_while_busy()
    {
        var sender = new GateCommandSender();
        using var vm = NewViewModel(sender, RepositoryResult<CommandQuickActionsReading>.Loaded(Vehicle(7), Now));
        await vm.LoadAsync();

        var first = vm.ExecuteCommandAsync("lock");
        await vm.ExecuteCommandAsync("unlock"); // returns immediately — busy

        Assert.Equal("lock", vm.ActiveCommand);
        Assert.Equal(1, sender.Calls);

        sender.Complete(new CommandResult(true, string.Empty));
        await first;
        Assert.Null(vm.ActiveCommand);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<CommandQuickActionsReading>>> Drain(ICommandQuickActionsSource source)
    {
        var list = new List<RepositoryResult<CommandQuickActionsReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static CommandQuickActionsViewModel NewViewModel(params RepositoryResult<CommandQuickActionsReading>[] emissions) =>
        NewViewModel(CommandQuickActionsSize.Default, new StubCommandSender(), emissions);

    private static CommandQuickActionsViewModel NewViewModel(
        IVehicleCommandSender sender,
        params RepositoryResult<CommandQuickActionsReading>[] emissions) =>
        NewViewModel(CommandQuickActionsSize.Default, sender, emissions);

    private static CommandQuickActionsViewModel NewViewModel(
        CommandQuickActionsSize size,
        IVehicleCommandSender sender,
        params RepositoryResult<CommandQuickActionsReading>[] emissions) =>
        new(new FakeSource(emissions), sender, Localizer, size);

    private sealed class FakeSource(params RepositoryResult<CommandQuickActionsReading>[] emissions)
        : ICommandQuickActionsSource
    {
        public async IAsyncEnumerable<RepositoryResult<CommandQuickActionsReading>> StreamAsync(
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

    private sealed class StubCommandSender(Func<long, string, CommandResult>? handler = null) : IVehicleCommandSender
    {
        private readonly Func<long, string, CommandResult> _handler =
            handler ?? ((_, _) => new CommandResult(true, string.Empty));

        public List<(long VehicleId, string Command)> Calls { get; } = new();

        public Task<CommandResult> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
        {
            Calls.Add((vehicleId, command));
            return Task.FromResult(_handler(vehicleId, command));
        }
    }

    private sealed class GateCommandSender : IVehicleCommandSender
    {
        private readonly TaskCompletionSource<CommandResult> _gate =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public long? VehicleId { get; private set; }

        public string? Command { get; private set; }

        public int Calls { get; private set; }

        public Task<CommandResult> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
        {
            VehicleId = vehicleId;
            Command = command;
            Calls++;
            return _gate.Task;
        }

        public void Complete(CommandResult result) => _gate.TrySetResult(result);
    }
}
