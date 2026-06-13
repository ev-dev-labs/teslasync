using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>GasPriceAutoPollPage</c> surface's Microsoft.UI-free logic — the projection
/// (the web wrapper web/src/features/admin/pages/GasPriceAutoPollPage.tsx + the embedded
/// web/src/features/settings/components/GasPriceSettings.tsx), the currency / datetime display boundary, the
/// never-polled sentinel, and the view-model's four-state matrix (loading / empty / error / success) plus the
/// optimistic toggle / interval / poll mutations. The WinUI view is exercised by the app build; its per-region
/// visibility is driven entirely by the <see cref="GasPriceDisplay"/> flags asserted here.
/// </summary>
public sealed class GasPriceAutoPollPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Every i18n key the surface resolves: the 2 manifest parity strings (gas.title / gas.subtitle) plus the
    // 17 embedded GasPriceSettings strings and the 2 shared chrome keys (common.retry / error.loadFailed).
    private static readonly string[] RequiredStringKeys =
    [
        "gas.title", "gas.subtitle", "gas.autoPoll", "gas.enabled", "gas.disabled", "gas.running", "gas.stopped",
        "gas.pollInterval", "gas.intervalUpdated", "gas.daily", "gas.weekly", "gas.biweekly", "gas.monthly",
        "gas.currentPrice", "gas.lastPolled", "gas.never", "gas.pollTriggered", "gas.pollNow", "gas.source",
        "common.retry", "error.loadFailed",
    ];

    private static GasPriceStatus PricedStatus() => new(
        Enabled: true,
        PollInterval: "30d",
        LastPollTime: "2026-06-05T08:00:00Z",
        CurrentPrice: 3.59,
        CurrentPriceKwhEq: 0.11);

    // ---- i18n key coverage (the 2 parity strings + the embedded component + chrome keys) ----

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // The disabled-default model covers gas.stopped / gas.never; the enabled + error models cover gas.running
        // and error.loadFailed; the notice helpers cover the four web success-toast strings.
        _ = GasPriceProjection.Project(GasPriceModel.Initial with { Loading = false }, recorder, Now);
        _ = GasPriceProjection.Project(GasPriceModel.Initial with { Loading = false, Status = PricedStatus() }, recorder, Now);
        _ = GasPriceProjection.Project(GasPriceModel.Initial with { Loading = false, HasError = true, ErrorDetail = "x" }, recorder, Now);
        _ = GasPriceProjection.ToggleNotice(recorder, true);
        _ = GasPriceProjection.ToggleNotice(recorder, false);
        _ = GasPriceProjection.IntervalNotice(recorder);
        _ = GasPriceProjection.PollNotice(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_the_two_parity_strings_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = GasPriceProjection.Project(GasPriceModel.Initial, recorder, Now);

        // The page header (the PageContainer wrapper) resolves title + subtitle on every projection.
        Assert.Contains("gas.title", recorder.Keys);
        Assert.Contains("gas.subtitle", recorder.Keys);
    }

    [Fact]
    public void Registration_exposes_the_route_and_parity_strings()
    {
        Assert.Equal("GasPriceAutoPoll", GasPriceAutoPollRegistration.RouteName);
        Assert.Equal("GasPriceAutoPollPage", GasPriceAutoPollRegistration.Slug);
        Assert.Equal("Gas Price Auto-Poll", GasPriceAutoPollRegistration.Title(Localizer));
        Assert.Equal("Automatically fetch US average gas prices from EIA", GasPriceAutoPollRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Interval_options_mirror_the_web_select()
    {
        var options = GasPriceAutoPollRegistration.IntervalOptions(Localizer);

        Assert.Equal(["daily", "7d", "15d", "30d"], options.Select(o => o.Value));
        Assert.Equal(["Daily", "Weekly", "Bi-weekly", "Monthly"], options.Select(o => o.Label));
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_status_query_in_flight()
    {
        var display = GasPriceProjection.Project(GasPriceModel.Initial, Localizer, Now);

        Assert.Equal(GasPriceState.Loading, display.State);
        Assert.True(display.ShowLoading);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_data()
    {
        var model = GasPriceModel.Initial with { Loading = false, Status = GasPriceStatus.Default };
        var display = GasPriceProjection.Project(model, Localizer, Now);

        Assert.Equal(GasPriceState.Empty, display.State);
        Assert.False(display.ShowLoading);
        Assert.False(display.IsEnabled);
        Assert.Equal("Stopped", display.ToggleStateLabel);
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, display.CurrentPriceValue);
        Assert.Equal("Never", display.LastPolledValue);
        Assert.Equal("7d", display.SelectedInterval);
    }

    [Fact]
    public void State_error_shows_banner_with_detail()
    {
        var model = GasPriceModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = GasPriceProjection.Project(model, Localizer, Now);

        Assert.Equal(GasPriceState.Error, display.State);
        Assert.True(display.HasError);
        Assert.Equal("Failed to load data: network down", display.ErrorBannerText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_status_has_data()
    {
        var display = GasPriceProjection.Project(
            GasPriceModel.Initial with { Loading = false, Status = PricedStatus() }, Localizer, Now);

        Assert.Equal(GasPriceState.Success, display.State);
        Assert.True(display.IsEnabled);
        Assert.Equal("Running", display.ToggleStateLabel);
        Assert.Equal("$3.59/gal", display.CurrentPriceValue);
        Assert.NotEqual("Never", display.LastPolledValue);
        Assert.Contains("2026", display.LastPolledValue);
        Assert.Equal("30d", display.SelectedInterval);
    }

    [Fact]
    public void Never_polled_sentinel_renders_never()
    {
        var model = GasPriceModel.Initial with
        {
            Loading = false,
            Status = GasPriceStatus.Default with { LastPollTime = "0001-01-01T00:00:00Z" },
        };
        var display = GasPriceProjection.Project(model, Localizer, Now);

        Assert.Equal("Never", display.LastPolledValue);
    }

    // ---- View-model lifecycle ------------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_status_into_the_success_state()
    {
        var feed = new FakeGasPriceFeed(PricedStatus());
        using var vm = new GasPriceAutoPollPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(GasPriceState.Success, vm.State);
        Assert.True(vm.Display.IsEnabled);
        Assert.Equal("$3.59/gal", vm.Display.CurrentPriceValue);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new GasPriceAutoPollPageViewModel(EmptyGasPriceFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(GasPriceState.Empty, vm.State);
        Assert.Equal("Stopped", vm.Display.ToggleStateLabel);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new GasPriceAutoPollPageViewModel(new ThrowingGasPriceFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(GasPriceState.Error, vm.State);
        Assert.True(vm.Display.HasError);
        Assert.Contains("Failed to load data", vm.Display.ErrorBannerText);
    }

    [Fact]
    public async Task ViewModel_toggle_persists_and_notices()
    {
        var feed = new FakeGasPriceFeed(GasPriceStatus.Default);
        using var vm = new GasPriceAutoPollPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ToggleAsync();

        Assert.True(vm.Display.IsEnabled);
        Assert.Equal("Running", vm.Display.ToggleStateLabel);
        Assert.True(vm.Display.HasNotice);
        Assert.Equal("Auto-poll enabled", vm.Display.NoticeText);
        Assert.True(feed.LastPersisted!.Enabled);
    }

    [Fact]
    public async Task ViewModel_toggle_is_optimistic_without_a_backend()
    {
        using var vm = new GasPriceAutoPollPageViewModel(EmptyGasPriceFeed.Instance, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ToggleAsync();

        // The empty feed never persists (returns null); the optimistic edit keeps the panel interactive.
        Assert.True(vm.Display.IsEnabled);
        Assert.Equal("Auto-poll enabled", vm.Display.NoticeText);
    }

    [Fact]
    public async Task ViewModel_set_interval_persists_and_notices()
    {
        var feed = new FakeGasPriceFeed(GasPriceStatus.Default);
        using var vm = new GasPriceAutoPollPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SetIntervalAsync("30d");

        Assert.Equal("30d", vm.Display.SelectedInterval);
        Assert.Equal("Poll interval updated", vm.Display.NoticeText);
        Assert.Equal("30d", feed.LastPersisted!.PollInterval);
    }

    [Fact]
    public async Task ViewModel_poll_now_refreshes_and_notices()
    {
        var feed = new FakeGasPriceFeed(GasPriceStatus.Default);
        using var vm = new GasPriceAutoPollPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.PollNowAsync();

        Assert.Equal("Gas price poll triggered", vm.Display.NoticeText);
        Assert.False(vm.Display.IsPolling);
        Assert.Equal(GasPriceState.Success, vm.State);
        Assert.Equal("$3.59/gal", vm.Display.CurrentPriceValue);
    }

    [Fact]
    public async Task ViewModel_mutation_failure_reverts_and_surfaces_error()
    {
        var feed = new MutationFailingFeed(GasPriceStatus.Default);
        using var vm = new GasPriceAutoPollPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ToggleAsync();

        Assert.True(vm.Display.HasError);
        Assert.False(vm.Display.IsEnabled); // optimistic edit reverted
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new GasPriceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GasPriceAutoPollPage", Assert.Single(lines));
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeGasPriceFeed : IGasPriceFeed
    {
        private GasPriceStatus _status;

        public FakeGasPriceFeed(GasPriceStatus status) => _status = status;

        public GasPriceStatus? LastPersisted { get; private set; }

        public Task<GasPriceStatus?> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult<GasPriceStatus?>(_status);

        public Task<GasPriceStatus?> SetEnabledAsync(bool enabled, CancellationToken cancellationToken)
        {
            _status = _status with { Enabled = enabled };
            LastPersisted = _status;
            return Task.FromResult<GasPriceStatus?>(_status);
        }

        public Task<GasPriceStatus?> SetIntervalAsync(string interval, CancellationToken cancellationToken)
        {
            _status = _status with { PollInterval = interval };
            LastPersisted = _status;
            return Task.FromResult<GasPriceStatus?>(_status);
        }

        public Task<GasPriceStatus?> PollNowAsync(CancellationToken cancellationToken)
        {
            _status = _status with { CurrentPrice = 3.59, LastPollTime = "2026-06-06T10:00:00Z", Enabled = true };
            LastPersisted = _status;
            return Task.FromResult<GasPriceStatus?>(_status);
        }
    }

    private sealed class ThrowingGasPriceFeed : IGasPriceFeed
    {
        public Task<GasPriceStatus?> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<GasPriceStatus?> SetEnabledAsync(bool enabled, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<GasPriceStatus?> SetIntervalAsync(string interval, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<GasPriceStatus?> PollNowAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class MutationFailingFeed : IGasPriceFeed
    {
        private readonly GasPriceStatus _status;

        public MutationFailingFeed(GasPriceStatus status) => _status = status;

        public Task<GasPriceStatus?> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult<GasPriceStatus?>(_status);

        public Task<GasPriceStatus?> SetEnabledAsync(bool enabled, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("toggle failed");

        public Task<GasPriceStatus?> SetIntervalAsync(string interval, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("interval failed");

        public Task<GasPriceStatus?> PollNowAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("poll failed");
    }
}
