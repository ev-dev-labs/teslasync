using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Autopilot Section surface's UI-thread-free logic — the merged
/// three-endpoint parse adapter (the wrapped vehicle-state speed + the two CruiseSetSpeed / CruiseFollowDistance
/// signal observations with the web value-kind discriminator and the FollowDistance enum strip), the SI→display
/// speed projection (the three stat tiles, the per-card em-dash, the accessible names), the cache-then-network
/// result mapper, the per-vehicle data source (primary resolution + the three query-/path-scoped requests +
/// graceful cold-signal degradation), the state-holder view-model's per-state matrix (loading / loaded / empty /
/// error / stale / offline), the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class AutopilotSectionTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Production-shape merged cache envelope: the vehicle-state body is wrapped in { state, live } (the Go
    // handler shape) and each observation body is the modern { observations: [{ value_kind, value }] } envelope.
    private const string MergedJson = """
    {
      "state": { "state": { "speed": 25.0, "vehicle_id": 7 }, "live": true },
      "cruise_set": {
        "count": 1, "total": 1,
        "observations": [
          { "ts": "2026-06-06T12:00:00Z", "field": "CruiseSetSpeed", "value_kind": "ValueKindFloat", "value": 30.0 }
        ]
      },
      "follow": {
        "count": 1, "total": 1,
        "observations": [
          { "ts": "2026-06-06T12:00:00Z", "field": "CruiseFollowDistance", "value_kind": "ValueKindEnum", "value": "FollowDistance5" }
        ]
      }
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_speed_cruise_and_follow_from_merged_envelope()
    {
        using var doc = JsonDocument.Parse(MergedJson);
        var snapshot = AutopilotSnapshot.FromJson(doc.RootElement);

        Assert.Equal(25.0, snapshot.SpeedMps);
        Assert.Equal(30.0, snapshot.CruiseSetMps);
        Assert.Equal("5", snapshot.FollowDistance);
        Assert.True(snapshot.HasData);
    }

    [Fact]
    public void FromJson_unwraps_state_envelope_and_tolerates_bare_state()
    {
        using var wrapped = JsonDocument.Parse("""{"state":{"state":{"speed":12.5}}}""");
        Assert.Equal(12.5, AutopilotSnapshot.FromJson(wrapped.RootElement).SpeedMps);

        using var bare = JsonDocument.Parse("""{"state":{"speed":9.0}}""");
        Assert.Equal(9.0, AutopilotSnapshot.FromJson(bare.RootElement).SpeedMps);
    }

    [Fact]
    public void FromJson_treats_zero_speed_as_present()
    {
        // web: speedMps = vehicleState?.speed ?? null — a present 0 is a value, not absent.
        using var doc = JsonDocument.Parse("""{"state":{"state":{"speed":0}}}""");
        var snapshot = AutopilotSnapshot.FromJson(doc.RootElement);

        Assert.Equal(0.0, snapshot.SpeedMps);
        Assert.True(snapshot.HasData);
    }

    [Theory]
    [InlineData("ValueKindFloat", 30.0)]
    [InlineData("ValueKindDouble", 27.5)]
    [InlineData("ValueKindInt32", 28)]
    [InlineData("ValueKindInt64", 31)]
    public void FromJson_reads_numeric_cruise_set_for_numeric_value_kinds(string kind, double value)
    {
        var json = "{\"cruise_set\":{\"observations\":[{\"value_kind\":\""
            + kind + "\",\"value\":" + value.ToString(CultureInfo.InvariantCulture) + "}]}}";
        using var doc = JsonDocument.Parse(json);

        Assert.Equal(value, AutopilotSnapshot.FromJson(doc.RootElement).CruiseSetMps);
    }

    [Fact]
    public void FromJson_ignores_non_numeric_cruise_set_value_kind()
    {
        // A string value-kind on the set-speed field is not a number — latestNumeric returns null (web parity).
        using var doc = JsonDocument.Parse(
            """{"cruise_set":{"observations":[{"value_kind":"ValueKindString","value":"fast"}]}}""");

        Assert.Null(AutopilotSnapshot.FromJson(doc.RootElement).CruiseSetMps);
    }

    [Fact]
    public void FromJson_reads_numeric_cruise_set_from_string_value()
    {
        // Web: typeof value === 'number' ? value : Number(value) — a numeric string still parses.
        using var doc = JsonDocument.Parse(
            """{"cruise_set":{"observations":[{"value_kind":"ValueKindDouble","value":"22.5"}]}}""");

        Assert.Equal(22.5, AutopilotSnapshot.FromJson(doc.RootElement).CruiseSetMps);
    }

    [Fact]
    public void FromJson_reads_follow_distance_enum_and_strips_prefix()
    {
        using var doc = JsonDocument.Parse(
            """{"follow":{"observations":[{"value_kind":"ValueKindEnum","value":"FollowDistance7"}]}}""");

        Assert.Equal("7", AutopilotSnapshot.FromJson(doc.RootElement).FollowDistance);
    }

    [Fact]
    public void FromJson_reads_follow_distance_numeric_fallback_as_text()
    {
        // Web fallback: a backend that re-encodes the bar-count as ValueKindInt32 still renders.
        using var doc = JsonDocument.Parse(
            """{"follow":{"observations":[{"value_kind":"ValueKindInt32","value":6}]}}""");

        Assert.Equal("6", AutopilotSnapshot.FromJson(doc.RootElement).FollowDistance);
    }

    [Fact]
    public void FromJson_tolerates_camelcase_value_kind()
    {
        // Some request middleware camelCases response keys; the web adapter tolerates both.
        using var doc = JsonDocument.Parse(
            """{"follow":{"observations":[{"valueKind":"ValueKindEnum","value":"FollowDistance4"}]}}""");

        Assert.Equal("4", AutopilotSnapshot.FromJson(doc.RootElement).FollowDistance);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_keys_and_empty_observations()
    {
        using var empty = JsonDocument.Parse("{}");
        Assert.False(AutopilotSnapshot.FromJson(empty.RootElement).HasData);

        using var emptyObs = JsonDocument.Parse(
            """{"state":{},"cruise_set":{"observations":[]},"follow":{"observations":[]}}""");
        var snapshot = AutopilotSnapshot.FromJson(emptyObs.RootElement);
        Assert.Null(snapshot.SpeedMps);
        Assert.Null(snapshot.CruiseSetMps);
        Assert.Null(snapshot.FollowDistance);
        Assert.False(snapshot.HasData);

        using var notObject = JsonDocument.Parse("[]");
        Assert.False(AutopilotSnapshot.FromJson(notObject.RootElement).HasData);
    }

    [Theory]
    [InlineData("FollowDistance7", "7")]
    [InlineData("FollowDistance3", "3")]
    [InlineData("FollowDistance10", "10")]
    [InlineData("7", "7")]
    [InlineData("Unknown", "Unknown")]
    public void ParseFollowDistance_strips_trailing_digits(string raw, string expected) =>
        Assert.Equal(expected, AutopilotSnapshot.ParseFollowDistance(raw));

    [Fact]
    public void ParseFollowDistance_null_stays_null() =>
        Assert.Null(AutopilotSnapshot.ParseFollowDistance(null));

    [Theory]
    [InlineData(25.0, null, null)]
    [InlineData(null, 30.0, null)]
    [InlineData(null, null, "5")]
    public void HasData_gate_matches_presence_of_any_value(double? speed, double? cruise, string? follow) =>
        Assert.True(new AutopilotSnapshot(speed, cruise, follow).HasData);

    [Fact]
    public void HasData_false_when_all_absent() =>
        Assert.False(AutopilotSnapshot.Empty.HasData);

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_metric_formats_three_cards()
    {
        var view = AutopilotProjection.Project(Sample(), UnitPref.Metric, Localizer);

        Assert.Equal(3, view.Cards.Count);
        Assert.True(view.HasData);

        Assert.Equal("Current Speed", view.Cards[0].Label);
        Assert.Equal("90", view.Cards[0].Value); // 25 m/s -> 90 km/h
        Assert.Equal("km/h", view.Cards[0].Sublabel);

        Assert.Equal("Cruise Set Speed", view.Cards[1].Label);
        Assert.Equal("108", view.Cards[1].Value); // 30 m/s -> 108 km/h
        Assert.Equal("km/h", view.Cards[1].Sublabel);

        Assert.Equal("Follow Distance", view.Cards[2].Label);
        Assert.Equal("5", view.Cards[2].Value);
        Assert.Equal(string.Empty, view.Cards[2].Sublabel); // web: follow-distance StatCard has no unit
    }

    [Fact]
    public void Project_imperial_converts_speeds_but_not_follow()
    {
        var view = AutopilotProjection.Project(Sample(), UnitPref.Imperial, Localizer);

        Assert.Equal("56", view.Cards[0].Value); // 25 m/s -> 55.92 mph -> 56
        Assert.Equal("mph", view.Cards[0].Sublabel);

        Assert.Equal("67", view.Cards[1].Value); // 30 m/s -> 67.11 mph -> 67
        Assert.Equal("mph", view.Cards[1].Sublabel);

        Assert.Equal("5", view.Cards[2].Value); // follow distance is a bar count, never converted
        Assert.Equal(string.Empty, view.Cards[2].Sublabel);
    }

    [Fact]
    public void Project_absent_values_render_em_dash_per_card()
    {
        var view = AutopilotProjection.Project(AutopilotSnapshot.Empty, UnitPref.Metric, Localizer);

        Assert.Equal(EmDash, view.Cards[0].Value);
        Assert.Equal(EmDash, view.Cards[1].Value);
        Assert.Equal(EmDash, view.Cards[2].Value);
        Assert.False(view.HasData);
    }

    [Fact]
    public void Project_zero_speed_renders_zero_not_em_dash()
    {
        var view = AutopilotProjection.Project(new AutopilotSnapshot(0, null, null), UnitPref.Metric, Localizer);

        Assert.Equal("0", view.Cards[0].Value);
        Assert.Equal(EmDash, view.Cards[1].Value);
        Assert.Equal(EmDash, view.Cards[2].Value);
        Assert.True(view.HasData);
    }

    [Fact]
    public void Project_cards_have_non_empty_accessibility_names()
    {
        var view = AutopilotProjection.Project(Sample(), UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
        }

        // The speed tiles fold the unit into the accessible name; the follow tile (no unit) does not.
        Assert.Equal("Current Speed: 90 km/h", view.Cards[0].AutomationName);
        Assert.Equal("Follow Distance: 5", view.Cards[2].AutomationName);
    }

    [Fact]
    public void Project_em_dash_card_name_omits_unit()
    {
        var view = AutopilotProjection.Project(AutopilotSnapshot.Empty, UnitPref.Metric, Localizer);

        Assert.Equal($"Current Speed: {EmDash}", view.Cards[0].AutomationName);
    }

    [Fact]
    public void Project_constants_match_web() => Assert.Equal("\u2014", AutopilotProjection.EmDash);

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(MergedJson);

        var cached = AutopilotResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(25.0, cached.Value!.SpeedMps);

        var offline = AutopilotResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("5", offline.Value!.FollowDistance);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse(MergedJson);

        Assert.Equal(LoadStatus.Loaded, AutopilotResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, AutopilotResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AutopilotResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, AutopilotResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AutopilotSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_three_cards()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(AutopilotSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No cruise / autopilot telemetry received yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AutopilotSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutopilotSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<AutopilotSnapshot>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_chip()
    {
        using var vm = NewViewModel(RepositoryResult<AutopilotSnapshot>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutopilotSnapshot>.Loading(),
            RepositoryResult<AutopilotSnapshot>.Cached(Sample(), Now, stale: false),
            RepositoryResult<AutopilotSnapshot>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(AutopilotState.Loaded, vm.State);
        Assert.Equal("90", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();
        Assert.Equal("km/h", vm.Display.Cards[0].Sublabel);
        Assert.Equal("90", vm.Display.Cards[0].Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("mph", vm.Display.Cards[0].Sublabel);
        Assert.Equal("56", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AutopilotSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Autopilot & Cruise", vm.Title);
        Assert.Equal("No cruise / autopilot telemetry received yet", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AutopilotSectionViewModel.State), changed);
        Assert.Contains(nameof(AutopilotSectionViewModel.Display), changed);
    }

    // ---- Repository source (engine + fake client) ----------------------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_and_two_observations()
    {
        using var state = JsonDocument.Parse("""{"state":{"speed":25.0},"live":true}""");
        using var cruise = JsonDocument.Parse(
            """{"observations":[{"value_kind":"ValueKindFloat","value":30.0}]}""");
        using var follow = JsonDocument.Parse(
            """{"observations":[{"value_kind":"ValueKindEnum","value":"FollowDistance5"}]}""");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement)
            .ReturnsValue(cruise.RootElement)
            .ReturnsValue(follow.RootElement);
        var source = new AutopilotSectionSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(25.0, terminal.Value!.SpeedMps);
        Assert.Equal(30.0, terminal.Value.CruiseSetMps);
        Assert.Equal("5", terminal.Value.FollowDistance);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);

        Assert.Equal("get_api_v1_signals_observations", api.Requests[1].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal("CruiseSetSpeed", api.Requests[1].Query!["field"]);
        Assert.Equal(1, Convert.ToInt32(api.Requests[1].Query!["limit"], CultureInfo.InvariantCulture));

        Assert.Equal("get_api_v1_signals_observations", api.Requests[2].OperationId);
        Assert.Equal("CruiseFollowDistance", api.Requests[2].Query!["field"]);
    }

    [Fact]
    public async Task Source_uses_explicit_vehicle_id_without_consulting_primary()
    {
        using var state = JsonDocument.Parse("""{"state":{"speed":18.0}}""");
        using var cruise = JsonDocument.Parse("""{"observations":[]}""");
        using var follow = JsonDocument.Parse("""{"observations":[]}""");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement)
            .ReturnsValue(cruise.RootElement)
            .ReturnsValue(follow.RootElement);
        var source = new AutopilotSectionSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("42", api.Requests[0].PathParams!["vehicleID"]);
        Assert.Equal(42L, Convert.ToInt64(api.Requests[1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_no_vehicle_streams_empty_without_requests()
    {
        var api = new FakeApiClient();
        var source = new AutopilotSectionSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_tolerates_failed_cold_signal_read()
    {
        // Web parity: the three queries are independent — a failed observation read just leaves that value
        // absent while the dominant state read still drives the panel.
        using var state = JsonDocument.Parse("""{"state":{"speed":20.0}}""");
        using var follow = JsonDocument.Parse(
            """{"observations":[{"value_kind":"ValueKindEnum","value":"FollowDistance3"}]}""");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement)
            .Throws(new TimeoutException("cruise observation down"))
            .ReturnsValue(follow.RootElement);
        var source = new AutopilotSectionSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 5 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(20.0, terminal.Value!.SpeedMps);
        Assert.Null(terminal.Value.CruiseSetMps);   // the failed read leaves cruise absent
        Assert.Equal("3", terminal.Value.FollowDistance);
    }

    [Fact]
    public async Task Source_all_absent_body_streams_empty()
    {
        using var state = JsonDocument.Parse("{}");
        using var cruise = JsonDocument.Parse("""{"observations":[]}""");
        using var follow = JsonDocument.Parse("""{"observations":[]}""");

        var api = new FakeApiClient()
            .ReturnsValue(state.RootElement)
            .ReturnsValue(cruise.RootElement)
            .ReturnsValue(follow.RootElement);
        var source = new AutopilotSectionSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 9 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("autopilot-section", AutopilotSectionRegistration.Id);
        Assert.Equal("driving", AutopilotSectionRegistration.Category);
        Assert.Equal("AutopilotSection", AutopilotSectionRegistration.Slug);
        Assert.Equal(1, AutopilotSectionRegistration.ObservationLimit);
        Assert.Equal("CruiseSetSpeed", AutopilotSectionRegistration.CruiseSetField);
        Assert.Equal("CruiseFollowDistance", AutopilotSectionRegistration.FollowDistanceField);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new AutopilotSectionDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutopilotSection", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static AutopilotSnapshot Sample() => new(SpeedMps: 25.0, CruiseSetMps: 30.0, FollowDistance: "5");

    private static RepositoryResult<AutopilotSnapshot> Loaded(AutopilotSnapshot snapshot) =>
        RepositoryResult<AutopilotSnapshot>.Loaded(snapshot, Now);

    private static AutopilotSectionViewModel NewViewModel(params RepositoryResult<AutopilotSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric, () => Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<AutopilotSnapshot>>> Drain(IAutopilotSectionSource source)
    {
        var list = new List<RepositoryResult<AutopilotSnapshot>>();
        await foreach (var item in source.StreamAsync())
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<AutopilotSnapshot>[] emissions) : IAutopilotSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<AutopilotSnapshot>> StreamAsync(
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
