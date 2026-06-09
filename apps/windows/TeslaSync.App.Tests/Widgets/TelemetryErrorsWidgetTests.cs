using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets.TelemetryErrors;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the TelemetryErrorsWidget's UI-thread-free logic — the two DTO parsers, the
/// merged snapshot, the projection (status chip / aggregation / sort / "recent" tag / relative time), the
/// two-source cache-then-network combine mapper, the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx).
/// </summary>
public sealed class TelemetryErrorsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static TelemetryErrorVin Vin(string vin = "VIN1", bool active = true, long id = 1) =>
        new(id, vin, active, "2026-06-08T08:00:00Z", "2026-06-08T12:00:00Z", null);

    private static TelemetryError Err(
        string vin = "VIN1",
        string? code = "ERR_DECODE",
        string? reportedAt = "2026-06-08T12:00:00Z",
        string? fetchedAt = "2026-06-08T12:00:00Z",
        long id = 1) =>
        new(id, vin, code, "boom", reportedAt, null, fetchedAt);

    private static TelemetryErrorsSnapshot Snap(
        IReadOnlyList<TelemetryErrorVin>? vins = null,
        IReadOnlyList<TelemetryError>? errors = null) =>
        new(vins ?? Array.Empty<TelemetryErrorVin>(), errors ?? Array.Empty<TelemetryError>());

    // ---- DTO parse adapters --------------------------------------------------------

    [Fact]
    public void ParseVins_reads_snake_case_fields()
    {
        const string json = """
        [{"id":3,"vin":"5YJ3E1EA1KF000000","active":true,
          "first_seen_at":"2026-06-08T08:00:00Z","last_seen_at":"2026-06-08T12:00:00Z","resolved_at":null}]
        """;
        using var doc = JsonDocument.Parse(json);

        var vin = Assert.Single(TelemetryErrorVin.ParseList(doc.RootElement));
        Assert.Equal(3, vin.Id);
        Assert.Equal("5YJ3E1EA1KF000000", vin.Vin);
        Assert.True(vin.Active);
        Assert.Equal("2026-06-08T12:00:00Z", vin.LastSeenAt);
        Assert.Null(vin.ResolvedAt);
    }

    [Fact]
    public void ParseVins_is_tolerant_of_missing_fields_and_non_array()
    {
        using var partial = JsonDocument.Parse("""[{"id":9}]""");
        var vin = Assert.Single(TelemetryErrorVin.ParseList(partial.RootElement));
        Assert.Equal(9, vin.Id);
        Assert.Equal(string.Empty, vin.Vin);
        Assert.False(vin.Active); // default

        using var obj = JsonDocument.Parse("{}");
        Assert.Empty(TelemetryErrorVin.ParseList(obj.RootElement));
    }

    [Fact]
    public void ParseErrors_reads_snake_case_and_effective_timestamp_prefers_reported_at()
    {
        const string json = """
        [{"id":1,"vin":"VINA","error_code":"E_DECODE","error_message":"bad frame",
          "reported_at":"2026-06-08T12:00:00Z","tesla_updated_at":null,"fetched_at":"2026-06-08T12:04:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var err = Assert.Single(TelemetryError.ParseList(doc.RootElement));
        Assert.Equal("VINA", err.Vin);
        Assert.Equal("E_DECODE", err.ErrorCode);
        Assert.Equal("2026-06-08T12:00:00Z", err.EffectiveTimestampRaw); // reported_at wins
        Assert.NotNull(err.EffectiveTimestamp);
    }

    [Fact]
    public void ParseErrors_falls_back_to_fetched_at_when_reported_at_absent()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"vin":"VINB","fetched_at":"2026-06-08T11:00:00Z"}]""");
        var err = Assert.Single(TelemetryError.ParseList(doc.RootElement));
        Assert.Null(err.ErrorCode);
        Assert.Equal("2026-06-08T11:00:00Z", err.EffectiveTimestampRaw);
    }

    // ---- Snapshot ------------------------------------------------------------------

    [Fact]
    public void Snapshot_active_count_and_hasData()
    {
        var snap = Snap(
            new[] { Vin("A", active: true), Vin("B", active: false), Vin("C", active: true) },
            new[] { Err("A") });

        Assert.Equal(2, snap.ActiveVinCount);
        Assert.True(snap.HasData);
        Assert.False(TelemetryErrorsSnapshot.Empty.HasData);
    }

    [Fact]
    public void Snapshot_hasData_true_when_only_errors_present()
    {
        Assert.True(Snap(errors: new[] { Err() }).HasData);
        Assert.True(Snap(vins: new[] { Vin() }).HasData);
    }

    // ---- Size (web isCompact = cols <= 1) ------------------------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_isCompact_gates_on_columns(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new TelemetryErrorsSize(cols, rows).IsCompact);

    // ---- Projection: status chip ---------------------------------------------------

    [Fact]
    public void Project_status_is_danger_errors_when_active_vins_present()
    {
        var display = TelemetryErrorsProjection.Project(
            Snap(new[] { Vin(active: true) }), TelemetryErrorsSize.Default, Localizer, Now);

        Assert.Equal(StatusKind.Danger, display.Status);
        Assert.Equal("Errors", display.StatusLabel);
        Assert.Equal(1, display.ActiveVinCount);
        Assert.Equal("1 VINs with errors", display.ActiveVinsSummary);
        Assert.Equal("error VINs", display.ErrorVinsLabel);
    }

    [Fact]
    public void Project_status_is_success_healthy_when_no_active_vins()
    {
        var display = TelemetryErrorsProjection.Project(
            Snap(new[] { Vin(active: false) }, new[] { Err() }), TelemetryErrorsSize.Default, Localizer, Now);

        Assert.Equal(StatusKind.Success, display.Status);
        Assert.Equal("Healthy", display.StatusLabel);
        Assert.Equal(0, display.ActiveVinCount);
        Assert.Equal("0 VINs with errors", display.ActiveVinsSummary);
    }

    [Fact]
    public void Project_compact_flag_follows_size()
    {
        var compact = TelemetryErrorsProjection.Project(Snap(new[] { Vin() }), new TelemetryErrorsSize(1, 2), Localizer, Now);
        var standard = TelemetryErrorsProjection.Project(Snap(new[] { Vin() }), new TelemetryErrorsSize(2, 4), Localizer, Now);
        Assert.True(compact.IsCompact);
        Assert.False(standard.IsCompact);
    }

    // ---- Projection: aggregation ---------------------------------------------------

    [Fact]
    public void Project_aggregates_by_vin_and_error_code_with_count_and_latest_last_seen()
    {
        var errors = new[]
        {
            Err("VIN1", "E1", reportedAt: "2026-06-08T11:55:00Z"),
            Err("VIN1", "E1", reportedAt: "2026-06-08T12:00:00Z"), // same group → count 2, last_seen 12:00
            Err("VIN2", null, reportedAt: "2026-06-08T09:00:00Z"), // unknown code, older
        };
        var display = TelemetryErrorsProjection.Project(Snap(errors: errors), TelemetryErrorsSize.Default, Localizer, Now);

        Assert.True(display.HasEntries);
        Assert.Equal(2, display.Entries.Count);

        var first = display.Entries[0];
        Assert.Equal("VIN1", first.Vin);
        Assert.Equal("E1", first.ErrorCode);
        Assert.Equal(2, first.Count);
        Assert.Equal("\u00d72", first.CountLabel); // ×2
        Assert.Equal("5m ago", first.LastSeenRelative);
        Assert.True(first.IsRecent);

        var second = display.Entries[1];
        Assert.Equal("VIN2", second.Vin);
        Assert.Equal("Unknown", second.ErrorCode); // null error_code → localized fallback
        Assert.Equal("3h ago", second.LastSeenRelative);
        Assert.False(second.IsRecent);
    }

    [Fact]
    public void Project_sorts_newest_first_and_sinks_last_seen_less_rows()
    {
        var errors = new[]
        {
            Err("VINOLD", "E", reportedAt: "2026-06-08T08:00:00Z", fetchedAt: "2026-06-08T08:00:00Z"),
            Err("VINNONE", "E", reportedAt: null, fetchedAt: null),  // no last_seen → bottom
            Err("VINNEW", "E", reportedAt: "2026-06-08T12:00:00Z", fetchedAt: "2026-06-08T12:00:00Z"),
        };
        var display = TelemetryErrorsProjection.Project(Snap(errors: errors), TelemetryErrorsSize.Default, Localizer, Now);

        Assert.Equal("VINNEW", display.Entries[0].Vin);  // newest first
        Assert.Equal("VINOLD", display.Entries[1].Vin);
        Assert.Equal("VINNONE", display.Entries[2].Vin); // last_seen-less sinks to bottom
        Assert.Null(display.Entries[2].LastSeen);
        Assert.Equal("\u2014", display.Entries[2].LastSeenRelative); // em-dash for no timestamp
    }

    [Fact]
    public void Project_no_errors_message_when_vins_present_but_no_errors()
    {
        var display = TelemetryErrorsProjection.Project(Snap(new[] { Vin() }), TelemetryErrorsSize.Default, Localizer, Now);
        Assert.False(display.HasEntries);
        Assert.Equal("No errors recorded", display.NoErrorsMessage);
    }

    [Fact]
    public void Project_entry_and_compact_have_non_empty_accessibility_names()
    {
        var display = TelemetryErrorsProjection.Project(
            Snap(new[] { Vin(active: true) }, new[] { Err("VINX", "E_DECODE") }), TelemetryErrorsSize.Default, Localizer, Now);

        var entry = Assert.Single(display.Entries);
        Assert.False(string.IsNullOrWhiteSpace(entry.AutomationName));
        Assert.Contains("VINX", entry.AutomationName, StringComparison.Ordinal);
        Assert.Contains("E_DECODE", entry.AutomationName, StringComparison.Ordinal);

        Assert.False(string.IsNullOrWhiteSpace(display.CompactAutomationName));
        Assert.Contains("error VINs", display.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Combine mapper (two-source cache-then-network) ----------------------------

    [Fact]
    public void Combine_either_loading_stays_loading()
    {
        using var arr = JsonDocument.Parse("[]");
        var loaded = RepositoryResult<JsonElement>.Loaded(arr.RootElement, Now);

        Assert.Equal(LoadStatus.Loading, TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loading(), loaded).Status);
        Assert.Equal(LoadStatus.Loading, TelemetryErrorsResultMapper.Combine(
            loaded, RepositoryResult<JsonElement>.Loading()).Status);
    }

    [Fact]
    public void Combine_both_empty_arrays_collapse_to_empty()
    {
        using var vins = JsonDocument.Parse("[]");
        using var errors = JsonDocument.Parse("[]");

        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(vins.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(errors.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public void Combine_loaded_with_data_parses_and_marks_loaded()
    {
        using var vins = JsonDocument.Parse("""[{"id":1,"vin":"VIN1","active":true}]""");
        using var errors = JsonDocument.Parse("""[{"id":1,"vin":"VIN1","error_code":"E1","reported_at":"2026-06-08T12:00:00Z"}]""");

        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(vins.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(errors.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
        Assert.Equal(1, result.Value!.ActiveVinCount);
        Assert.Single(result.Value.Errors);
    }

    [Fact]
    public void Combine_both_failed_with_no_cache_is_error()
    {
        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_one_failed_but_other_has_data_shows_content()
    {
        using var vins = JsonDocument.Parse("""[{"id":1,"vin":"VIN1","active":true}]""");

        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(vins.RootElement, Now),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.NotEqual(LoadStatus.Error, result.Status); // data wins over a single failure
        Assert.Equal(1, result.Value!.ActiveVinCount);
    }

    [Fact]
    public void Combine_stale_cache_is_marked_stale()
    {
        using var vins = JsonDocument.Parse("""[{"id":1,"vin":"VIN1","active":true}]""");
        using var errors = JsonDocument.Parse("[]");

        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(vins.RootElement, Now, stale: true),
            RepositoryResult<JsonElement>.Cached(errors.RootElement, Now, stale: false));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale); // web: isStale = vinsStale || errorsStale
    }

    [Fact]
    public void Combine_offline_read_is_offline()
    {
        using var vins = JsonDocument.Parse("""[{"id":1,"vin":"VIN1","active":true}]""");
        using var errors = JsonDocument.Parse("[]");

        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(vins.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Loaded(errors.RootElement, Now));

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.Equal(1, result.Value!.ActiveVinCount);
    }

    [Fact]
    public void Combine_fetchedAt_is_the_max_of_both_reads()
    {
        using var vins = JsonDocument.Parse("""[{"id":1,"vin":"VIN1","active":true}]""");
        using var errors = JsonDocument.Parse("[]");
        var earlier = Now.AddMinutes(-10);

        var result = TelemetryErrorsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(vins.RootElement, earlier),
            RepositoryResult<JsonElement>.Cached(errors.RootElement, Now, stale: false));

        Assert.Equal(Now, result.FetchedAt); // web: Math.max(vinsUpdatedAt, errorsUpdatedAt)
    }

    // ---- Registration (web registry parity) ----------------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("telemetry-errors", TelemetryErrorsRegistration.Id);
        Assert.Equal("system", TelemetryErrorsRegistration.Category);
        Assert.Equal("TelemetryErrorsWidget", TelemetryErrorsRegistration.Slug);
        Assert.Equal(new TelemetryErrorsSize(2, 4), TelemetryErrorsRegistration.DefaultSize);
        Assert.Equal(new TelemetryErrorsSize(1, 2), TelemetryErrorsRegistration.MinSize);
        Assert.Equal(new TelemetryErrorsSize(4, 40), TelemetryErrorsRegistration.MaxSize);
        Assert.Equal("Telemetry Errors", TelemetryErrorsRegistration.Name(Localizer));
        Assert.Contains("error monitor", TelemetryErrorsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 4, false)]  // above max cols
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, TelemetryErrorsRegistration.IsWithinBounds(new TelemetryErrorsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new TelemetryErrorsSize(1, 2), TelemetryErrorsRegistration.Clamp(new TelemetryErrorsSize(0, 1)));
        Assert.Equal(new TelemetryErrorsSize(4, 40), TelemetryErrorsRegistration.Clamp(new TelemetryErrorsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TelemetryErrorsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TelemetryErrorsWidget", Assert.Single(lines));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display_with_entries()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Loaded(
            Snap(new[] { Vin(active: true) }, new[] { Err("VIN1", "E1") }), Now));
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.HasEntries);
        Assert.Equal(StatusKind.Danger, vm.Display.Status);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry error data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Cached(
            Snap(new[] { Vin(active: true) }, new[] { Err() }), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.OfflineCached(
            Snap(new[] { Vin(active: true) }, new[] { Err() }), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewVm(
            RepositoryResult<TelemetryErrorsSnapshot>.Loading(),
            RepositoryResult<TelemetryErrorsSnapshot>.Cached(Snap(new[] { Vin() }), Now, stale: false),
            RepositoryResult<TelemetryErrorsSnapshot>.Loaded(Snap(new[] { Vin() }, new[] { Err() }), Now));
        await vm.LoadAsync();

        Assert.Equal(TelemetryErrorsState.Loaded, vm.State);
        Assert.True(vm.Display.HasEntries);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_flag()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Loaded(Snap(new[] { Vin() }), Now));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact); // default 2x4

        vm.Size = new TelemetryErrorsSize(1, 2);
        Assert.True(vm.Display.IsCompact);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Telemetry Errors", vm.Title);
        Assert.Equal("No telemetry error data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewVm(RepositoryResult<TelemetryErrorsSnapshot>.Loaded(
            Snap(new[] { Vin() }, new[] { Err() }), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TelemetryErrorsViewModel.State), changed);
        Assert.Contains(nameof(TelemetryErrorsViewModel.Display), changed);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static TelemetryErrorsViewModel NewVm(params RepositoryResult<TelemetryErrorsSnapshot>[] emissions) =>
        new(new FakeTelemetryErrorsSource(emissions), Localizer, TelemetryErrorsSize.Default, () => Now);

    private sealed class FakeTelemetryErrorsSource(params RepositoryResult<TelemetryErrorsSnapshot>[] emissions)
        : ITelemetryErrorsSource
    {
        public async IAsyncEnumerable<RepositoryResult<TelemetryErrorsSnapshot>> StreamAsync(
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
}
