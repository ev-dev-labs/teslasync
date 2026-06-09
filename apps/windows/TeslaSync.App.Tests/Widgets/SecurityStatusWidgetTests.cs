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
/// Headless verification of the SecurityStatusWidget's UI-thread-free logic — the JSON parse adapter (the
/// useSecurityLatest read), the web-faithful door open-count (<c>door_state === true ? 1 : parts.includes
/// 'open'</c>) and window open-count (<c>typeof boolean ? val : asNonEmptyString &amp;&amp; !== 'closed'</c>), the
/// status / value / icon mapping for the four cells (lock / sentry / doors / windows), the Narrator names, the
/// result mapper, the single-endpoint per-vehicle data source (primary resolution + the query-scoped security
/// read), the registry metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/SecurityStatusWidget.tsx).
/// </summary>
public sealed class SecurityStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string SecureJson =
        """{"vehicle_id":7,"ts":"2026-06-06T12:00:00Z","locked":true,"sentry_mode":true,"door_state":"all_closed","fd_window":"closed","fp_window":"closed","rd_window":"closed","rp_window":"closed"}""";

    private const string OpenJson =
        """{"vehicle_id":7,"locked":false,"sentry_mode":false,"door_state":"driver_front_open, passenger_rear_open","fd_window":"open","fp_window":"vent","rd_window":false,"rp_window":"closed"}""";

    // ---- Parse adapter (web useSecurityLatest read) --------------------------------

    [Fact]
    public void FromResponse_reads_all_security_fields()
    {
        using var doc = JsonDocument.Parse(SecureJson);

        var reading = SecurityStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.True(reading!.Locked);
        Assert.True(reading.SentryMode);
        Assert.Equal(SecurityScalarKind.Text, reading.DoorState.Kind);
        Assert.Equal("all_closed", reading.DoorState.TextValue);
        Assert.Equal(SecurityScalarKind.Text, reading.FdWindow.Kind);
    }

    [Fact]
    public void FromResponse_reads_native_boolean_window_and_string_door()
    {
        using var doc = JsonDocument.Parse(OpenJson);

        var reading = SecurityStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.False(reading!.Locked);
        Assert.False(reading.SentryMode);
        // rd_window arrived as a native boolean false.
        Assert.Equal(SecurityScalarKind.Boolean, reading.RdWindow.Kind);
        Assert.False(reading.RdWindow.BooleanValue);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        // Web parity: securityData is truthy but the individual fields are undefined.
        using var doc = JsonDocument.Parse("""{"ts":"t"}""");

        var reading = SecurityStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.False(reading!.Locked);
        Assert.False(reading.SentryMode);
        Assert.Equal(SecurityScalarKind.None, reading.DoorState.Kind);
        Assert.Equal(SecurityScalarKind.None, reading.FpWindow.Kind);
    }

    [Fact]
    public void FromResponse_treats_explicit_false_and_null_locked_as_unlocked()
    {
        using var falseLocked = JsonDocument.Parse("""{"locked":false,"sentry_mode":false}""");
        using var nullLocked = JsonDocument.Parse("""{"locked":null,"sentry_mode":null}""");

        Assert.False(SecurityStatusReading.FromResponse(falseLocked.RootElement)!.Locked);
        Assert.False(SecurityStatusReading.FromResponse(falseLocked.RootElement)!.SentryMode);
        Assert.False(SecurityStatusReading.FromResponse(nullLocked.RootElement)!.Locked);
        Assert.False(SecurityStatusReading.FromResponse(nullLocked.RootElement)!.SentryMode);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SecurityStatusReading.FromResponse(doc.RootElement));
    }

    // ---- SecurityScalar narrowing (web typeof boolean / asNonEmptyString) -----------

    [Fact]
    public void Scalar_read_narrows_each_json_kind()
    {
        using var doc = JsonDocument.Parse("""{"b":true,"s":"open","empty":"","n":3,"z":null}""");
        var obj = doc.RootElement;

        Assert.Equal(SecurityScalarKind.Boolean, SecurityScalar.Read(obj, "b").Kind);
        Assert.Equal(SecurityScalarKind.Text, SecurityScalar.Read(obj, "s").Kind);
        Assert.Equal(SecurityScalarKind.None, SecurityScalar.Read(obj, "empty").Kind); // empty string → None (web asNonEmptyString)
        Assert.Equal(SecurityScalarKind.None, SecurityScalar.Read(obj, "n").Kind);     // number → None
        Assert.Equal(SecurityScalarKind.None, SecurityScalar.Read(obj, "z").Kind);     // null → None
        Assert.Equal(SecurityScalarKind.None, SecurityScalar.Read(obj, "missing").Kind); // absent → None
        Assert.True(SecurityScalar.Read(obj, "b").IsBooleanTrue);
    }

    // ---- Door open-count (web doorBoolOpen ? ['open'] : filter includes 'open') -----

    [Fact]
    public void OpenDoorCount_native_boolean_true_counts_one()
    {
        Assert.Equal(1, SecurityStatusProjection.OpenDoorCount(SecurityScalar.FromBoolean(true)));
    }

    [Theory]
    [InlineData("open", 1)]
    [InlineData("OPEN", 1)]                                    // web includes() runs on toLowerCase()
    [InlineData("all_closed", 0)]                             // no part contains "open"
    [InlineData("driver_front_open", 1)]
    [InlineData("driver_front_open, passenger_rear_open", 2)] // two open parts, trimmed
    [InlineData("driver_front_open,fp_closed", 1)]            // only the part containing "open" counts
    public void OpenDoorCount_string_counts_parts_containing_open(string raw, int expected) =>
        Assert.Equal(expected, SecurityStatusProjection.OpenDoorCount(SecurityScalar.FromText(raw)));

    [Fact]
    public void OpenDoorCount_native_boolean_false_and_blank_and_none_count_zero()
    {
        Assert.Equal(0, SecurityStatusProjection.OpenDoorCount(SecurityScalar.FromBoolean(false)));
        // A non-empty but all-whitespace string splits to zero surviving parts (web filter(Boolean)).
        Assert.Equal(0, SecurityStatusProjection.OpenDoorCount(SecurityScalar.FromText("   ")));
        Assert.Equal(0, SecurityStatusProjection.OpenDoorCount(SecurityScalar.None));
    }

    // ---- Window open predicate + count (web per-field filter) -----------------------

    [Fact]
    public void IsWindowOpen_native_boolean_returns_its_value()
    {
        Assert.True(SecurityStatusProjection.IsWindowOpen(SecurityScalar.FromBoolean(true)));
        Assert.False(SecurityStatusProjection.IsWindowOpen(SecurityScalar.FromBoolean(false)));
    }

    [Theory]
    [InlineData("open", true)]
    [InlineData("vent", true)]
    [InlineData("partial", true)]
    [InlineData("closed", false)]
    [InlineData("CLOSED", false)] // web compares toLowerCase() !== 'closed'
    public void IsWindowOpen_string_open_unless_closed(string raw, bool expected) =>
        Assert.Equal(expected, SecurityStatusProjection.IsWindowOpen(SecurityScalar.FromText(raw)));

    [Fact]
    public void IsWindowOpen_none_is_closed() =>
        Assert.False(SecurityStatusProjection.IsWindowOpen(SecurityScalar.None));

    [Fact]
    public void OpenWindowCount_counts_open_and_vented_but_not_closed()
    {
        var reading = OpenReading();
        // fd=open, fp=vent, rd=false(closed), rp="closed".
        Assert.Equal(2, SecurityStatusProjection.OpenWindowCount(reading));
    }

    // ---- Projection: the four cells (web StatusCell mapping) ------------------------

    [Fact]
    public void Project_secure_state_renders_four_success_cells()
    {
        var display = SecurityStatusProjection.Project(SecureReading(), Localizer);

        Assert.Equal(4, display.Cells.Count);

        var lockCell = display.Cells[0];
        Assert.Equal("lock", lockCell.Id);
        Assert.Equal("Lock", lockCell.Label);
        Assert.Equal(StatusKind.Success, lockCell.Status);
        Assert.Equal("Locked", lockCell.Value);
        Assert.Equal(SecurityStatusProjection.LockGlyph, lockCell.IconGlyph);

        var sentry = display.Cells[1];
        Assert.Equal("sentry", sentry.Id);
        Assert.Equal(StatusKind.Success, sentry.Status);
        Assert.Equal("Active", sentry.Value);
        Assert.Equal(SecurityStatusProjection.ShieldGlyph, sentry.IconGlyph);

        var doors = display.Cells[2];
        Assert.Equal("doors", doors.Id);
        Assert.Equal(StatusKind.Success, doors.Status);
        Assert.Equal("All Closed", doors.Value);
        Assert.Equal(SecurityStatusProjection.DoorGlyph, doors.IconGlyph);

        var windows = display.Cells[3];
        Assert.Equal("windows", windows.Id);
        Assert.Equal(StatusKind.Success, windows.Status);
        Assert.Equal("All Closed", windows.Value);
        Assert.Equal(SecurityStatusProjection.WindowGlyph, windows.IconGlyph);
    }

    [Fact]
    public void Project_open_state_warns_doors_and_windows_and_flags_unlocked_and_off()
    {
        var display = SecurityStatusProjection.Project(OpenReading(), Localizer);

        var lockCell = display.Cells[0];
        Assert.Equal(StatusKind.Danger, lockCell.Status);
        Assert.Equal("Unlocked", lockCell.Value);
        Assert.Equal(SecurityStatusProjection.UnlockGlyph, lockCell.IconGlyph);

        var sentry = display.Cells[1];
        Assert.Equal(StatusKind.Neutral, sentry.Status);
        Assert.Equal("Off", sentry.Value);

        var doors = display.Cells[2];
        Assert.Equal(StatusKind.Warning, doors.Status);
        Assert.Equal("2 Open", doors.Value);

        var windows = display.Cells[3];
        Assert.Equal(StatusKind.Warning, windows.Status);
        Assert.Equal("2 Open", windows.Value);
    }

    [Fact]
    public void Project_single_open_door_uses_singular_count_text()
    {
        var reading = SecureReading() with { DoorState = SecurityScalar.FromText("driver_front_open") };

        var display = SecurityStatusProjection.Project(reading, Localizer);

        Assert.Equal("1 Open", display.Cells[2].Value);
        Assert.Equal(StatusKind.Warning, display.Cells[2].Status);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_cell_automation_name_combines_label_and_value()
    {
        var display = SecurityStatusProjection.Project(SecureReading(), Localizer);

        Assert.Equal("Lock Locked", display.Cells[0].AutomationName);
        Assert.Equal("Sentry Active", display.Cells[1].AutomationName);
    }

    [Fact]
    public void Project_surface_automation_name_summarises_all_cells()
    {
        var display = SecurityStatusProjection.Project(SecureReading(), Localizer);

        Assert.Equal("Lock Locked, Sentry Active, Doors All Closed, Windows All Closed", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(OpenJson);

        var cached = SecurityStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.False(cached.Value!.Locked);

        var offline = SecurityStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("driver_front_open, passenger_rear_open", offline.Value!.DoorState.TextValue);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(SecureJson);

        Assert.Equal(LoadStatus.Loaded, SecurityStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SecurityStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SecurityStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no security object (securityData == null) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = SecurityStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_cells_display()
    {
        using var vm = NewViewModel(Loaded(SecureReading()));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.Equal(4, vm.Display!.Cells.Count);
        Assert.Equal("Locked", vm.Display.Cells[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No security data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityStatusReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityStatusReading>.Cached(SecureReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusReading>.OfflineCached(
            SecureReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityStatusReading>.Loading(),
            RepositoryResult<SecurityStatusReading>.Cached(OpenReading(), Now, stale: false),
            RepositoryResult<SecurityStatusReading>.Loaded(SecureReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusState.Loaded, vm.State);
        Assert.Equal("Locked", vm.Display!.Cells[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Security", vm.Title);
        Assert.Equal("No security data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(SecureReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SecurityStatusViewModel.State), changed);
        Assert.Contains(nameof(SecurityStatusViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("security-status", SecurityStatusRegistration.Id);
        Assert.Equal("security", SecurityStatusRegistration.Category);
        Assert.Equal("SecurityStatusWidget", SecurityStatusRegistration.Slug);
        Assert.Equal(new SecurityStatusSize(1, 2), SecurityStatusRegistration.DefaultSize);
        Assert.Equal(new SecurityStatusSize(1, 2), SecurityStatusRegistration.MinSize);
        Assert.Equal(new SecurityStatusSize(2, 40), SecurityStatusRegistration.MaxSize);
        Assert.Equal("Security", SecurityStatusRegistration.Name(Localizer));
        Assert.Equal("Lock, sentry, doors, windows status", SecurityStatusRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(2, 40, true)]   // max
    [InlineData(1, 10, true)]   // inside
    [InlineData(3, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SecurityStatusRegistration.IsWithinBounds(new SecurityStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SecurityStatusSize(1, 2), SecurityStatusRegistration.Clamp(new SecurityStatusSize(0, 0)));
        Assert.Equal(new SecurityStatusSize(2, 40), SecurityStatusRegistration.Clamp(new SecurityStatusSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SecurityStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SecurityStatusWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SecurityStatusSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_security()
    {
        using var security = JsonDocument.Parse(SecureJson);
        var api = new FakeApiClient().ReturnsValue(security.RootElement);
        var source = new SecurityStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.Locked);
        Assert.True(terminal.Value.SentryMode);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var security = JsonDocument.Parse(OpenJson);
        var api = new FakeApiClient().ReturnsValue(security.RootElement);
        var source = new SecurityStatusSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.False(results[^1].Value!.Locked);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new SecurityStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static SecurityStatusReading SecureReading() => new(
        Locked: true,
        SentryMode: true,
        DoorState: SecurityScalar.FromText("all_closed"),
        FdWindow: SecurityScalar.FromText("closed"),
        FpWindow: SecurityScalar.FromText("closed"),
        RdWindow: SecurityScalar.FromText("closed"),
        RpWindow: SecurityScalar.FromText("closed"));

    private static SecurityStatusReading OpenReading() => new(
        Locked: false,
        SentryMode: false,
        DoorState: SecurityScalar.FromText("driver_front_open, passenger_rear_open"),
        FdWindow: SecurityScalar.FromText("open"),
        FpWindow: SecurityScalar.FromText("vent"),
        RdWindow: SecurityScalar.FromBoolean(false),
        RpWindow: SecurityScalar.FromText("closed"));

    private static async Task<List<RepositoryResult<SecurityStatusReading>>> Drain(ISecurityStatusSource source)
    {
        var list = new List<RepositoryResult<SecurityStatusReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<SecurityStatusReading> Loaded(SecurityStatusReading reading) =>
        RepositoryResult<SecurityStatusReading>.Loaded(reading, Now);

    private static SecurityStatusViewModel NewViewModel(params RepositoryResult<SecurityStatusReading>[] emissions) =>
        new(new FakeSecurityStatusSource(emissions), Localizer, SecurityStatusSize.Default);

    private sealed class FakeSecurityStatusSource(params RepositoryResult<SecurityStatusReading>[] emissions) : ISecurityStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<SecurityStatusReading>> StreamAsync(
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
