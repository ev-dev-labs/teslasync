using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ArchivedPage</c> surface's Microsoft.UI-free logic — the tolerant vehicle /
/// rule context parsers (web <c>vehicleMap</c> / <c>ruleMap</c>), the i18n projection (the three
/// <c>notifications.archived.*</c> keys + the non-blocking failure strip), the four-state view-model matrix
/// (loading / loaded / empty / error), the PII-safe diagnostics, and the generated-client source's request
/// shaping (web <c>useVehicles</c> + <c>useAlertRules</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="ArchivedDisplay"/> flags asserted here. Mirrors
/// the web spec (web/src/features/notifications/pages/ArchivedPage.tsx).
/// </summary>
public sealed class ArchivedPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The three i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "notifications.archived.backToInbox",
        "notifications.archived.subtitle",
        "notifications.archived.title",
    ];

    // ---- Vehicle / rule parsers (web vehicleMap / ruleMap) -------------------------

    [Fact]
    public void Vehicle_map_parses_snake_case_and_camel_case_ids_and_names()
    {
        using var doc = JsonDocument.Parse("""
        [{"id":7,"display_name":"Garage Y","model":"modely"},
         {"id":"9","displayName":"Second"}]
        """);

        var map = ArchivedContext.ParseVehicleMap(doc.RootElement);

        Assert.Equal(2, map.Count);
        Assert.Equal("Garage Y", map[7]);
        Assert.Equal("Second", map[9]);
    }

    [Fact]
    public void Vehicle_map_falls_back_to_a_generated_name_when_unnamed()
    {
        using var doc = JsonDocument.Parse("""[{"id":3}]""");

        var map = ArchivedContext.ParseVehicleMap(doc.RootElement);

        Assert.Equal("Vehicle 3", map[3]);
    }

    [Fact]
    public void Rule_map_parses_id_and_name()
    {
        using var doc = JsonDocument.Parse("""
        [{"id":42,"name":"Battery low","vehicle_id":7,"enabled":true},
         {"id":43}]
        """);

        var map = ArchivedContext.ParseRuleMap(doc.RootElement);

        Assert.Equal("Battery low", map[42]);
        Assert.Equal("Rule 43", map[43]);
    }

    [Fact]
    public void Maps_are_empty_for_non_array_bodies()
    {
        using var obj = JsonDocument.Parse("{}");

        Assert.Empty(ArchivedContext.ParseVehicleMap(obj.RootElement));
        Assert.Empty(ArchivedContext.ParseRuleMap(obj.RootElement));
    }

    [Fact]
    public void Context_has_data_when_either_map_is_non_empty()
    {
        Assert.False(ArchivedContext.Empty.HasData);
        Assert.True(new ArchivedContext(
            new Dictionary<long, string> { [1] = "A" },
            new Dictionary<long, string>()).HasData);
        Assert.True(new ArchivedContext(
            new Dictionary<long, string>(),
            new Dictionary<long, string> { [1] = "R" }).HasData);
    }

    // ---- Projection / strings -------------------------------------------------------

    [Fact]
    public void Projection_resolves_the_three_web_string_keys_with_verbatim_defaults()
    {
        var recorder = new RecordingLocalizer();

        var display = ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Loaded, recorder);

        Assert.Equal("Archived notifications", display.Title);
        Assert.Equal("Notifications you previously archived. Restore to bring them back.", display.Subtitle);
        Assert.Equal("Back to inbox", display.BackToInboxText);
        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_shows_the_failure_strip_only_in_the_error_state()
    {
        Assert.False(ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Loaded, Localizer).ShowContextError);
        Assert.False(ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Empty, Localizer).ShowContextError);

        var error = ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Error, Localizer);
        Assert.True(error.ShowContextError);
        Assert.Equal("Failed to load data", error.ContextErrorText);
        Assert.Equal("Retry", error.RetryText);
    }

    [Fact]
    public void Projection_carries_the_copy_link_deep_link()
    {
        var display = ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Loaded, Localizer);

        Assert.Equal("teslasync://notifications/archived", display.CopyLinkText);
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_starts_loading_then_resolves_loaded()
    {
        var context = new ArchivedContext(
            new Dictionary<long, string> { [7] = "Garage Y" },
            new Dictionary<long, string> { [42] = "Battery low" });
        using var vm = NewViewModel(RepositoryResult<ArchivedContext>.Loaded(context, Now));

        Assert.Equal(ArchivedContextState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(ArchivedContextState.Loaded, vm.State);
        Assert.Equal("Archived notifications", vm.Display.Title);
    }

    [Fact]
    public async Task ViewModel_classifies_an_empty_context_as_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ArchivedContext>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(ArchivedContextState.Empty, vm.State);
        Assert.False(vm.Display.ShowContextError);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_failure()
    {
        using var vm = NewViewModel(
            RepositoryResult<ArchivedContext>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(ArchivedContextState.Error, vm.State);
        Assert.True(vm.Display.ShowContextError);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new ArchivedPageViewModel(
            new FakeArchivedContextSource(), Localizer, new ArchivedDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=ArchivedPage", lines);
    }

    // ---- Registration ---------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_keys()
    {
        Assert.Equal("NotificationsArchived", ArchivedRegistration.RouteName);
        Assert.Equal("notifications/archived", ArchivedRegistration.Route);
        Assert.Equal("notifications/inbox", ArchivedRegistration.InboxRoute);
        Assert.Equal("ArchivedPage", ArchivedRegistration.Slug);
        Assert.Equal("get_api_v1_alerts_rules", ArchivedRegistration.AlertRulesOperation);
        Assert.Equal("Archived notifications", ArchivedRegistration.Title(Localizer));
        Assert.Equal("Back to inbox", ArchivedRegistration.BackToInbox(Localizer));
    }

    // ---- Source request shaping (web useVehicles + useAlertRules) -------------------

    [Fact]
    public async Task Source_reads_vehicles_then_alert_rules_and_assembles_the_context()
    {
        var vehicles = Clone("""[{"id":7,"display_name":"Garage Y"}]""");
        var rules = Clone("""[{"id":42,"name":"Battery low","vehicle_id":7}]""");
        var api = new FakeApiClient().ReturnsValue(vehicles).ReturnsValue(rules);
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var source = new ArchivedContextSource(api, engine, new ApiClientOptions());

        ArchivedContext? loaded = null;
        await foreach (var emission in source.StreamAsync())
        {
            if (emission.Status == LoadStatus.Loaded)
            {
                loaded = emission.Value;
            }
        }

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_vehicles", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_alerts_rules", api.Requests[1].OperationId);
        Assert.NotNull(loaded);
        Assert.Equal("Garage Y", loaded!.Vehicles[7]);
        Assert.Equal("Battery low", loaded.Rules[42]);
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static JsonElement Clone(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static ArchivedPageViewModel NewViewModel(params RepositoryResult<ArchivedContext>[] emissions) =>
        new(new FakeArchivedContextSource(emissions), Localizer);

    private sealed class FakeArchivedContextSource(params RepositoryResult<ArchivedContext>[] emissions)
        : IArchivedContextSource
    {
        public async IAsyncEnumerable<RepositoryResult<ArchivedContext>> StreamAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
