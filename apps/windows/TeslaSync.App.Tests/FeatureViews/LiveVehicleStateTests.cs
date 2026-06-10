using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveVehicleState</c> feature surface's UI-thread-free logic — the JSON parse
/// adapter (the useSecurityLatest read of the hazards / high-beams / turn-signal / driver-seat / paired-keys /
/// valet / service / speed-limit / HomeLink / center-display fields, including the bool-or-string union), the
/// projection (ten tiles in web order, the On/Off/Occupied/Empty/count/label/em-dash value rules, the
/// <c>active</c> flag including the case-insensitive "off" check, the accessible names), the cache-then-network
/// result mapper, the per-vehicle data source (primary resolution + query-scoped request), the registry metadata,
/// the PII-safe diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty /
/// error / stale / offline). Mirrors the web spec
/// (web/src/features/admin/components/security-access/LiveVehicleState.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class LiveVehicleStateTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    private static VehicleSecurityReading Reading(
        bool? hazards = true,
        bool? highBeams = false,
        string? turnSignal = "LEFT",
        bool? driverSeat = true,
        double? pairedKeys = 2,
        bool? valet = false,
        bool? service = true,
        UnionSignal? speedLimit = null,
        double? homelink = 3,
        string? centerDisplay = "Standby") =>
        new(
            hazards,
            highBeams,
            turnSignal,
            driverSeat,
            pairedKeys,
            valet,
            service,
            speedLimit ?? new UnionSignal(true, null),
            homelink,
            centerDisplay);

    private static readonly VehicleSecurityReading NullReading =
        new(null, null, null, null, null, null, null, UnionSignal.None, null, null);

    // ── Parse adapter (web useSecurityLatest read) ────────────────────────────────────────────────────

    [Fact]
    public void FromResponse_reads_all_security_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"lights_hazards_active":true,"lights_high_beams":false,"lights_turn_signal":"LEFT",
             "driver_seat_occupied":true,"paired_phone_key_count":2,"valet_mode_enabled":false,
             "service_mode":true,"speed_limit_mode":true,"homelink_device_count":3,"center_display":"Standby"}
            """);

        var reading = VehicleSecurityReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.True(reading!.LightsHazardsActive);
        Assert.False(reading.LightsHighBeams);
        Assert.Equal("LEFT", reading.LightsTurnSignal);
        Assert.True(reading.DriverSeatOccupied);
        Assert.Equal(2, reading.PairedPhoneKeyCount);
        Assert.False(reading.ValetModeEnabled);
        Assert.True(reading.ServiceMode);
        Assert.Equal(true, reading.SpeedLimitMode.Bool);
        Assert.Null(reading.SpeedLimitMode.Text);
        Assert.Equal(3, reading.HomelinkDeviceCount);
        Assert.Equal("Standby", reading.CenterDisplay);
    }

    [Fact]
    public void FromResponse_reads_speed_limit_mode_as_string_union()
    {
        using var doc = JsonDocument.Parse("""{"speed_limit_mode":"Active"}""");

        var reading = VehicleSecurityReading.FromResponse(doc.RootElement);

        Assert.Null(reading!.SpeedLimitMode.Bool);
        Assert.Equal("Active", reading.SpeedLimitMode.Text);
        Assert.False(reading.SpeedLimitMode.IsAbsent);
    }

    [Fact]
    public void FromResponse_reads_numeric_string_counts()
    {
        using var doc = JsonDocument.Parse("""{"paired_phone_key_count":"4","homelink_device_count":"1"}""");

        var reading = VehicleSecurityReading.FromResponse(doc.RootElement);

        Assert.Equal(4, reading!.PairedPhoneKeyCount);
        Assert.Equal(1, reading.HomelinkDeviceCount);
    }

    [Fact]
    public void FromResponse_never_coerces_boolean_center_display_to_text()
    {
        // typeGuards invariant: a boolean in a string field reads as null (em dash), never "false".
        using var doc = JsonDocument.Parse("""{"center_display":false,"lights_turn_signal":true}""");

        var reading = VehicleSecurityReading.FromResponse(doc.RootElement);

        Assert.Null(reading!.CenterDisplay);
        Assert.Null(reading.LightsTurnSignal);
    }

    [Fact]
    public void FromResponse_object_with_missing_fields_is_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = VehicleSecurityReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading); // web: latest is an object (even sparse) -> ten tiles render
        Assert.Null(reading!.LightsHazardsActive);
        Assert.Null(reading.LightsTurnSignal);
        Assert.Null(reading.PairedPhoneKeyCount);
        Assert.True(reading.SpeedLimitMode.IsAbsent);
        Assert.Null(reading.CenterDisplay);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var nul = JsonDocument.Parse("null");
        Assert.Null(VehicleSecurityReading.FromResponse(nul.RootElement));

        using var array = JsonDocument.Parse("[]");
        Assert.Null(VehicleSecurityReading.FromResponse(array.RootElement));
    }

    // ── Projection: tile composition + order ──────────────────────────────────────────────────────────

    [Fact]
    public void Project_builds_ten_tiles_in_web_order()
    {
        var view = LiveVehicleStateProjection.Project(Reading(), Localizer);

        Assert.Equal(10, view.Signals.Count);
        Assert.Equal(
            new[]
            {
                "hazards", "highBeams", "turnSignal", "driverSeat", "pairedKeys",
                "valetMode", "serviceMode", "speedLimit", "homelinkDevices", "centerDisplay",
            },
            view.Signals.Select(s => s.Key).ToArray());

        Assert.Equal("Hazards", view.Signals[0].Label);
        Assert.Equal("High Beams", view.Signals[1].Label);
        Assert.Equal("Turn Signal", view.Signals[2].Label);
        Assert.Equal("Driver Seat", view.Signals[3].Label);
        Assert.Equal("Paired Keys", view.Signals[4].Label);
        Assert.Equal("Valet Mode", view.Signals[5].Label);
        Assert.Equal("Service Mode", view.Signals[6].Label);
        Assert.Equal("Speed Limit", view.Signals[7].Label);
        Assert.Equal("HomeLink Devices", view.Signals[8].Label);
        Assert.Equal("Center Display", view.Signals[9].Label);
    }

    [Fact]
    public void Project_formats_values_like_the_web()
    {
        var view = LiveVehicleStateProjection.Project(Reading(), Localizer);

        Assert.Equal("On", view.Signals[0].ValueText);        // hazards true
        Assert.Equal("Off", view.Signals[1].ValueText);       // high beams false
        Assert.Equal("LEFT", view.Signals[2].ValueText);      // turn signal string
        Assert.Equal("Occupied", view.Signals[3].ValueText);  // driver seat true
        Assert.Equal("2", view.Signals[4].ValueText);         // paired keys count
        Assert.Equal("Off", view.Signals[5].ValueText);       // valet false
        Assert.Equal("On", view.Signals[6].ValueText);        // service true
        Assert.Equal("On", view.Signals[7].ValueText);        // speed limit bool true
        Assert.Equal("3", view.Signals[8].ValueText);         // homelink count
        Assert.Equal("Standby", view.Signals[9].ValueText);   // center display string
    }

    [Fact]
    public void Project_active_flags_match_the_web()
    {
        var view = LiveVehicleStateProjection.Project(Reading(), Localizer);

        Assert.True(view.Signals[0].Active);    // hazards true
        Assert.False(view.Signals[1].Active);   // high beams false
        Assert.True(view.Signals[2].Active);    // "LEFT" has no "off"
        Assert.True(view.Signals[3].Active);    // seat occupied
        Assert.True(view.Signals[4].Active);    // 2 keys > 0
        Assert.False(view.Signals[5].Active);   // valet false
        Assert.True(view.Signals[6].Active);    // service true
        Assert.True(view.Signals[7].Active);    // speed limit bool true
        Assert.True(view.Signals[8].Active);    // 3 devices > 0
        Assert.True(view.Signals[9].Active);    // "Standby" has no "off"
    }

    [Fact]
    public void Project_all_tiles_em_dash_and_inactive_for_empty_reading()
    {
        var view = LiveVehicleStateProjection.Project(NullReading, Localizer);

        Assert.Equal(10, view.Signals.Count);
        foreach (var sig in view.Signals)
        {
            Assert.Equal(EmDash, sig.ValueText);
            Assert.False(sig.Active);
        }
    }

    [Theory]
    [InlineData(true, "On", true)]
    [InlineData(false, "Off", false)]
    [InlineData(null, EmDash, false)]
    public void Project_bool_label_signals_follow_web_boolLabel(bool? value, string expectedValue, bool expectedActive)
    {
        var view = LiveVehicleStateProjection.Project(Reading(hazards: value), Localizer);

        Assert.Equal(expectedValue, view.Signals[0].ValueText);
        Assert.Equal(expectedActive, view.Signals[0].Active);
    }

    [Theory]
    [InlineData(true, "Occupied", true)]
    [InlineData(false, "Empty", false)]
    [InlineData(null, EmDash, false)]
    public void Project_driver_seat_follows_web_branch(bool? occupied, string expectedValue, bool expectedActive)
    {
        var view = LiveVehicleStateProjection.Project(Reading(driverSeat: occupied), Localizer);

        Assert.Equal(expectedValue, view.Signals[3].ValueText);
        Assert.Equal(expectedActive, view.Signals[3].Active);
    }

    [Theory]
    [InlineData(0d, "0", false)]
    [InlineData(1d, "1", true)]
    [InlineData(5d, "5", true)]
    public void Project_paired_keys_count_and_active(double count, string expectedValue, bool expectedActive)
    {
        var view = LiveVehicleStateProjection.Project(Reading(pairedKeys: count), Localizer);

        Assert.Equal(expectedValue, view.Signals[4].ValueText);
        Assert.Equal(expectedActive, view.Signals[4].Active);
    }

    [Fact]
    public void Project_paired_keys_em_dash_when_null()
    {
        var view = LiveVehicleStateProjection.Project(Reading(pairedKeys: null), Localizer);

        Assert.Equal(EmDash, view.Signals[4].ValueText);
        Assert.False(view.Signals[4].Active);
    }

    [Fact]
    public void Project_speed_limit_boolean_branch()
    {
        var on = LiveVehicleStateProjection.Project(Reading(speedLimit: new UnionSignal(true, null)), Localizer);
        Assert.Equal("On", on.Signals[7].ValueText);
        Assert.True(on.Signals[7].Active);

        var off = LiveVehicleStateProjection.Project(Reading(speedLimit: new UnionSignal(false, null)), Localizer);
        Assert.Equal("Off", off.Signals[7].ValueText);
        Assert.False(off.Signals[7].Active);
    }

    [Theory]
    [InlineData("Active", "Active", true)]
    [InlineData("SpeedLimitOff", "SpeedLimitOff", false)] // contains "off" -> inactive
    [InlineData("", EmDash, false)]
    public void Project_speed_limit_string_branch(string text, string expectedValue, bool expectedActive)
    {
        var view = LiveVehicleStateProjection.Project(
            Reading(speedLimit: new UnionSignal(null, text)), Localizer);

        Assert.Equal(expectedValue, view.Signals[7].ValueText);
        Assert.Equal(expectedActive, view.Signals[7].Active);
    }

    [Fact]
    public void Project_speed_limit_absent_is_em_dash_inactive()
    {
        var view = LiveVehicleStateProjection.Project(
            Reading(speedLimit: UnionSignal.None), Localizer);

        Assert.Equal(EmDash, view.Signals[7].ValueText);
        Assert.False(view.Signals[7].Active);
    }

    [Theory]
    [InlineData("LEFT", true)]
    [InlineData("RIGHT", true)]
    [InlineData("OFF", false)]            // case-insensitive "off"
    [InlineData("TurnSignalOff", false)]  // substring "off"
    [InlineData("", false)]
    public void Project_turn_signal_off_detection_is_case_insensitive(string text, bool expectedActive)
    {
        var view = LiveVehicleStateProjection.Project(Reading(turnSignal: text), Localizer);

        Assert.Equal(expectedActive, view.Signals[2].Active);
        Assert.Equal(string.IsNullOrEmpty(text) ? EmDash : text, view.Signals[2].ValueText);
    }

    [Fact]
    public void Project_center_display_off_detection()
    {
        var off = LiveVehicleStateProjection.Project(Reading(centerDisplay: "DisplayOff"), Localizer);
        Assert.False(off.Signals[9].Active);
        Assert.Equal("DisplayOff", off.Signals[9].ValueText);

        var on = LiveVehicleStateProjection.Project(Reading(centerDisplay: "On"), Localizer);
        Assert.True(on.Signals[9].Active);
    }

    // ── Accessibility names (Narrator) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_tiles_have_accessibility_names()
    {
        var view = LiveVehicleStateProjection.Project(Reading(), Localizer);

        Assert.Equal("Hazards On", view.Signals[0].AutomationName);
        Assert.Equal("Driver Seat Occupied", view.Signals[3].AutomationName);
        Assert.Equal("Paired Keys 2", view.Signals[4].AutomationName);
        Assert.Equal("Center Display Standby", view.Signals[9].AutomationName);

        foreach (var sig in view.Signals)
        {
            Assert.False(string.IsNullOrWhiteSpace(sig.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(sig.Glyph));
        }

        Assert.Equal(view.Title, view.AutomationName);
    }

    [Fact]
    public void Project_resolves_title_and_live_indicator_through_i18n()
    {
        var view = LiveVehicleStateProjection.Project(Reading(), Localizer);

        Assert.Equal("Live Vehicle State", view.Title);
        Assert.Equal("Live", view.LiveIndicator);
    }

    // ── Result mapper (cache-then-network preservation) ───────────────────────────────────────────────

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"lights_hazards_active":true,"service_mode":true}""");

        var cached = LiveVehicleStateResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.LightsHazardsActive);
        Assert.True(cached.Value.ServiceMode);

        var offline = LiveVehicleStateResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.LightsHazardsActive);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"service_mode":true}""");

        Assert.Equal(LoadStatus.Loaded, LiveVehicleStateResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, LiveVehicleStateResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, LiveVehicleStateResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        // Web parity: a non-object body makes `latest` falsy -> buildLiveSignals returns [] -> empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = LiveVehicleStateResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ── View-model state matrix ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSecurityReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(10, vm.Display!.Signals.Count);
        Assert.Equal("On", vm.Display.Signals[0].ValueText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSecurityReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No live state data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleSecurityReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleSecurityReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSecurityReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleSecurityReading>.Loading(),
            RepositoryResult<VehicleSecurityReading>.Cached(Reading(hazards: false), Now, stale: false),
            RepositoryResult<VehicleSecurityReading>.Loaded(Reading(hazards: true), Now));
        await vm.LoadAsync();

        Assert.Equal(LiveVehicleStateState.Loaded, vm.State);
        Assert.Equal("On", vm.Display!.Signals[0].ValueText);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(LiveVehicleStateViewModel.State), changed);
        Assert.Contains(nameof(LiveVehicleStateViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_live_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSecurityReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Live Vehicle State", vm.Title);
        Assert.Equal("No live state data available", vm.EmptyMessage);
        Assert.Equal("Live", vm.LiveIndicator);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("live-vehicle-state", LiveVehicleStateRegistration.Id);
        Assert.Equal("LiveVehicleState", LiveVehicleStateRegistration.Slug);
        Assert.Equal("Live Vehicle State", LiveVehicleStateRegistration.Name(Localizer));
        Assert.Equal("No live state data available", LiveVehicleStateRegistration.EmptyMessage(Localizer));
        Assert.Equal("Live", LiveVehicleStateRegistration.LiveIndicator(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveVehicleState, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveVehicleStateDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveVehicleState", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_security_values()
    {
        var captured = new List<string>();
        var diagnostics = new LiveVehicleStateDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(captured, line => Assert.Equal("view.opened slug=LiveVehicleState", line));
    }

    // ── Source (per-vehicle adapter) ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new LiveVehicleStateSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_security_latest_by_query()
    {
        using var doc = JsonDocument.Parse("""{"lights_hazards_active":true,"service_mode":true}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveVehicleStateSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.LightsHazardsActive);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security_latest", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"service_mode":true}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveVehicleStateSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveVehicleStateSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ── Fakes / helpers ───────────────────────────────────────────────────────────────────────────────

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<VehicleSecurityReading>>> Drain(ILiveVehicleStateSource source)
    {
        var list = new List<RepositoryResult<VehicleSecurityReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<VehicleSecurityReading> Loaded(VehicleSecurityReading reading) =>
        RepositoryResult<VehicleSecurityReading>.Loaded(reading, Now);

    private static LiveVehicleStateViewModel NewViewModel(params RepositoryResult<VehicleSecurityReading>[] emissions) =>
        new(new FakeLiveVehicleStateSource(emissions), Localizer);

    private sealed class FakeLiveVehicleStateSource(params RepositoryResult<VehicleSecurityReading>[] emissions)
        : ILiveVehicleStateSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleSecurityReading>> StreamAsync(
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
