using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SignalLogWidget's UI-thread-free logic — the envelope parse adapter
/// (value_kind discriminator), the source→badge token map, the projection (sort / cap / value / labels),
/// the cache-then-network result mapper, the signals/second rate aggregation, the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error
/// / stale / offline) plus the Pause/Resume freeze and the compact rate readout. Mirrors the web spec
/// (web/src/features/dashboard/widgets/SignalLogWidget.tsx + the useSignalObservations / useMQTTStatus hooks).
/// </summary>
public sealed class SignalLogWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static SignalLogObservation Obs(
        string field,
        double? numeric = null,
        string? text = null,
        bool? boolean = null,
        string ts = "2026-06-06T12:00:00Z",
        string source = "fleet_telemetry",
        long vehicleId = 7) =>
        new(vehicleId, ts, field, numeric, text, boolean, source);

    // ---- Parse adapter (port of adaptObservations) ---------------------------------

    [Fact]
    public void ParseEnvelope_classifies_value_kind_and_defaults_source()
    {
        const string json = """
        {"count":3,"total":3,"observations":[
          {"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","field":"VehicleSpeed","value_kind":"ValueKindFloat","value":42.5},
          {"vehicleId":7,"ts":"2026-06-06T12:01:00Z","field":"Gear","valueKind":"ValueKindEnum","value":"ShiftStateD"},
          {"vehicle_id":7,"ts":"2026-06-06T12:02:00Z","field":"Locked","value_kind":"ValueKindBool","value":true}
        ]}
        """;
        using var doc = JsonDocument.Parse(json);

        var list = SignalLogObservation.ParseEnvelope(doc.RootElement);

        Assert.Equal(3, list.Count);

        Assert.Equal("VehicleSpeed", list[0].SignalName);
        Assert.Equal(42.5, list[0].ValueNumeric);
        Assert.Null(list[0].ValueText);
        Assert.Equal("fleet_telemetry", list[0].Source); // envelope carries none → MQTT default

        Assert.Equal("ShiftStateD", list[1].ValueText); // camelCase valueKind + vehicleId tolerated
        Assert.Equal(7, list[1].VehicleId);

        Assert.True(list[2].ValueBool);
    }

    [Fact]
    public void ParseEnvelope_honours_an_explicit_source_when_present()
    {
        const string json = """
        {"observations":[{"ts":"2026-06-06T12:00:00Z","field":"X","value_kind":"ValueKindInt32","value":5,"source":"manual"}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var obs = Assert.Single(SignalLogObservation.ParseEnvelope(doc.RootElement));

        Assert.Equal("manual", obs.Source);
        Assert.Equal(5, obs.ValueNumeric);
    }

    [Fact]
    public void ParseEnvelope_is_tolerant_of_missing_fields_and_unknown_kinds()
    {
        const string json = """
        {"observations":[{"ts":"2026-06-06T12:00:00Z","field":"Mystery","value_kind":"ValueKindCompound","value":{"a":1}}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var obs = Assert.Single(SignalLogObservation.ParseEnvelope(doc.RootElement));

        Assert.Null(obs.ValueNumeric);
        Assert.Null(obs.ValueText);
        Assert.Null(obs.ValueBool);
        Assert.Equal("\u2014", obs.FormatValue());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("""{"observations":42}""")]
    public void ParseEnvelope_returns_empty_for_non_envelope(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(SignalLogObservation.ParseEnvelope(doc.RootElement));
    }

    [Fact]
    public void FormatValue_mirrors_web_precedence()
    {
        Assert.Equal("42.5", Obs("a", numeric: 42.5).FormatValue());
        Assert.Equal("D", Obs("a", text: "D").FormatValue());
        Assert.Equal("true", Obs("a", boolean: true).FormatValue());
        Assert.Equal("false", Obs("a", boolean: false).FormatValue());
        Assert.Equal("\u2014", Obs("a").FormatValue());
    }

    // ---- Source → badge tokens (port of SOURCE_LABELS / SOURCE_COLORS) --------------

    [Theory]
    [InlineData("fleet_telemetry", "MQTT", "TsColorSuccessBrush", SignalSourceKind.Telemetry)]
    [InlineData("fleet_api", "API", "TsColorInfoBrush", SignalSourceKind.Api)]
    [InlineData("manual", "Manual", "TsColorWarningBrush", SignalSourceKind.Manual)]
    [InlineData("backfill", "Cache", "TsColorTextMutedBrush", SignalSourceKind.Backfill)]
    public void Source_tokens_map_each_known_source(string wire, string label, string brushKey, SignalSourceKind kind)
    {
        var tokens = SignalSources.TokensFor(wire);

        Assert.Equal(kind, tokens.Kind);
        Assert.Equal(label, tokens.Label);
        Assert.Equal(brushKey, tokens.AccentBrushKey);
    }

    [Fact]
    public void Source_tokens_default_null_to_cache_and_echo_unknown()
    {
        var fromNull = SignalSources.TokensFor(null);
        Assert.Equal(SignalSourceKind.Backfill, fromNull.Kind);
        Assert.Equal("Cache", fromNull.Label);

        var fromUnknown = SignalSources.TokensFor("satellite");
        Assert.Equal(SignalSourceKind.Other, fromUnknown.Kind);
        Assert.Equal("satellite", fromUnknown.Label);
        Assert.Equal("TsColorTextMutedBrush", fromUnknown.AccentBrushKey);
    }

    // ---- Size / row budget ---------------------------------------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_compact_branch_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new SignalLogSize(cols, rows).IsCompact);

    [Fact]
    public void Size_row_budget_is_a_flat_twenty() => Assert.Equal(20, SignalLogSize.MaxItems);

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_sorts_newest_first_and_caps_to_twenty()
    {
        var observations = new List<SignalLogObservation>();
        for (int i = 0; i < 25; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero)
                .ToString("o", CultureInfo.InvariantCulture);
            observations.Add(Obs($"Signal{i}", numeric: i, ts: ts));
        }

        var rows = SignalLogProjection.Project(observations, Now);

        Assert.Equal(20, rows.Count);
        Assert.Equal("Signal24", rows[0].SignalName); // newest first
        Assert.Equal("Signal5", rows[^1].SignalName);  // 20 newest of 0..24 -> 24..5
    }

    [Fact]
    public void Project_resolves_badge_value_and_relative_time()
    {
        var row = SignalLogProjection.Project([Obs("BatteryLevel", numeric: 80, source: "manual")], Now)[0];

        Assert.Equal("Manual", row.SourceLabel);
        Assert.Equal("TsColorWarningBrush", row.AccentBrushKey);
        Assert.Equal("BatteryLevel", row.SignalName);
        Assert.Equal("80", row.Value);
        Assert.Equal("5m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_signal_name()
    {
        var row = SignalLogProjection.Project([Obs("", numeric: 1)], Now)[0];
        Assert.Equal("\u2014", row.SignalName);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = SignalLogProjection.Project([Obs("VehicleSpeed", numeric: 42, source: "fleet_telemetry")], Now)[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("MQTT", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("VehicleSpeed", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("42", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        const string json = """{"observations":[{"ts":"2026-06-06T12:00:00Z","field":"X","value_kind":"ValueKindInt32","value":1}]}""";
        using var doc = JsonDocument.Parse(json);

        var cached = SignalLogResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = SignalLogResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_observations_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"observations":[]}""");
        var mapped = SignalLogResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = SignalLogResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- Rate aggregation (port of useMQTTStatus + the rate memo) -------------------

    [Fact]
    public void Rate_sums_object_map_with_both_key_casings()
    {
        const string json = """
        {"vehicles":{"VIN1":{"signals_per_second":1.5},"VIN2":{"signalsPerSecond":2.5}}}
        """;
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(4.0, SignalLogRate.Aggregate(doc.RootElement));
    }

    [Fact]
    public void Rate_sums_array_shape_and_streaming_vehicles_fallback()
    {
        using var array = JsonDocument.Parse("""{"vehicles":[{"signals_per_second":3},{"signals_per_second":4}]}""");
        Assert.Equal(7.0, SignalLogRate.Aggregate(array.RootElement));

        using var fallback = JsonDocument.Parse("""{"streaming_vehicles":{"VIN1":{"signalsPerSecond":2}}}""");
        Assert.Equal(2.0, SignalLogRate.Aggregate(fallback.RootElement));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"vehicles":{}}""")]
    [InlineData("[]")]
    public void Rate_is_zero_when_absent(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(0.0, SignalLogRate.Aggregate(doc.RootElement));
    }

    [Fact]
    public void Rate_map_preserves_status()
    {
        using var doc = JsonDocument.Parse("""{"vehicles":[{"signals_per_second":5}]}""");

        var loaded = SignalLogRate.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(5.0, loaded.Value);

        Assert.Equal(LoadStatus.Loading, SignalLogRate.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, SignalLogRate.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalLogObservation>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Loading, vm.State);
        Assert.False(vm.HasRows);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Obs("A", numeric: 1), Obs("B", numeric: 2)));
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Loaded, vm.State);
        Assert.True(vm.HasRows);
        Assert.Equal(2, vm.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalLogObservation>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Empty, vm.State);
        Assert.False(vm.HasRows);
        Assert.Equal("No signal updates yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SignalLogObservation>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SignalLogObservation>>.Cached(new[] { Obs("A", numeric: 1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalLogObservation>>.OfflineCached(
            new[] { Obs("A", numeric: 1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Offline, vm.State);
        Assert.True(vm.HasRows);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SignalLogObservation>>.Loading(),
            RepositoryResult<IReadOnlyList<SignalLogObservation>>.Cached(new[] { Obs("A", numeric: 1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<SignalLogObservation>>.Loaded(new[] { Obs("A", numeric: 1), Obs("B", numeric: 2) }, Now));
        await vm.LoadAsync();

        Assert.Equal(SignalLogState.Loaded, vm.State);
        Assert.Equal(2, vm.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_rows()
    {
        using var vm = NewViewModel(Loaded(Obs("A", numeric: 1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SignalLogViewModel.State), changed);
        Assert.Contains(nameof(SignalLogViewModel.Rows), changed);
    }

    // ---- Pause / Resume (web pausedDataRef freeze) ---------------------------------

    [Fact]
    public async Task ViewModel_pause_freezes_then_resume_thaws_the_feed()
    {
        var first = Loaded(
            Obs("Speed", numeric: 10, ts: "2026-06-06T12:00:00Z"),
            Obs("Gear", text: "D", ts: "2026-06-06T12:01:00Z"));
        var second = Loaded(Obs("Power", numeric: 99, ts: "2026-06-06T12:02:00Z"));

        var source = new FakeSignalLogSource(new[] { new[] { first }, new[] { second } });
        using var vm = new SignalLogViewModel(source, Localizer, SignalLogSize.Default, rateSource: null, clock: () => Now);

        await vm.LoadAsync();
        Assert.Equal(2, vm.Rows.Count);
        Assert.False(vm.IsPaused);
        Assert.Equal("Pause", vm.PauseToggleLabel);

        vm.TogglePause();
        Assert.True(vm.IsPaused);
        Assert.Equal("Resume", vm.PauseToggleLabel);

        // A refresh arrives while paused — the displayed feed stays frozen on the snapshot.
        await vm.LoadAsync();
        Assert.Equal(2, vm.Rows.Count);
        Assert.Contains(vm.Rows, r => r.SignalName == "Gear");

        // Resuming catches the feed up to the latest snapshot.
        vm.TogglePause();
        Assert.False(vm.IsPaused);
        var row = Assert.Single(vm.Rows);
        Assert.Equal("Power", row.SignalName);
    }

    // ---- Compact rate readout (web useMQTTStatus → big number) ----------------------

    [Fact]
    public async Task ViewModel_compact_tracks_rate_from_the_rate_source()
    {
        var rate = new FakeSignalRateSource(RepositoryResult<double>.Loaded(7.0, Now));
        using var vm = new SignalLogViewModel(
            new FakeSignalLogSource(RepositoryResult<IReadOnlyList<SignalLogObservation>>.Empty(Now)),
            Localizer,
            new SignalLogSize(1, 2),
            rateSource: rate,
            clock: () => Now);

        await vm.LoadAsync();

        Assert.True(vm.IsCompact);
        Assert.Equal(7.0, vm.Rate);
        Assert.Equal("signals/sec", vm.RatePerSecLabel);
    }

    [Fact]
    public async Task ViewModel_without_rate_source_leaves_rate_zero()
    {
        using var vm = NewViewModel(Loaded(Obs("A", numeric: 1)));
        await vm.LoadAsync();

        Assert.Equal(0.0, vm.Rate);
    }

    [Fact]
    public void ViewModel_size_change_flips_compact_flag()
    {
        using var vm = NewViewModel(Loaded(Obs("A", numeric: 1)));
        Assert.False(vm.IsCompact);

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);
        vm.Size = new SignalLogSize(1, 2);

        Assert.True(vm.IsCompact);
        Assert.Contains(nameof(SignalLogViewModel.IsCompact), raised);
    }

    [Fact]
    public async Task ViewModel_title_and_labels_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SignalLogObservation>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Signal Log", vm.Title);
        Assert.Equal("No signal updates yet", vm.EmptyMessage);
        Assert.Equal("signals/sec", vm.RatePerSecLabel);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("signal-log", SignalLogRegistration.Id);
        Assert.Equal("telemetry", SignalLogRegistration.Category);
        Assert.Equal("SignalLogWidget", SignalLogRegistration.Slug);
        Assert.Equal(new SignalLogSize(2, 4), SignalLogRegistration.DefaultSize);
        Assert.Equal(new SignalLogSize(2, 4), SignalLogRegistration.MinSize);
        Assert.Equal(new SignalLogSize(4, 40), SignalLogRegistration.MaxSize);
        Assert.Equal("Signal Log", SignalLogRegistration.Name(Localizer));
        Assert.Contains("signal", SignalLogRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SignalLogRegistration.IsWithinBounds(new SignalLogSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SignalLogSize(2, 4), SignalLogRegistration.Clamp(new SignalLogSize(1, 1)));
        Assert.Equal(new SignalLogSize(4, 40), SignalLogRegistration.Clamp(new SignalLogSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SignalLogDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalLogWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<IReadOnlyList<SignalLogObservation>> Loaded(params SignalLogObservation[] observations) =>
        RepositoryResult<IReadOnlyList<SignalLogObservation>>.Loaded(observations, Now);

    private static SignalLogViewModel NewViewModel(params RepositoryResult<IReadOnlyList<SignalLogObservation>>[] emissions) =>
        new(new FakeSignalLogSource(new[] { emissions }), Localizer, SignalLogSize.Default, rateSource: null, clock: () => Now);

    private sealed class FakeSignalLogSource : ISignalLogSource
    {
        private readonly Queue<RepositoryResult<IReadOnlyList<SignalLogObservation>>[]> _batches;

        public FakeSignalLogSource(params RepositoryResult<IReadOnlyList<SignalLogObservation>>[] emissions)
            : this(new[] { emissions })
        {
        }

        public FakeSignalLogSource(IEnumerable<RepositoryResult<IReadOnlyList<SignalLogObservation>>[]> batches) =>
            _batches = new Queue<RepositoryResult<IReadOnlyList<SignalLogObservation>>[]>(batches);

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalLogObservation>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var batch = _batches.Count > 0
                ? _batches.Dequeue()
                : Array.Empty<RepositoryResult<IReadOnlyList<SignalLogObservation>>>();

            foreach (var emission in batch)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeSignalRateSource : ISignalRateSource
    {
        private readonly RepositoryResult<double>[] _emissions;

        public FakeSignalRateSource(params RepositoryResult<double>[] emissions) => _emissions = emissions;

        public async IAsyncEnumerable<RepositoryResult<double>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
