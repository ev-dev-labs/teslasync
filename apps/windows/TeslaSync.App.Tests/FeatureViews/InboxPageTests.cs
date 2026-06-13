using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>InboxPage</c> host's Microsoft.UI-free logic — the three ported header
/// strings (key names + English defaults matching web/src/features/notifications/pages/InboxPage.tsx), the two
/// auxiliary reads (<c>useVehicles</c> + <c>useAlertRules</c>) folded into the per-read status + the combined
/// <see cref="InboxPageState"/> (loading / loaded / empty / error), the snake_case + camelCase JSON adapters,
/// the registration metadata and the PII-safe diagnostics. The WinUI view itself (InboxPage.cs) hosts the
/// shared PageContainer + InboxBody and is exercised by the app build.
/// </summary>
public sealed class InboxPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static InboxPageViewModel ViewModel(IInboxPageSource source, InboxPageDiagnostics? diagnostics = null) =>
        new(source, Localizer, diagnostics);

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    // ── Strings: the three ported parity literals ───────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_ported_string_keys()
    {
        Assert.Equal("notifications.inbox.title", InboxPageRegistration.TitleKey);
        Assert.Equal("notifications.inbox.subtitle", InboxPageRegistration.SubtitleKey);
        Assert.Equal("notifications.inbox.viewArchived", InboxPageRegistration.ViewArchivedKey);
    }

    [Fact]
    public void Registration_resolves_english_defaults()
    {
        Assert.Equal("Inbox", InboxPageRegistration.Title(Localizer));
        Assert.Equal("Recent notifications from your alert rules.", InboxPageRegistration.Subtitle(Localizer));
        Assert.Equal("View archived", InboxPageRegistration.ViewArchivedLabel(Localizer));
    }

    [Fact]
    public void ViewModel_surfaces_the_three_header_strings()
    {
        var vm = ViewModel(EmptyInboxPageSource.Instance);

        Assert.Equal("Inbox", vm.Title);
        Assert.Equal("Recent notifications from your alert rules.", vm.Subtitle);
        Assert.Equal("View archived", vm.ViewArchivedLabel);
        Assert.Equal(vm.Title, vm.AutomationName);
    }

    // ── State: success / empty / error / loading ───────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_is_loading_before_any_read()
    {
        var vm = ViewModel(EmptyInboxPageSource.Instance);

        Assert.Equal(InboxPageState.Loading, vm.State);
        Assert.Equal(LoadStatus.Loading, vm.VehiclesStatus);
        Assert.Equal(LoadStatus.Loading, vm.AlertRulesStatus);
    }

    [Fact]
    public async Task Load_reaches_loaded_when_both_reads_return_data()
    {
        var source = new StaticInboxPageSource(
            vehicles: [new InboxPageVehicle(1, "Model 3"), new InboxPageVehicle(2, "Model Y")],
            rules: [new InboxPageAlertRule(10, "Low battery")]);
        var vm = ViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(InboxPageState.Loaded, vm.State);
        Assert.Equal(LoadStatus.Loaded, vm.VehiclesStatus);
        Assert.Equal(LoadStatus.Loaded, vm.AlertRulesStatus);
        Assert.Equal(2, vm.Vehicles.Count);
        Assert.Single(vm.AlertRules);
        Assert.Equal(1, vm.Attempts);
    }

    [Fact]
    public async Task Load_reaches_empty_when_both_reads_are_empty()
    {
        var vm = ViewModel(EmptyInboxPageSource.Instance);

        await vm.LoadAsync();

        Assert.Equal(InboxPageState.Empty, vm.State);
        Assert.Equal(LoadStatus.Empty, vm.VehiclesStatus);
        Assert.Equal(LoadStatus.Empty, vm.AlertRulesStatus);
        Assert.Empty(vm.Vehicles);
        Assert.Empty(vm.AlertRules);
    }

    [Fact]
    public async Task Load_reaches_loaded_when_only_one_read_returns_data()
    {
        var source = new StaticInboxPageSource(
            vehicles: [new InboxPageVehicle(1, "Model 3")],
            rules: null);
        var vm = ViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(InboxPageState.Loaded, vm.State);
        Assert.Equal(LoadStatus.Loaded, vm.VehiclesStatus);
        Assert.Equal(LoadStatus.Empty, vm.AlertRulesStatus);
    }

    [Fact]
    public async Task Load_reaches_error_when_both_reads_fail()
    {
        var failure = new RepositoryError(RepositoryErrorKind.Network, "offline");
        var source = StaticInboxPageSource.Emitting(
            [RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Failure(failure)],
            [RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Failure(failure)]);
        var vm = ViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(InboxPageState.Error, vm.State);
        Assert.Equal(LoadStatus.Error, vm.VehiclesStatus);
        Assert.Equal(LoadStatus.Error, vm.AlertRulesStatus);
    }

    [Fact]
    public async Task Load_keeps_loading_while_a_read_is_pending()
    {
        var source = StaticInboxPageSource.Emitting(
            [RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Loading()],
            [RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Loading()]);
        var vm = ViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(InboxPageState.Loading, vm.State);
    }

    [Fact]
    public async Task Cached_then_loaded_sequence_keeps_data_and_ends_loaded()
    {
        DateTimeOffset stamp = DateTimeOffset.UtcNow;
        IReadOnlyList<InboxPageVehicle> fleet = [new InboxPageVehicle(1, "Model 3")];
        IReadOnlyList<InboxPageAlertRule> rules = [new InboxPageAlertRule(7, "Tire pressure")];
        var source = StaticInboxPageSource.Emitting(
            [
                RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Loading(),
                RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Cached(fleet, stamp, stale: false),
                RepositoryResult<IReadOnlyList<InboxPageVehicle>>.Loaded(fleet, stamp),
            ],
            [
                RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Loading(),
                RepositoryResult<IReadOnlyList<InboxPageAlertRule>>.Loaded(rules, stamp),
            ]);
        var vm = ViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(InboxPageState.Loaded, vm.State);
        Assert.Single(vm.Vehicles);
        Assert.Single(vm.AlertRules);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task Retry_runs_the_reads_again()
    {
        var vm = ViewModel(EmptyInboxPageSource.Instance);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
    }

    // ── Diagnostics ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_records_a_pii_safe_view_opened_event()
    {
        var events = new List<string>();
        var diagnostics = new InboxPageDiagnostics(events.Add);
        var vm = ViewModel(EmptyInboxPageSource.Instance, diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InboxPage", Assert.Single(events));
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_metadata_matches_the_web_route()
    {
        Assert.Equal("InboxPage", InboxPageRegistration.Slug);
        Assert.Equal("NotificationsInbox", InboxPageRegistration.RouteName);
        Assert.Equal("notifications/archived", InboxPageRegistration.ArchivedRoute);
    }

    [Fact]
    public void Source_targets_the_generated_vehicles_and_alert_rules_operations()
    {
        Assert.Equal("get_api_v1_vehicles", InboxPageSource.VehiclesOperation);
        Assert.Equal("get_api_v1_alerts_rules", InboxPageSource.AlertRulesOperation);
    }

    // ── JSON adapters ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Parse_vehicles_reads_snake_and_camel_case()
    {
        var vehicles = InboxPageJson.ParseVehicles(Json(
            """[ { "id": 1, "display_name": "Model 3" }, { "id": 2, "displayName": "Model Y" } ]"""));

        Assert.Equal(2, vehicles.Count);
        Assert.Equal("Model 3", vehicles[0].DisplayName);
        Assert.Equal("Model Y", vehicles[1].DisplayName);
    }

    [Fact]
    public void Parse_vehicles_skips_malformed_entries()
    {
        var vehicles = InboxPageJson.ParseVehicles(Json(
            """[ { "display_name": "No id" }, { "id": 9, "display_name": "Kept" } ]"""));

        Assert.Single(vehicles);
        Assert.Equal(9, vehicles[0].Id);
    }

    [Fact]
    public void Parse_alert_rules_reads_id_and_name()
    {
        var rules = InboxPageJson.ParseAlertRules(Json(
            """[ { "id": 5, "name": "Low battery" }, { "id": 6, "name": "Charge complete" } ]"""));

        Assert.Equal(2, rules.Count);
        Assert.Equal(5, rules[0].Id);
        Assert.Equal("Low battery", rules[0].Name);
    }

    [Theory]
    [InlineData("null", true)]
    [InlineData("[]", true)]
    [InlineData("""[ { "id": 1 } ]""", false)]
    public void IsEmptyArray_classifies_null_and_empty_payloads(string json, bool expected) =>
        Assert.Equal(expected, InboxPageJson.IsEmptyArray(Json(json)));
}
