using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Watch;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>WatchFacePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/watch/pages/WatchFacePage.tsx), the state matrix (loading / empty / error / success), the
/// SI-display-boundary unit formatting, the battery-colour threshold (web <c>getBatteryColor</c>), the state-badge
/// variant (web <c>watchStateVariant</c>), the relative-time caption (web <c>formatRelativeTime</c>), the tap-icon
/// gating, and the view-model's load + command flow over its two data ports (<c>useWatchSummary</c> +
/// <c>useWatchCommand</c>). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="WatchFaceDisplay"/> flags asserted here.
/// </summary>
public sealed class WatchFacePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Every visible literal the projection references (web has no i18n keys here; all are introduced).</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "watch.title", "watch.noVehicle", "watch.error", "watch.retry",
        "watch.action.lock", "watch.action.unlock", "watch.action.climateOn", "watch.action.climateOff",
        "watch.sentry.on", "watch.sentry.off", "watch.battery", "watch.charging.toFull",
        "watch.time.justNow", "watch.time.minutesAgo", "watch.time.hoursAgo", "watch.time.daysAgo",
    ];

    private static WatchFaceModel Model(
        WatchFaceSummary? summary = null,
        bool loading = false,
        bool loadFailed = false,
        UnitPref? units = null,
        string? activeCommand = null,
        bool commandPending = false) =>
        new(
            Summary: summary,
            Loading: loading,
            LoadFailed: loadFailed,
            Units: units ?? UnitPref.Metric,
            ActiveCommand: activeCommand,
            CommandPending: commandPending);

    private static WatchFaceSummary Summary(
        string? name = "My Tesla",
        string? state = "online",
        double? battery = 73,
        double? rangeKm = 400,
        bool charging = false,
        double? timeToFull = 25,
        bool locked = true,
        bool sentry = false,
        double? insideTempC = 21.5,
        bool climate = false,
        DateTimeOffset? lastUpdated = null) =>
        new(name, state, battery, rangeKm, charging, timeToFull, locked, sentry, insideTempC, climate, lastUpdated);

    // ---- string-key coverage -------------------------------------------------------

    [Fact]
    public void Manifest_requires_sixteen_string_keys()
    {
        Assert.Equal(16, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // A charging summary with a timestamp exercises every conditional key (charging line + relative time).
        _ = WatchFaceProjection.Project(
            Model(summary: Summary(charging: true, lastUpdated: Now.AddMinutes(-5))),
            recorder,
            Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- state matrix --------------------------------------------------------------

    [Fact]
    public void Loading_model_projects_loading_state()
    {
        var display = WatchFaceProjection.Project(Model(loading: true), Localizer, Now);
        Assert.Equal(WatchFaceState.Loading, display.State);
    }

    [Fact]
    public void Failed_model_projects_error_state()
    {
        var display = WatchFaceProjection.Project(Model(loadFailed: true), Localizer, Now);
        Assert.Equal(WatchFaceState.Error, display.State);
        Assert.Equal("Couldn't load watch data", display.Message);
    }

    [Fact]
    public void No_data_projects_empty_state()
    {
        var display = WatchFaceProjection.Project(Model(summary: null), Localizer, Now);
        Assert.Equal(WatchFaceState.Empty, display.State);
        Assert.Equal("No vehicle found", display.Message);
    }

    [Fact]
    public void Resolved_summary_projects_success_state()
    {
        var display = WatchFaceProjection.Project(Model(summary: Summary()), Localizer, Now);
        Assert.Equal(WatchFaceState.Success, display.State);
        Assert.Equal("My Tesla", display.VehicleName);
    }

    // ---- battery gauge -------------------------------------------------------------

    [Theory]
    [InlineData(80, StatusKind.Success)]
    [InlineData(41, StatusKind.Success)]
    [InlineData(40, StatusKind.Warning)]
    [InlineData(30, StatusKind.Warning)]
    [InlineData(20, StatusKind.Danger)]
    [InlineData(10, StatusKind.Danger)]
    public void Battery_threshold_maps_to_status(double level, StatusKind expected)
    {
        Assert.Equal(expected, WatchFaceProjection.BatteryStatusFor(level));
        var display = WatchFaceProjection.Project(Model(summary: Summary(battery: level)), Localizer, Now);
        Assert.Equal(expected, display.BatteryStatus);
        Assert.True(display.HasBatteryReading);
        Assert.Equal(((int)Math.Round(level)).ToString(System.Globalization.CultureInfo.CurrentCulture), display.BatteryValueText);
    }

    [Fact]
    public void Missing_battery_reading_is_neutral()
    {
        var display = WatchFaceProjection.Project(Model(summary: Summary(battery: null)), Localizer, Now);
        Assert.False(display.HasBatteryReading);
        Assert.Equal(StatusKind.Neutral, display.BatteryStatus);
        Assert.Equal(0, display.BatteryValue);
    }

    // ---- state badge ---------------------------------------------------------------

    [Theory]
    [InlineData("driving", StatusKind.Info)]
    [InlineData("charging", StatusKind.Success)]
    [InlineData("asleep", StatusKind.Neutral)]
    [InlineData("online", StatusKind.Neutral)]
    public void State_badge_variant_matches_web(string state, StatusKind expected)
    {
        Assert.Equal(expected, WatchFaceProjection.StateStatusFor(state));
        var display = WatchFaceProjection.Project(Model(summary: Summary(state: state)), Localizer, Now);
        Assert.Equal(expected, display.StateStatus);
        Assert.Equal(state, display.StateText);
    }

    // ---- charging line -------------------------------------------------------------

    [Fact]
    public void Charging_line_shows_minutes_to_full_only_when_charging()
    {
        var charging = WatchFaceProjection.Project(Model(summary: Summary(charging: true, timeToFull: 24.6)), Localizer, Now);
        Assert.True(charging.IsCharging);
        Assert.Equal("25m to full", charging.ChargingText);

        var idle = WatchFaceProjection.Project(Model(summary: Summary(charging: false)), Localizer, Now);
        Assert.False(idle.IsCharging);
        Assert.Equal(string.Empty, idle.ChargingText);
    }

    // ---- SI display boundary -------------------------------------------------------

    [Fact]
    public void Range_converts_from_km_wire_field_at_display_boundary()
    {
        var metric = WatchFaceProjection.Project(Model(summary: Summary(rangeKm: 400), units: UnitPref.Metric), Localizer, Now);
        var imperial = WatchFaceProjection.Project(Model(summary: Summary(rangeKm: 400), units: UnitPref.Imperial), Localizer, Now);

        Assert.Equal("400 km", metric.RangeText);
        Assert.NotEqual(metric.RangeText, imperial.RangeText);
        Assert.Contains("mi", imperial.RangeText, StringComparison.Ordinal);
    }

    [Fact]
    public void Missing_range_shows_em_dash()
    {
        var display = WatchFaceProjection.Project(Model(summary: Summary(rangeKm: null)), Localizer, Now);
        Assert.Equal("\u2014", display.RangeText);
    }

    [Fact]
    public void Interior_temperature_caption_converts_at_display_boundary()
    {
        var metric = WatchFaceProjection.Project(Model(summary: Summary(insideTempC: 21.5), units: UnitPref.Metric), Localizer, Now);
        var imperial = WatchFaceProjection.Project(Model(summary: Summary(insideTempC: 21.5), units: UnitPref.Imperial), Localizer, Now);

        // The climate tap icon carries the rounded temperature caption with a degree sign (web `${round}°`).
        Assert.Equal("22\u00B0", metric.QuickActions[1].Caption);
        Assert.Equal("71\u00B0", imperial.QuickActions[1].Caption);
    }

    // ---- tap icons (web StatusIcon) ------------------------------------------------

    [Fact]
    public void Lock_icon_is_dynamic_and_tinted_by_lock_state()
    {
        var locked = WatchFaceProjection.Project(Model(summary: Summary(locked: true)), Localizer, Now);
        Assert.Equal("unlock", locked.QuickActions[0].Command);
        Assert.Equal("Unlock", locked.QuickActions[0].Label);
        Assert.Equal(StatusKind.Success, locked.QuickActions[0].Accent);
        Assert.True(locked.QuickActions[0].Active);

        var unlocked = WatchFaceProjection.Project(Model(summary: Summary(locked: false)), Localizer, Now);
        Assert.Equal("lock", unlocked.QuickActions[0].Command);
        Assert.Equal("Lock", unlocked.QuickActions[0].Label);
        Assert.Equal(StatusKind.Danger, unlocked.QuickActions[0].Accent);
        Assert.False(unlocked.QuickActions[0].Active);
    }

    [Fact]
    public void Climate_icon_toggles_command_and_label()
    {
        var off = WatchFaceProjection.Project(Model(summary: Summary(climate: false)), Localizer, Now);
        Assert.Equal("climate_on", off.QuickActions[1].Command);
        Assert.Equal("Climate On", off.QuickActions[1].Label);
        Assert.False(off.QuickActions[1].Active);

        var on = WatchFaceProjection.Project(Model(summary: Summary(climate: true)), Localizer, Now);
        Assert.Equal("climate_off", on.QuickActions[1].Command);
        Assert.Equal("Climate Off", on.QuickActions[1].Label);
        Assert.True(on.QuickActions[1].Active);
    }

    [Fact]
    public void Sentry_icon_is_a_non_interactive_indicator()
    {
        var on = WatchFaceProjection.Project(Model(summary: Summary(sentry: true)), Localizer, Now);
        Assert.Null(on.QuickActions[2].Command);
        Assert.False(on.QuickActions[2].Interactive);
        Assert.True(on.QuickActions[2].Active);
        Assert.Equal(StatusKind.Warning, on.QuickActions[2].Accent);
        Assert.Equal("Sentry on", on.QuickActions[2].Label);

        var off = WatchFaceProjection.Project(Model(summary: Summary(sentry: false)), Localizer, Now);
        Assert.False(off.QuickActions[2].Active);
        Assert.Equal("Sentry off", off.QuickActions[2].Label);
    }

    [Fact]
    public void Pending_command_dims_tap_icons_and_spins_active_only()
    {
        var pending = WatchFaceProjection.Project(
            Model(summary: Summary(locked: true), activeCommand: "unlock", commandPending: true),
            Localizer,
            Now);

        Assert.True(pending.QuickActions[0].IsLoading);   // lock/unlock is the active command
        Assert.False(pending.QuickActions[1].IsLoading);  // climate is not
        Assert.True(pending.QuickActions[0].Disabled);
        Assert.True(pending.QuickActions[1].Disabled);
        // The sentry indicator is never an interactive, dimmable tap target.
        Assert.False(pending.QuickActions[2].Disabled);
        Assert.False(pending.QuickActions[2].Interactive);
    }

    // ---- relative time (web formatRelativeTime) ------------------------------------

    [Fact]
    public void Relative_time_matches_web_buckets()
    {
        Assert.Equal("just now", WatchFaceProjection.FormatRelativeTime(Now, Now, Localizer));
        Assert.Equal("just now", WatchFaceProjection.FormatRelativeTime(Now.AddSeconds(-30), Now, Localizer));
        Assert.Equal("5m ago", WatchFaceProjection.FormatRelativeTime(Now.AddMinutes(-5), Now, Localizer));
        Assert.Equal("2h ago", WatchFaceProjection.FormatRelativeTime(Now.AddHours(-2), Now, Localizer));
        Assert.Equal("3d ago", WatchFaceProjection.FormatRelativeTime(Now.AddDays(-3), Now, Localizer));
        Assert.Equal(string.Empty, WatchFaceProjection.FormatRelativeTime(null, Now, Localizer));
    }

    // ---- JSON parsing --------------------------------------------------------------

    [Fact]
    public void Summary_parses_full_watch_body()
    {
        const string json = "{\"vehicle_name\":\"My Tesla\",\"state\":\"charging\",\"battery_level\":73," +
            "\"range_km\":400,\"is_charging\":true,\"time_to_full\":25,\"is_locked\":true,\"sentry_mode\":false," +
            "\"inside_temp_c\":21.5,\"is_climate_on\":true,\"last_updated\":\"2026-06-15T11:55:00Z\"}";
        using var doc = JsonDocument.Parse(json);
        var summary = WatchFaceSummary.FromResponse(doc.RootElement);

        Assert.NotNull(summary);
        Assert.Equal("My Tesla", summary!.VehicleName);
        Assert.Equal("charging", summary.State);
        Assert.Equal(73, summary.BatteryLevel);
        Assert.Equal(400, summary.RangeKm);
        Assert.True(summary.IsCharging);
        Assert.Equal(25, summary.TimeToFull);
        Assert.True(summary.IsLocked);
        Assert.False(summary.SentryMode);
        Assert.Equal(21.5, summary.InsideTempC);
        Assert.True(summary.IsClimateOn);
        Assert.NotNull(summary.LastUpdated);
    }

    [Fact]
    public void Summary_returns_null_for_non_object_or_empty()
    {
        using var notObject = JsonDocument.Parse("\"nope\"");
        Assert.Null(WatchFaceSummary.FromResponse(notObject.RootElement));

        using var empty = JsonDocument.Parse("{}");
        Assert.Null(WatchFaceSummary.FromResponse(empty.RootElement));
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_load_populates_success()
    {
        var vm = NewViewModel(summary: RepositoryResult<WatchFaceSummary>.Loaded(Summary(), DateTimeOffset.UtcNow));
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();

        Assert.Equal(WatchFaceState.Success, vm.Vm.State);
        Assert.Equal("My Tesla", vm.Vm.Display.VehicleName);
        Assert.NotNull(vm.Vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_load_failure_sets_error_state()
    {
        var vm = NewViewModel(summary: RepositoryResult<WatchFaceSummary>.Failure(new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();

        Assert.Equal(WatchFaceState.Error, vm.Vm.State);
        Assert.True(vm.Vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.Vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_empty_body_sets_empty_state()
    {
        var vm = NewViewModel(summary: RepositoryResult<WatchFaceSummary>.Empty());
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();

        Assert.Equal(WatchFaceState.Empty, vm.Vm.State);
    }

    [Fact]
    public async Task ViewModel_command_sends_then_reloads_summary()
    {
        var vm = NewViewModel(
            summary: RepositoryResult<WatchFaceSummary>.Loaded(Summary(), DateTimeOffset.UtcNow),
            vehicleId: 7);
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();
        var outcome = await vm.Vm.SendCommandAsync("lock");

        Assert.True(outcome.Success);
        Assert.Equal(1, vm.Command.Calls);
        Assert.Equal("lock", vm.Command.LastCommand);
        Assert.Equal(7, vm.Command.LastVehicleId);
        // The command re-reads the summary (web invalidates the query): two summary streams total.
        Assert.Equal(2, vm.Summary.Streams);
        Assert.False(vm.Vm.IsCommandPending);
    }

    [Fact]
    public async Task ViewModel_command_forwards_zero_vehicle_when_no_deep_link()
    {
        var vm = NewViewModel(summary: RepositoryResult<WatchFaceSummary>.Loaded(Summary(), DateTimeOffset.UtcNow));
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();
        await vm.Vm.SendCommandAsync("climate_on");

        Assert.Equal(0, vm.Command.LastVehicleId);
        Assert.Equal("climate_on", vm.Command.LastCommand);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_and_slug()
    {
        Assert.Equal("WatchFace", WatchFaceRegistration.RouteName);
        Assert.Equal("WatchFacePage", WatchFaceRegistration.Slug);
        Assert.Equal("Watch Face", WatchFaceRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new WatchFaceDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WatchFacePage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

    private static Harness NewViewModel(
        RepositoryResult<WatchFaceSummary> summary,
        long? vehicleId = null)
    {
        var summarySource = new StubSummarySource(summary);
        var command = new StubCommandSender();
        var vm = new WatchFacePageViewModel(summarySource, command, Localizer, units: null, vehicleId: vehicleId);
        return new Harness(vm, summarySource, command);
    }

    private sealed record Harness(WatchFacePageViewModel Vm, StubSummarySource Summary, StubCommandSender Command);

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class StubSummarySource(RepositoryResult<WatchFaceSummary> result) : IWatchFaceSummarySource
    {
        public int Streams { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<WatchFaceSummary>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Streams++;
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class StubCommandSender : IWatchFaceCommandSender
    {
        public int Calls { get; private set; }

        public long LastVehicleId { get; private set; } = -1;

        public string? LastCommand { get; private set; }

        public Task<WatchFaceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastVehicleId = vehicleId;
            LastCommand = command;
            return Task.FromResult(WatchFaceCommandOutcome.Ok);
        }
    }
}
