using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets.VehicleSpecs;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the VehicleSpecsWidget's UI-thread-free logic — the three-source JSON parse
/// adapter (specs / options envelopes → <c>data</c>, config response → snapshot), the verbatim <c>asString</c>
/// port, the projection (the seven fixed detail rows with their specs→config fallback chains, the badged
/// factory-option rows capped at eight / dropped in compact, and the compact Model + "Trim: …" readouts), the
/// footprint flags, the three-call concurrent source composition (primary resolution + per-vehicle reads,
/// partial-failure tolerance, all-fail propagation, the no-vehicle short-circuit), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) plus footprint re-projection. Mirrors the web spec
/// (web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx).
/// </summary>
public sealed class VehicleSpecsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private const string EmDash = "\u2014";

    private static VehicleSpecsInfo Specs(
        string? carType = "Model 3",
        string? model = null,
        string? trimBadging = "Performance",
        string? trim = null,
        string? exteriorColor = "Deep Blue Metallic",
        string? wheelType = "Überturbine 20\"",
        string? interior = "Black",
        string? interiorColor = null,
        string? auxBatteryType = "Lithium",
        string? carVersion = null) =>
        new(carType, model, trimBadging, trim, exteriorColor, wheelType, interior, interiorColor, auxBatteryType, carVersion);

    private static VehicleConfigInfo Config(
        string? carType = "models2",
        string? trim = "P100D",
        string? exteriorColor = "PPSW",
        string? wheelType = "AeroTurbine19",
        string? version = "2026.4.1") =>
        new(carType, trim, exteriorColor, wheelType, version);

    private static VehicleSpecsSnapshot Snapshot(
        VehicleSpecsInfo? specs = null,
        IReadOnlyList<VehicleSpecOption>? options = null,
        VehicleConfigInfo? config = null) =>
        new(specs, options, config);

    // ---- asString adapter (web asString parity) ------------------------------------

    [Fact]
    public void AsString_returns_nonempty_strings_and_stringifies_numbers()
    {
        using var doc = JsonDocument.Parse("""{"s":"hi","e":"","n":42,"f":1.5,"b":true,"z":null,"o":{},"a":[]}""");
        var root = doc.RootElement;

        Assert.Equal("hi", VehicleSpecsJson.AsString(root.GetProperty("s")));
        Assert.Null(VehicleSpecsJson.AsString(root.GetProperty("e")));   // empty string → null
        Assert.Equal("42", VehicleSpecsJson.AsString(root.GetProperty("n")));
        Assert.Equal("1.5", VehicleSpecsJson.AsString(root.GetProperty("f")));
        Assert.Null(VehicleSpecsJson.AsString(root.GetProperty("b")));   // boolean → null
        Assert.Null(VehicleSpecsJson.AsString(root.GetProperty("z")));   // null → null
        Assert.Null(VehicleSpecsJson.AsString(root.GetProperty("o")));   // object → null
        Assert.Null(VehicleSpecsJson.AsString(root.GetProperty("a")));   // array → null
    }

    // ---- Parse adapter: specs envelope ---------------------------------------------

    [Fact]
    public void ParseSpecs_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"data":{"car_type":"Model S","model":"S","trim_badging":"Plaid","trim":"P","exterior_color":"Red Multi-Coat",
            "wheel_type":"Arachnid","interior":"Cream","interior_color":"White","aux_battery_type":"Li-Ion",
            "car_version":"2026.8.1"},"fetched_at":"2026-06-06T00:00:00Z"}
            """);

        var specs = VehicleSpecsInfo.ParseEnvelope(doc.RootElement);

        Assert.NotNull(specs);
        Assert.Equal("Model S", specs!.CarType);
        Assert.Equal("Plaid", specs.TrimBadging);
        Assert.Equal("Red Multi-Coat", specs.ExteriorColor);
        Assert.Equal("Arachnid", specs.WheelType);
        Assert.Equal("Cream", specs.Interior);
        Assert.Equal("Li-Ion", specs.AuxBatteryType);
        Assert.Equal("2026.8.1", specs.CarVersion);
    }

    [Fact]
    public void ParseSpecs_null_data_is_null()
    {
        using var doc = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");
        Assert.Null(VehicleSpecsInfo.ParseEnvelope(doc.RootElement));
    }

    [Fact]
    public void ParseSpecs_absent_data_is_null()
    {
        using var doc = JsonDocument.Parse("""{"fetched_at":"2026-06-06T00:00:00Z"}""");
        Assert.Null(VehicleSpecsInfo.ParseEnvelope(doc.RootElement));
    }

    [Fact]
    public void ParseSpecs_non_object_is_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleSpecsInfo.ParseEnvelope(doc.RootElement));
    }

    [Fact]
    public void ParseSpecs_sparse_data_object_is_non_null_with_null_fields()
    {
        // Web parity: a specs object whose fields are all undefined is still a non-null `specs`.
        using var doc = JsonDocument.Parse("""{"data":{},"fetched_at":null}""");
        var specs = VehicleSpecsInfo.ParseEnvelope(doc.RootElement);

        Assert.NotNull(specs);
        Assert.Null(specs!.CarType);
        Assert.Null(specs.CarVersion);
    }

    // ---- Parse adapter: config response --------------------------------------------

    [Fact]
    public void ParseConfig_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"id":1,"vehicle_id":7,"car_type":"models2","trim":"P100D","exterior_color":"PPSW","wheel_type":"Aero19","version":"2026.4.1"}""");

        var config = VehicleConfigInfo.ParseResponse(doc.RootElement);

        Assert.NotNull(config);
        Assert.Equal("models2", config!.CarType);
        Assert.Equal("P100D", config.Trim);
        Assert.Equal("PPSW", config.ExteriorColor);
        Assert.Equal("Aero19", config.WheelType);
        Assert.Equal("2026.4.1", config.Version);
    }

    [Fact]
    public void ParseConfig_null_body_is_null()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Null(VehicleConfigInfo.ParseResponse(doc.RootElement));
    }

    // ---- Parse adapter: options envelope -------------------------------------------

    [Fact]
    public void ParseOptions_decodes_values_in_document_order()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"$MT304":"Performance","$PBSB":"Black","$WTUT":"Turbine Wheels"}}""");

        var options = VehicleSpecOption.ParseEnvelope(doc.RootElement);

        Assert.NotNull(options);
        Assert.Equal(3, options!.Count);
        Assert.Equal("$MT304", options[0].Code);
        Assert.Equal("Performance", options[0].Decoded);
        Assert.Equal("$WTUT", options[2].Code);
        Assert.Equal("Turbine Wheels", options[2].Decoded);
    }

    [Fact]
    public void ParseOptions_falls_back_to_code_when_value_is_not_a_string_or_number()
    {
        // Web parity: decoded = asString(options[key]) ?? key — bool / null / empty fall back to the code.
        using var doc = JsonDocument.Parse(
            """{"data":{"$N":123,"$B":true,"$E":"","$Z":null,"$S":"Premium"}}""");

        var options = VehicleSpecOption.ParseEnvelope(doc.RootElement)!;

        Assert.Equal("123", options[0].Decoded);  // number stringified
        Assert.Equal("$B", options[1].Decoded);   // bool → key
        Assert.Equal("$E", options[2].Decoded);   // empty string → key
        Assert.Equal("$Z", options[3].Decoded);   // null → key
        Assert.Equal("Premium", options[4].Decoded);
    }

    [Fact]
    public void ParseOptions_empty_object_is_non_null_empty_list()
    {
        // Web parity: an empty options object is truthy (hasAnyData) but yields no option rows.
        using var doc = JsonDocument.Parse("""{"data":{}}""");
        var options = VehicleSpecOption.ParseEnvelope(doc.RootElement);

        Assert.NotNull(options);
        Assert.Empty(options!);
    }

    [Fact]
    public void ParseOptions_null_data_is_null()
    {
        using var doc = JsonDocument.Parse("""{"data":null}""");
        Assert.Null(VehicleSpecOption.ParseEnvelope(doc.RootElement));
    }

    // ---- Snapshot hasAnyData -------------------------------------------------------

    [Fact]
    public void Snapshot_has_any_data_when_any_part_present()
    {
        Assert.False(Snapshot().HasAnyData);
        Assert.True(Snapshot(specs: Specs()).HasAnyData);
        Assert.True(Snapshot(options: Array.Empty<VehicleSpecOption>()).HasAnyData);
        Assert.True(Snapshot(config: Config()).HasAnyData);
    }

    [Fact]
    public void Snapshot_from_json_composes_three_bodies()
    {
        using var specs = JsonDocument.Parse("""{"data":{"car_type":"Model X"}}""");
        using var options = JsonDocument.Parse("""{"data":{"$MT":"Long Range"}}""");
        using var config = JsonDocument.Parse("""{"version":"2026.4"}""");

        var snapshot = VehicleSpecsSnapshot.FromJson(specs.RootElement, options.RootElement, config.RootElement);

        Assert.Equal("Model X", snapshot.Specs!.CarType);
        Assert.Equal("Long Range", snapshot.Options![0].Decoded);
        Assert.Equal("2026.4", snapshot.Config!.Version);
        Assert.True(snapshot.HasAnyData);
    }

    [Fact]
    public void Snapshot_round_trips_through_json_cache()
    {
        var original = Snapshot(
            Specs(carVersion: "2026.8"),
            new[] { new VehicleSpecOption("$MT", "Performance") },
            Config());
        var json = JsonSerializer.Serialize(original, ApiClientOptions.CreateJsonOptions());
        var restored = JsonSerializer.Deserialize<VehicleSpecsSnapshot>(json, ApiClientOptions.CreateJsonOptions());

        Assert.NotNull(restored);
        Assert.Equal("Model 3", restored!.Specs!.CarType);
        Assert.Equal("$MT", restored.Options![0].Code);
        Assert.Equal("2026.4.1", restored.Config!.Version);
        Assert.True(restored.HasAnyData);
    }

    // ---- Projection: detail entries ------------------------------------------------

    [Fact]
    public void Project_builds_seven_base_entries_with_labels()
    {
        var display = Project(Snapshot(Specs()));

        Assert.True(display.HasAnyData);
        Assert.Equal(7, display.Entries.Count);

        Assert.Equal("Model", display.Entries[0].Label);
        Assert.Equal("Model 3", display.Entries[0].Value);
        Assert.Equal("Trim", display.Entries[1].Label);
        Assert.Equal("Performance", display.Entries[1].Value);
        Assert.Equal("Paint Color", display.Entries[2].Label);
        Assert.Equal("Deep Blue Metallic", display.Entries[2].Value);
        Assert.Equal("Wheels", display.Entries[3].Label);
        Assert.Equal("Interior", display.Entries[4].Label);
        Assert.Equal("Black", display.Entries[4].Value);
        Assert.Equal("Aux Battery", display.Entries[5].Label);
        Assert.Equal("Lithium", display.Entries[5].Value);
        Assert.Equal("Car Version", display.Entries[6].Label);
        Assert.True(display.Entries[6].Mono);   // web `mono: true`
    }

    [Fact]
    public void Project_falls_back_through_specs_then_config()
    {
        // Web chains: model = car_type ?? model ?? config.car_type; trim = trim_badging ?? trim ?? config.trim;
        // carVersion = config.version ?? specs.car_version; paint/wheels = specs ?? config.
        var specs = Specs(carType: null, model: "M3", trimBadging: null, trim: null, exteriorColor: null, wheelType: null, carVersion: "CV-fallback");
        var display = Project(Snapshot(specs, config: Config(carType: "configType", trim: "configTrim", exteriorColor: "configPaint", wheelType: "configWheels", version: "configVer")));

        Assert.Equal("M3", display.Entries[0].Value);          // specs.model (car_type null)
        Assert.Equal("configTrim", display.Entries[1].Value);  // config.trim (specs trim null)
        Assert.Equal("configPaint", display.Entries[2].Value); // config.exterior_color
        Assert.Equal("configWheels", display.Entries[3].Value);
        Assert.Equal("configVer", display.Entries[6].Value);   // config.version wins over specs.car_version
    }

    [Fact]
    public void Project_keeps_null_values_for_em_dash_render_and_accessibility()
    {
        var display = Project(Snapshot(Specs(carType: null, model: null, auxBatteryType: null), config: Config(carType: null, version: null)));

        Assert.Null(display.Entries[0].Value);                 // Model unresolved
        Assert.Equal($"Model: {EmDash}", display.Entries[0].AccessibilityName);
        Assert.Null(display.Entries[5].Value);                 // Aux Battery unresolved
    }

    [Fact]
    public void Project_appends_capped_badged_option_rows()
    {
        var options = Enumerable.Range(0, 10)
            .Select(i => new VehicleSpecOption($"$OPT{i}", $"Decoded {i}"))
            .ToArray();
        var display = Project(Snapshot(Specs(), options));

        Assert.Equal(7 + VehicleSpecsSize.MaxOptions, display.Entries.Count); // 8 of 10 options shown

        var firstOption = display.Entries[7];
        Assert.Equal("$OPT0", firstOption.Label);
        Assert.Equal("Decoded 0", firstOption.Value);
        Assert.Equal("Option", firstOption.BadgeText);
        Assert.Equal("$OPT0: Decoded 0, Option", firstOption.AccessibilityName);
    }

    [Fact]
    public void Project_drops_option_rows_in_compact()
    {
        var options = new[] { new VehicleSpecOption("$MT", "Performance") };
        var display = Project(Snapshot(Specs(), options), new VehicleSpecsSize(1, 2));

        Assert.True(display.IsCompact);
        Assert.Equal(7, display.Entries.Count); // only the base rows; options dropped (web slice(0, 0))
    }

    [Fact]
    public void Project_base_rows_carry_no_badge()
    {
        var display = Project(Snapshot(Specs()));
        Assert.All(display.Entries, e => Assert.Null(e.BadgeText));
    }

    // ---- Projection: compact readouts ----------------------------------------------

    [Fact]
    public void Project_compact_model_and_trim_line()
    {
        var display = Project(Snapshot(Specs(carType: "Model Y", trimBadging: "Long Range")), new VehicleSpecsSize(1, 2));

        Assert.Equal("Model Y", display.CompactModel);
        Assert.Equal("Trim: Long Range", display.CompactTrimLine);
        Assert.Equal("Model: Model Y, Trim: Long Range", display.CompactAccessibilityName);
    }

    [Fact]
    public void Project_compact_uses_em_dash_for_missing_model_and_trim()
    {
        var display = Project(Snapshot(Specs(carType: null, model: null, trimBadging: null, trim: null), config: Config(carType: null, trim: null)), new VehicleSpecsSize(1, 2));

        Assert.Equal(EmDash, display.CompactModel);
        Assert.Equal($"Trim: {EmDash}", display.CompactTrimLine);
    }

    [Fact]
    public void Project_no_data_flag()
    {
        var display = Project(VehicleSpecsSnapshot.Empty);

        Assert.False(display.HasAnyData);
        Assert.Equal(7, display.Entries.Count); // entries computed even when empty (web useMemo); body gated separately
    }

    // ---- Footprint -----------------------------------------------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_is_compact_at_single_column(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new VehicleSpecsSize(cols, rows).IsCompact);

    [Fact]
    public void Size_max_options_is_eight() =>
        Assert.Equal(8, VehicleSpecsSize.MaxOptions);

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSpecsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_data_exposes_entries()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Specs(), config: Config())));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Loaded, vm.State);
        Assert.True(vm.HasAnyData);
        Assert.Equal(7, vm.Display.Entries.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_is_empty()
    {
        using var vm = NewViewModel(Loaded(VehicleSpecsSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Empty, vm.State);
        Assert.False(vm.HasAnyData);
        Assert.Equal("No specs available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSpecsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Empty, vm.State);
        Assert.False(vm.HasAnyData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleSpecsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_entries()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleSpecsSnapshot>.Cached(Snapshot(Specs()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasAnyData);
        Assert.Equal(7, vm.Display.Entries.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_entries_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleSpecsSnapshot>.OfflineCached(
            Snapshot(Specs()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Offline, vm.State);
        Assert.True(vm.HasAnyData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleSpecsSnapshot>.Loading(),
            RepositoryResult<VehicleSpecsSnapshot>.Cached(Snapshot(Specs(carVersion: "old")), Now, stale: false),
            RepositoryResult<VehicleSpecsSnapshot>.Loaded(Snapshot(Specs(), config: Config(version: "2026.9")), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleSpecsState.Loaded, vm.State);
        Assert.Equal("2026.9", vm.Display.Entries[6].Value); // config.version wins for Car Version
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_and_option_cap()
    {
        var options = new[] { new VehicleSpecOption("$MT", "Performance") };
        using var vm = NewViewModel(new VehicleSpecsSize(2, 4), Loaded(Snapshot(Specs(), options)));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.Equal(8, vm.Display.Entries.Count); // 7 base + 1 option

        vm.Size = new VehicleSpecsSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(7, vm.Display.Entries.Count); // option dropped in compact
        Assert.Equal(VehicleSpecsState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(Loaded(VehicleSpecsSnapshot.Empty));
        await vm.LoadAsync();

        Assert.Equal("Vehicle Specs", vm.Title);
        Assert.Equal("No specs available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Specs())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VehicleSpecsViewModel.State), changed);
        Assert.Contains(nameof(VehicleSpecsViewModel.Display), changed);
    }

    // ---- Source: three-call per-vehicle composition --------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new VehicleSpecsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_then_reads_specs_options_config_with_params()
    {
        using var specs = JsonDocument.Parse("""{"data":{"car_type":"Model 3"}}""");
        using var options = JsonDocument.Parse("""{"data":{"$MT":"Performance"}}""");
        using var config = JsonDocument.Parse("""{"version":"2026.4"}""");
        var api = new FakeApiClient()
            .ReturnsValue(specs.RootElement)
            .ReturnsValue(options.RootElement)
            .ReturnsValue(config.RootElement);
        var source = new VehicleSpecsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("Model 3", terminal.Value!.Specs!.CarType);
        Assert.Equal("Performance", terminal.Value.Options![0].Decoded);
        Assert.Equal("2026.4", terminal.Value.Config!.Version);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal(VehicleSpecsRegistration.SpecsOperationId, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams![VehicleSpecsRegistration.VehiclePathParam]);
        Assert.Equal(VehicleSpecsRegistration.OptionsOperationId, api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].PathParams![VehicleSpecsRegistration.VehiclePathParam]);
        Assert.Equal(VehicleSpecsRegistration.ConfigOperationId, api.Requests[2].OperationId);
        Assert.Equal(7L, Assert.IsType<long>(api.Requests[2].Query![VehicleSpecsRegistration.VehicleQueryParam]));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var specs = JsonDocument.Parse("""{"data":{"car_type":"Model S"}}""");
        using var options = JsonDocument.Parse("""{"data":null}""");
        using var config = JsonDocument.Parse("null");
        var api = new FakeApiClient()
            .ReturnsValue(specs.RootElement)
            .ReturnsValue(options.RootElement)
            .ReturnsValue(config.RootElement);
        var source = new VehicleSpecsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("42", api.Requests[0].PathParams![VehicleSpecsRegistration.VehiclePathParam]);
        Assert.Equal(42L, Assert.IsType<long>(api.Requests[2].Query![VehicleSpecsRegistration.VehicleQueryParam]));
    }

    [Fact]
    public async Task Source_tolerates_a_single_failing_endpoint()
    {
        // Web parity: an errored options query leaves options undefined while specs + config still render.
        using var specs = JsonDocument.Parse("""{"data":{"car_type":"Model 3"}}""");
        using var config = JsonDocument.Parse("""{"version":"2026.4"}""");
        var api = new FakeApiClient()
            .ReturnsValue(specs.RootElement)
            .Throws(new InvalidOperationException("options boom"))
            .ReturnsValue(config.RootElement);
        var source = new VehicleSpecsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("Model 3", terminal.Value!.Specs!.CarType);
        Assert.Null(terminal.Value.Options);            // the failing endpoint stays null
        Assert.Equal("2026.4", terminal.Value.Config!.Version);
    }

    [Fact]
    public async Task Source_all_endpoints_failing_surfaces_error()
    {
        var api = new FakeApiClient()
            .Throws(new InvalidOperationException("specs"))
            .Throws(new InvalidOperationException("options"))
            .Throws(new InvalidOperationException("config"));
        var source = new VehicleSpecsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Error, terminal.Status);
    }

    [Fact]
    public async Task Source_all_empty_bodies_collapse_to_empty()
    {
        using var specs = JsonDocument.Parse("""{"data":null}""");
        using var options = JsonDocument.Parse("""{"data":null}""");
        using var config = JsonDocument.Parse("null");
        var api = new FakeApiClient()
            .ReturnsValue(specs.RootElement)
            .ReturnsValue(options.RootElement)
            .ReturnsValue(config.RootElement);
        var source = new VehicleSpecsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Empty, terminal.Status);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("vehicle-specs", VehicleSpecsRegistration.Id);
        Assert.Equal("vehicle", VehicleSpecsRegistration.Category);
        Assert.Equal("VehicleSpecsWidget", VehicleSpecsRegistration.Slug);
        Assert.Equal(new VehicleSpecsSize(2, 4), VehicleSpecsRegistration.DefaultSize);
        Assert.Equal(new VehicleSpecsSize(1, 2), VehicleSpecsRegistration.MinSize);
        Assert.Equal(new VehicleSpecsSize(4, 40), VehicleSpecsRegistration.MaxSize);
        Assert.Equal("Vehicle Specs", VehicleSpecsRegistration.Name(Localizer));
        Assert.Contains("Configuration reference", VehicleSpecsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]
    [InlineData(4, 40, true)]
    [InlineData(0, 4, false)]
    [InlineData(5, 40, false)]
    [InlineData(2, 41, false)]
    [InlineData(2, 1, false)]
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, VehicleSpecsRegistration.IsWithinBounds(new VehicleSpecsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new VehicleSpecsSize(1, 2), VehicleSpecsRegistration.Clamp(new VehicleSpecsSize(0, 0)));
        Assert.Equal(new VehicleSpecsSize(4, 40), VehicleSpecsRegistration.Clamp(new VehicleSpecsSize(9, 99)));
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.TryGetValue(VehicleSpecsRegistration.SpecsOperationId, out var specs));
        Assert.Contains(VehicleSpecsRegistration.VehiclePathParam, specs!.PathParams);
        Assert.True(index.TryGetValue(VehicleSpecsRegistration.OptionsOperationId, out var options));
        Assert.Contains(VehicleSpecsRegistration.VehiclePathParam, options!.PathParams);
        Assert.True(index.ContainsKey(VehicleSpecsRegistration.ConfigOperationId));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleSpecsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleSpecsWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static VehicleSpecsDisplay Project(VehicleSpecsSnapshot snapshot) =>
        Project(snapshot, VehicleSpecsSize.Default);

    private static VehicleSpecsDisplay Project(VehicleSpecsSnapshot snapshot, VehicleSpecsSize size) =>
        VehicleSpecsProjection.Project(snapshot, size, Localizer);

    private static RepositoryResult<VehicleSpecsSnapshot> Loaded(VehicleSpecsSnapshot snapshot) =>
        RepositoryResult<VehicleSpecsSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<VehicleSpecsSnapshot>>> Drain(IVehicleSpecsSource source)
    {
        var results = new List<RepositoryResult<VehicleSpecsSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static VehicleSpecsViewModel NewViewModel(params RepositoryResult<VehicleSpecsSnapshot>[] emissions) =>
        NewViewModel(VehicleSpecsSize.Default, emissions);

    private static VehicleSpecsViewModel NewViewModel(
        VehicleSpecsSize size,
        params RepositoryResult<VehicleSpecsSnapshot>[] emissions) =>
        new(new FakeVehicleSpecsSource(emissions), Localizer, size);

    private sealed class FakeVehicleSpecsSource(params RepositoryResult<VehicleSpecsSnapshot>[] emissions)
        : IVehicleSpecsSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleSpecsSnapshot>> StreamAsync(
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
