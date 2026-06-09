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
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SignalHealthWidget's UI-thread-free logic — the two JSON parse adapters (the
/// useSignals / useSignalGaps reads), the five-minute active/gap analysis, the gap sort, the freshness-age
/// derivation, the health-tone thresholds, the formatAge / formatRelative tiers, the projection (stat values,
/// gap-row cap, compact badge, footprint flags, Narrator name), the stats-driven three-source combine mapper,
/// the concurrent per-vehicle data source (primary resolution + the three path-scoped reads), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/SignalHealthWidget.tsx).
/// </summary>
public sealed class SignalHealthWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string StatsJson = """{"vehicle_id":7,"total_signals":3,"active_signals":1}""";
    private const string AvailableJson = """{"signals":[{"name":"VehicleSpeed"},{"name":"Soc"},{"name":"Gear"}]}""";
    private const string LiveJson = """
        {"vehicle_id":7,"signals":{
          "VehicleSpeed":{"value":10,"timestamp":"2026-06-06T12:04:00Z"},
          "Soc":{"value":80,"timestamp":"2026-06-06T11:58:00Z"},
          "Gear":{"value":"D"}}}
        """;

    // ---- Parse adapters (web hook reads) -------------------------------------------

    [Fact]
    public void ParseSignals_keeps_object_names_and_bare_strings()
    {
        using var doc = JsonDocument.Parse("""{"signals":[{"name":"A"},{"name":"B"},"C"]}""");
        var names = SignalHealthReading.ParseSignals(doc.RootElement);

        Assert.NotNull(names);
        Assert.Equal(new[] { "A", "B", "C" }, names);
    }

    [Fact]
    public void ParseSignals_accepts_legacy_bare_array()
    {
        using var doc = JsonDocument.Parse("""["X","Y"]""");
        var names = SignalHealthReading.ParseSignals(doc.RootElement);

        Assert.Equal(new[] { "X", "Y" }, names!);
    }

    [Fact]
    public void ParseSignals_drops_malformed_entries()
    {
        using var doc = JsonDocument.Parse("""{"signals":[{"name":""},{"foo":1},null,5,"Z"]}""");
        var names = SignalHealthReading.ParseSignals(doc.RootElement);

        Assert.Equal(new[] { "Z" }, names!);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("\"x\"")]
    public void ParseSignals_returns_null_for_non_collection(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SignalHealthReading.ParseSignals(doc.RootElement));
    }

    [Fact]
    public void ParseGaps_reads_timestamps_and_missing_timestamp()
    {
        using var doc = JsonDocument.Parse("""{"signals":{"A":{"value":1,"timestamp":"2026-06-06T12:00:00Z"},"B":{"value":2}}}""");
        var gaps = SignalHealthReading.ParseGaps(doc.RootElement);

        Assert.NotNull(gaps);
        Assert.Equal(2, gaps!.Count);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), gaps["A"].Timestamp);
        Assert.Null(gaps["B"].Timestamp);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("""{"vehicle_id":7}""")]
    public void ParseGaps_returns_null_without_signals_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SignalHealthReading.ParseGaps(doc.RootElement));
    }

    // ---- Freshness-age formatter (web formatAge tiers) -----------------------------

    [Fact]
    public void FormatAge_null_is_em_dash() =>
        Assert.Equal("\u2014", SignalHealthProjection.FormatAge(null, Localizer));

    [Theory]
    [InlineData(0, "0s ago")]
    [InlineData(59, "59s ago")]
    [InlineData(60, "1m ago")]
    [InlineData(3599, "59m ago")]
    [InlineData(3600, "1h ago")]
    [InlineData(7200, "2h ago")]
    public void FormatAge_matches_web(int seconds, string expected) =>
        Assert.Equal(expected, SignalHealthProjection.FormatAge(seconds, Localizer));

    // ---- Relative formatter (web formatRelative tiers) -----------------------------

    [Fact]
    public void FormatRelative_under_a_minute_is_just_now() =>
        Assert.Equal("just now", SignalHealthProjection.FormatRelative(Now.AddSeconds(-30), Now));

    [Fact]
    public void FormatRelative_minutes() =>
        Assert.Equal("5m ago", SignalHealthProjection.FormatRelative(Now.AddMinutes(-5), Now));

    [Fact]
    public void FormatRelative_hours() =>
        Assert.Equal("1h ago", SignalHealthProjection.FormatRelative(Now.AddMinutes(-90), Now));

    [Fact]
    public void FormatRelative_days() =>
        Assert.Equal("3d ago", SignalHealthProjection.FormatRelative(Now.AddDays(-3), Now));

    [Fact]
    public void FormatRelative_beyond_a_week_is_absolute_date() =>
        Assert.Equal("May 27, 2026", SignalHealthProjection.FormatRelative(Now.AddDays(-10), Now));

    // ---- Health tone thresholds (web healthLevel) ----------------------------------

    [Theory]
    [InlineData(0, 0, StatusKind.Neutral)]   // no live signals → neutral / Unknown
    [InlineData(3, 0, StatusKind.Success)]   // all fresh → green / Healthy
    [InlineData(2, 1, StatusKind.Warning)]   // 0.33 stale → amber / Degraded
    [InlineData(1, 1, StatusKind.Danger)]    // 0.50 stale → red / Critical
    [InlineData(1, 3, StatusKind.Danger)]    // 0.75 stale → red / Critical
    public void HealthLevel_matches_web(int active, int stale, StatusKind expected) =>
        Assert.Equal(expected, SignalHealthProjection.HealthLevel(active, stale));

    // ---- Analysis (active/gap split, sort, freshness age) --------------------------

    [Fact]
    public void Analyze_buckets_active_and_gap_signals()
    {
        var analysis = SignalHealthProjection.Analyze(FullReading(), Now);

        Assert.Equal(3, analysis.TotalSignals);
        Assert.Equal(1, analysis.ActiveCount);
        Assert.Equal(2, analysis.StaleCount);
        Assert.Equal(60, analysis.FreshnessAgeSeconds);
        Assert.Equal(StatusKind.Danger, analysis.Health);
    }

    [Fact]
    public void Analyze_sorts_null_last_seen_first_then_oldest()
    {
        var analysis = SignalHealthProjection.Analyze(FullReading(), Now);

        Assert.Collection(
            analysis.GapSignals,
            g => Assert.Equal("Gear", g.Name),  // null last-seen first
            g => Assert.Equal("Soc", g.Name));   // then the stale one
    }

    [Fact]
    public void Analyze_no_live_entries_is_neutral_with_no_freshness()
    {
        var reading = new SignalHealthReading(HasStats: true, Signals: new[] { "A", "B" }, Gaps: EmptyGaps());
        var analysis = SignalHealthProjection.Analyze(reading, Now);

        Assert.Equal(2, analysis.TotalSignals);
        Assert.Equal(0, analysis.ActiveCount);
        Assert.Equal(0, analysis.StaleCount);
        Assert.Null(analysis.FreshnessAgeSeconds);
        Assert.Equal(StatusKind.Neutral, analysis.Health);
    }

    [Fact]
    public void Analyze_threshold_is_exclusive_at_five_minutes()
    {
        // Exactly 300 s old is NOT > 300 → still active (web `age > STALE_THRESHOLD_MS`).
        var reading = new SignalHealthReading(
            HasStats: false,
            Signals: null,
            Gaps: new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal)
            {
                ["Edge"] = new(Now.AddSeconds(-300)),
                ["Over"] = new(Now.AddSeconds(-301)),
            });

        var analysis = SignalHealthProjection.Analyze(reading, Now);

        Assert.Equal(1, analysis.ActiveCount);
        Assert.Equal(1, analysis.StaleCount);
    }

    // ---- Projection (display values, footprint flags, gap rows) --------------------

    [Fact]
    public void Project_standard_exposes_localized_stats_and_health()
    {
        var display = SignalHealthProjection.Project(FullReading(), new SignalHealthSize(2, 4), Now, Localizer);

        Assert.True(display.HasData);
        Assert.False(display.IsCompact);
        Assert.False(display.IsWide);
        Assert.Equal("3", display.TotalSignalsText);
        Assert.Equal("1", display.ActiveText);
        Assert.Equal("2", display.WithGapsText);
        Assert.Equal("1m ago", display.FreshnessText);
        Assert.True(display.HasFreshness);
        Assert.Equal(StatusKind.Danger, display.Health);
        Assert.Equal("Critical", display.HealthText);
        Assert.Equal("1/3", display.CompactBadgeText);
        Assert.Equal("Total Signals", display.TotalSignalsLabel);
        Assert.Equal("Active", display.ActiveLabel);
        Assert.Equal("With Gaps", display.WithGapsLabel);
        Assert.Equal("Freshness", display.FreshnessLabel);
        Assert.Equal("Status", display.StatusLabel);
        Assert.Equal("signals", display.SignalsLabel);
        Assert.Equal("Stale / Gap Signals", display.StaleSignalsLabel);
    }

    [Fact]
    public void Project_gap_rows_render_relative_last_seen_and_em_dash()
    {
        var display = SignalHealthProjection.Project(FullReading(), new SignalHealthSize(4, 4), Now, Localizer);

        Assert.True(display.IsWide);
        Assert.True(display.HasGapRows);
        Assert.Collection(
            display.GapRows,
            r => AssertGapRow(r, "Gear", "\u2014"),
            r => AssertGapRow(r, "Soc", "7m ago"));
    }

    [Fact]
    public void Project_compact_sets_compact_flag_and_caps_gap_rows()
    {
        var reading = ManyGapsReading(20);

        var compact = SignalHealthProjection.Project(reading, new SignalHealthSize(1, 2), Now, Localizer);
        Assert.True(compact.IsCompact);
        Assert.Equal(SignalHealthProjection.CompactGapRowCap, compact.GapRows.Count);

        var wide = SignalHealthProjection.Project(reading, new SignalHealthSize(4, 4), Now, Localizer);
        Assert.Equal(SignalHealthProjection.StandardGapRowCap, wide.GapRows.Count);
        Assert.Equal("sig00", wide.GapRows[0].Name);
    }

    [Fact]
    public void Project_no_freshness_when_no_timestamped_signal()
    {
        var reading = new SignalHealthReading(
            HasStats: true,
            Signals: new[] { "A" },
            Gaps: new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal) { ["A"] = new((DateTimeOffset?)null) });

        var display = SignalHealthProjection.Project(reading, SignalHealthSize.Default, Now, Localizer);

        Assert.False(display.HasFreshness);
        Assert.Equal("\u2014", display.FreshnessText);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_automation_name_summarises_the_body()
    {
        var display = SignalHealthProjection.Project(FullReading(), new SignalHealthSize(2, 4), Now, Localizer);

        Assert.Equal(
            "Signal Health: Total Signals 3, Active 1, With Gaps 2, Freshness 1m ago, Status Critical",
            display.AutomationName);
    }

    [Fact]
    public void Project_compact_automation_name_summarises_the_compact_body()
    {
        var display = SignalHealthProjection.Project(FullReading(), new SignalHealthSize(1, 2), Now, Localizer);

        Assert.Equal("Signal Health: 1/3, 3 signals, Critical", display.CompactAutomationName);
    }

    // ---- Result mapper (stats-driven freshness + hasData gate) ---------------------

    [Fact]
    public void Combine_stats_only_loaded_renders_body()
    {
        using var stats = JsonDocument.Parse(StatsJson);
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.NotNull(combined.Value);
        Assert.True(combined.Value!.HasStats);
        Assert.Null(combined.Value.Signals);
        Assert.Null(combined.Value.Gaps);
        Assert.Equal(Now, combined.FetchedAt);
    }

    [Fact]
    public void Combine_signals_only_renders_body_without_stats()
    {
        using var available = JsonDocument.Parse(AvailableJson);
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Loaded(available.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.False(combined.Value!.HasStats);
        Assert.Equal(3, combined.Value.Signals!.Count);
    }

    [Fact]
    public void Combine_no_content_collapses_to_empty()
    {
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Empty, combined.Status);
        Assert.Null(combined.Value);
    }

    [Fact]
    public void Combine_stats_error_with_no_content_collapses_to_failure()
    {
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Error, combined.Status);
        Assert.NotNull(combined.Error);
    }

    [Fact]
    public void Combine_stats_error_but_other_content_keeps_body_offline()
    {
        using var live = JsonDocument.Parse(LiveJson);
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Loaded(live.RootElement, Now));

        Assert.Equal(LoadStatus.Offline, combined.Status);
        Assert.False(combined.Value!.HasStats);
        Assert.NotNull(combined.Value.Gaps);
    }

    [Fact]
    public void Combine_stats_stale_marks_body_stale()
    {
        using var stats = JsonDocument.Parse(StatsJson);
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(stats.RootElement, Now, stale: true),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Cached, combined.Status);
        Assert.True(combined.IsStale);
    }

    [Fact]
    public void Combine_stats_offline_marks_body_offline()
    {
        using var stats = JsonDocument.Parse(StatsJson);
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(stats.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Offline, combined.Status);
        Assert.True(combined.Value!.HasStats);
    }

    [Fact]
    public void Combine_stats_loading_but_other_content_keeps_body_refreshing()
    {
        using var available = JsonDocument.Parse(AvailableJson);
        var combined = SignalHealthResultMapper.Combine(
            RepositoryResult<JsonElement>.Loading(),
            RepositoryResult<JsonElement>.Loaded(available.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Refreshing, combined.Status);
        Assert.Equal(3, combined.Value!.Signals!.Count);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SignalHealthReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_body_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("3", vm.Display!.TotalSignalsText);
        Assert.Equal("Critical", vm.Display.HealthText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<SignalHealthReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No signal health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SignalHealthReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<SignalHealthReading>.Cached(FullReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<SignalHealthReading>.OfflineCached(
            FullReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SignalHealthReading>.Loading(),
            RepositoryResult<SignalHealthReading>.Cached(new SignalHealthReading(true, null, null), Now, stale: false),
            RepositoryResult<SignalHealthReading>.Loaded(FullReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(SignalHealthState.Loaded, vm.State);
        Assert.Equal("3", vm.Display!.TotalSignalsText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout()
    {
        using var vm = new SignalHealthViewModel(
            new FakeSignalHealthSource(Loaded(FullReading())), Localizer, new SignalHealthSize(1, 2), () => Now);
        await vm.LoadAsync();
        Assert.True(vm.Display!.IsCompact);

        vm.Size = new SignalHealthSize(4, 4);
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.IsWide);
        Assert.Equal(SignalHealthState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SignalHealthReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Signal Health", vm.Title);
        Assert.Equal("No signal health data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SignalHealthViewModel.State), changed);
        Assert.Contains(nameof(SignalHealthViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("signal-health", SignalHealthRegistration.Id);
        Assert.Equal("telemetry", SignalHealthRegistration.Category);
        Assert.Equal("SignalHealthWidget", SignalHealthRegistration.Slug);
        Assert.Equal(new SignalHealthSize(2, 4), SignalHealthRegistration.DefaultSize);
        Assert.Equal(new SignalHealthSize(1, 2), SignalHealthRegistration.MinSize);
        Assert.Equal(new SignalHealthSize(4, 40), SignalHealthRegistration.MaxSize);
        Assert.Equal("Signal Health", SignalHealthRegistration.Name(Localizer));
        Assert.Equal("Telemetry signal coverage: active signals, data gaps, freshness", SignalHealthRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 4, true)]    // default
    [InlineData(0, 2, false)]   // below min cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SignalHealthRegistration.IsWithinBounds(new SignalHealthSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SignalHealthSize(1, 2), SignalHealthRegistration.Clamp(new SignalHealthSize(0, 0)));
        Assert.Equal(new SignalHealthSize(4, 40), SignalHealthRegistration.Clamp(new SignalHealthSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SignalHealthDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalHealthWidget", Assert.Single(lines));
    }

    // ---- Source (concurrent three-endpoint per-vehicle adapter) --------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new KeyedFakeApiClient();
        var source = new SignalHealthSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_then_merges_three_reads()
    {
        using var stats = JsonDocument.Parse(StatsJson);
        using var available = JsonDocument.Parse(AvailableJson);
        using var live = JsonDocument.Parse(LiveJson);
        var api = new KeyedFakeApiClient()
            .Returns(StatsOperation, stats.RootElement)
            .Returns(Operations.Signals.Available, available.RootElement)
            .Returns(LiveOperation, live.RootElement);

        var source = new SignalHealthSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasStats);
        Assert.Equal(3, terminal.Value.Signals!.Count);
        Assert.Equal(3, terminal.Value.Gaps!.Count);

        Assert.Equal("7", Request(api, StatsOperation).PathParams!["vehicleID"]);
        Assert.Equal("7", Request(api, Operations.Signals.Available).PathParams!["vehicleID"]);
        Assert.Equal("7", Request(api, LiveOperation).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_scopes_every_read()
    {
        using var stats = JsonDocument.Parse(StatsJson);
        using var available = JsonDocument.Parse(AvailableJson);
        using var live = JsonDocument.Parse(LiveJson);
        var api = new KeyedFakeApiClient()
            .Returns(StatsOperation, stats.RootElement)
            .Returns(Operations.Signals.Available, available.RootElement)
            .Returns(LiveOperation, live.RootElement);

        var source = new SignalHealthSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("42", Request(api, StatsOperation).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_stats_only_content_renders_body()
    {
        using var stats = JsonDocument.Parse(StatsJson);
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(StatsOperation, stats.RootElement)
            .Returns(Operations.Signals.Available, nullBody.RootElement)
            .Returns(LiveOperation, nullBody.RootElement);

        var source = new SignalHealthSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasStats);
        Assert.Null(terminal.Value.Signals);
        Assert.Null(terminal.Value.Gaps);
    }

    [Fact]
    public async Task Source_empty_collections_still_render_body()
    {
        // Web parity: an empty catalog ([]) / empty live map ({}) are truthy → hasData → the body, not empty.
        using var stats = JsonDocument.Parse("null");
        using var emptyAvailable = JsonDocument.Parse("""{"signals":[]}""");
        using var emptyLive = JsonDocument.Parse("""{"signals":{}}""");
        var api = new KeyedFakeApiClient()
            .Returns(StatsOperation, stats.RootElement)
            .Returns(Operations.Signals.Available, emptyAvailable.RootElement)
            .Returns(LiveOperation, emptyLive.RootElement);

        var source = new SignalHealthSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.False(terminal.Value!.HasStats);
        Assert.Empty(terminal.Value.Signals!);
        Assert.Empty(terminal.Value.Gaps!);
    }

    [Fact]
    public async Task Source_all_null_bodies_collapse_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(StatsOperation, nullBody.RootElement)
            .Returns(Operations.Signals.Available, nullBody.RootElement)
            .Returns(LiveOperation, nullBody.RootElement);

        var source = new SignalHealthSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private const string StatsOperation = "get_api_v1_signals_vehicleID_stats";
    private const string LiveOperation = "get_api_v1_signals_vehicleID_live";

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static IReadOnlyDictionary<string, SignalGapEntry> EmptyGaps() =>
        new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal);

    private static SignalHealthReading FullReading() => new(
        HasStats: true,
        Signals: new[] { "VehicleSpeed", "Soc", "Gear" },
        Gaps: new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal)
        {
            ["VehicleSpeed"] = new(new DateTimeOffset(2026, 6, 6, 12, 4, 0, TimeSpan.Zero)),
            ["Soc"] = new(new DateTimeOffset(2026, 6, 6, 11, 58, 0, TimeSpan.Zero)),
            ["Gear"] = new((DateTimeOffset?)null),
        });

    private static SignalHealthReading ManyGapsReading(int count)
    {
        var gaps = new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal);
        for (int i = 0; i < count; i++)
        {
            gaps[string.Create(CultureInfo.InvariantCulture, $"sig{i:D2}")] = new((DateTimeOffset?)null);
        }

        return new SignalHealthReading(HasStats: true, Signals: null, Gaps: gaps);
    }

    private static RepositoryResult<SignalHealthReading> Loaded(SignalHealthReading reading) =>
        RepositoryResult<SignalHealthReading>.Loaded(reading, Now);

    private static SignalHealthViewModel NewViewModel(params RepositoryResult<SignalHealthReading>[] emissions) =>
        new(new FakeSignalHealthSource(emissions), Localizer, SignalHealthRegistration.DefaultSize, () => Now);

    private static async Task<List<RepositoryResult<SignalHealthReading>>> DrainAsync(ISignalHealthSource source)
    {
        var list = new List<RepositoryResult<SignalHealthReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static ApiRequest Request(KeyedFakeApiClient api, string operationId) =>
        api.Requests.First(r => r.OperationId == operationId);

    private static void AssertGapRow(SignalGapRow row, string name, string lastSeen)
    {
        Assert.Equal(name, row.Name);
        Assert.Equal(lastSeen, row.LastSeenText);
    }

    private sealed class FakeSignalHealthSource(params RepositoryResult<SignalHealthReading>[] emissions) : ISignalHealthSource
    {
        public async IAsyncEnumerable<RepositoryResult<SignalHealthReading>> StreamAsync(
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

    private sealed class KeyedFakeApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _responses = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<ApiRequest> Requests { get; } = new();

        public KeyedFakeApiClient Returns<T>(string operationId, T value)
        {
            _responses[operationId] = () => value;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                Requests.Add(request);
            }

            if (!_responses.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"No scripted response for {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
