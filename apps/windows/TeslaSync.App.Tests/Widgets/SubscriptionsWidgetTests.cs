using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the SubscriptionsWidget's UI-thread-free logic — the JSON parse adapter (the six
/// known subscription flags + the generic <c>subscriptions[]</c> array, deduped, with the <c>asString</c> /
/// truthiness / coalesce edge cases), the <c>daysUntil</c> / active computation, the projection (the detail
/// rows + their Active/Expired badges, the compact active-count + next-expiry summary, the accessibility
/// names), the footprint flag, the cache-then-network source (vehicle resolution → subscriptions read,
/// short-circuiting to Empty when no vehicle), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web
/// spec (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx).
/// </summary>
public sealed class SubscriptionsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 0, 0, TimeSpan.Zero);
    private const string EmDash = "\u2014";

    // A noon-UTC future expiry (exactly +10 days) and a noon-UTC past expiry (exactly -10 days), so the
    // whole-day countdown is deterministic regardless of the test runner's local time zone.
    private const string FutureExpiry = "2026-06-18T12:00:00Z";
    private const string PastExpiry = "2026-05-29T12:00:00Z";

    // ---- Parse adapter: known-type flags -------------------------------------------

    [Fact]
    public void Parse_known_flag_without_expiry_is_active_when_truthy()
    {
        var subs = Parse("""{"premium_connectivity":true}""");

        var sub = Assert.Single(subs);
        Assert.Equal("Premium Connectivity", sub.Name);
        Assert.True(sub.Active);
        Assert.Null(sub.ExpiryDate);
        Assert.Null(sub.DaysLeft);
    }

    [Fact]
    public void Parse_skips_absent_null_false_and_empty_string_flags()
    {
        var subs = Parse(
            """{"premium_connectivity":null,"full_self_driving":false,"enhanced_autopilot":"","data_sharing":true}""");

        var sub = Assert.Single(subs);
        Assert.Equal("Data Sharing", sub.Name);
    }

    [Fact]
    public void Parse_known_flag_zero_is_present_but_inactive()
    {
        // Web parity: 0 is not skipped (it isn't null/false/''), but Boolean(0) is false.
        var sub = Assert.Single(Parse("""{"premium_connectivity":0}"""));

        Assert.True(sub.Active == false);
        Assert.Null(sub.ExpiryDate);
    }

    [Fact]
    public void Parse_known_flag_with_future_expiry_is_active()
    {
        var sub = Assert.Single(Parse($$"""{"premium_connectivity":true,"premium_connectivity_expiry_date":"{{FutureExpiry}}"}"""));

        Assert.True(sub.Active);
        Assert.Equal(FutureExpiry, sub.ExpiryDate);
        Assert.Equal(10, sub.DaysLeft);
    }

    [Fact]
    public void Parse_known_flag_with_past_expiry_is_expired()
    {
        var sub = Assert.Single(Parse($$"""{"full_self_driving":true,"full_self_driving_expiry":"{{PastExpiry}}"}"""));

        Assert.Equal("Full Self-Driving", sub.Name);
        Assert.False(sub.Active);
        Assert.Equal(-10, sub.DaysLeft);
    }

    [Fact]
    public void Parse_known_expiry_prefers_expiry_date_over_expiry()
    {
        var sub = Assert.Single(Parse(
            $$"""{"data_sharing":true,"data_sharing_expiry_date":"{{FutureExpiry}}","data_sharing_expiry":"{{PastExpiry}}"}"""));

        Assert.Equal(FutureExpiry, sub.ExpiryDate);
    }

    [Fact]
    public void Parse_known_expiry_falls_back_to_expiry_when_expiry_date_absent()
    {
        var sub = Assert.Single(Parse($$"""{"data_sharing":true,"data_sharing_expiry":"{{FutureExpiry}}"}"""));

        Assert.Equal(FutureExpiry, sub.ExpiryDate);
    }

    [Fact]
    public void Parse_known_expiry_empty_string_short_circuits_the_coalesce()
    {
        // Web parity: `data[a] ?? data[b]` keeps an empty-string `a` (not nullish), so asString('') → null and
        // `b` is never consulted. With no expiry the active flag falls back to Boolean(val).
        var sub = Assert.Single(Parse(
            $$"""{"premium_connectivity":true,"premium_connectivity_expiry_date":"","premium_connectivity_expiry":"{{FutureExpiry}}"}"""));

        Assert.Null(sub.ExpiryDate);
        Assert.True(sub.Active);
        Assert.Null(sub.DaysLeft);
    }

    [Fact]
    public void Parse_known_renewal_coalesces_renewal_then_renewal_type()
    {
        var sub = Assert.Single(Parse("""{"premium_connectivity":true,"premium_connectivity_renewal_type":"annual"}"""));

        Assert.Equal("annual", sub.RenewalType);
    }

    [Fact]
    public void Parse_preserves_known_type_order()
    {
        var subs = Parse("""{"satellite_connectivity":true,"premium_connectivity":true,"data_sharing":true}""");

        Assert.Collection(
            subs,
            s => Assert.Equal("Premium Connectivity", s.Name),
            s => Assert.Equal("Data Sharing", s.Name),
            s => Assert.Equal("Satellite Connectivity", s.Name));
    }

    // ---- Parse adapter: generic subscriptions[] array ------------------------------

    [Fact]
    public void Parse_generic_array_uses_name_then_type_then_unknown()
    {
        var subs = Parse(
            """{"subscriptions":[{"name":"Toolbox"},{"type":"LTE"},{"foo":"bar"}]}""");

        Assert.Collection(
            subs,
            s => Assert.Equal("Toolbox", s.Name),
            s => Assert.Equal("LTE", s.Name),
            s => Assert.Equal("Unknown", s.Name));
    }

    [Fact]
    public void Parse_generic_numeric_name_is_stringified()
    {
        var sub = Assert.Single(Parse("""{"subscriptions":[{"name":123}]}"""));
        Assert.Equal("123", sub.Name);
    }

    [Fact]
    public void Parse_generic_status_active_wins_over_expiry()
    {
        var sub = Assert.Single(Parse(
            $$"""{"subscriptions":[{"name":"X","status":"ACTIVE","expiry_date":"{{PastExpiry}}"}]}"""));

        // Status drives the active flag regardless of the (past) expiry.
        Assert.True(sub.Active);
    }

    [Fact]
    public void Parse_generic_status_expired_is_inactive()
    {
        var sub = Assert.Single(Parse("""{"subscriptions":[{"name":"X","status":"expired"}]}"""));
        Assert.False(sub.Active);
    }

    [Fact]
    public void Parse_generic_without_status_or_expiry_is_active()
    {
        var sub = Assert.Single(Parse("""{"subscriptions":[{"name":"X"}]}"""));
        Assert.True(sub.Active);
    }

    [Fact]
    public void Parse_generic_expiry_coalesces_expiry_date_expiry_end_date()
    {
        var sub = Assert.Single(Parse($$"""{"subscriptions":[{"name":"X","end_date":"{{FutureExpiry}}"}]}"""));
        Assert.Equal(FutureExpiry, sub.ExpiryDate);
        Assert.Equal(10, sub.DaysLeft);
    }

    [Fact]
    public void Parse_generic_skips_non_object_items()
    {
        var subs = Parse("""{"subscriptions":[null,42,"x",{"name":"Y"}]}""");
        Assert.Equal("Y", Assert.Single(subs).Name);
    }

    [Fact]
    public void Parse_dedupes_generic_against_known_case_insensitively()
    {
        var subs = Parse(
            $$"""{"premium_connectivity":true,"subscriptions":[{"name":"premium connectivity","expiry_date":"{{FutureExpiry}}"}]}""");

        var sub = Assert.Single(subs);
        Assert.Equal("Premium Connectivity", sub.Name);
        Assert.Null(sub.ExpiryDate); // the known entry (no expiry) is kept; the generic duplicate is dropped
    }

    [Fact]
    public void Parse_non_object_data_is_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Empty(SubscriptionsParser.Parse(doc.RootElement, Now, Localizer));
    }

    // ---- daysUntil -----------------------------------------------------------------

    [Fact]
    public void DaysUntil_null_or_unparseable_is_null()
    {
        Assert.Null(SubscriptionsParser.DaysUntil(null, Now));
        Assert.Null(SubscriptionsParser.DaysUntil("", Now));
        Assert.Null(SubscriptionsParser.DaysUntil("not-a-date", Now));
        Assert.Null(SubscriptionsParser.DaysUntil("1700000000", Now));
    }

    [Fact]
    public void DaysUntil_uses_ceiling_of_whole_days()
    {
        // +1.5 days → ceil → 2; -1.5 days → ceil → -1 (matches JS Math.ceil).
        Assert.Equal(2, SubscriptionsParser.DaysUntil("2026-06-10T00:00:00Z", Now));
        Assert.Equal(-1, SubscriptionsParser.DaysUntil("2026-06-07T00:00:00Z", Now));
    }

    // ---- Snapshot ------------------------------------------------------------------

    [Fact]
    public void Snapshot_from_envelope_keeps_data_object_json()
    {
        using var doc = JsonDocument.Parse("""{"data":{"premium_connectivity":true},"fetched_at":"2026-06-06T00:00:00Z"}""");
        var snapshot = SubscriptionsSnapshot.FromEnvelope(doc.RootElement);

        Assert.NotNull(snapshot.DataJson);
        Assert.Contains("premium_connectivity", snapshot.DataJson);
    }

    [Theory]
    [InlineData("""{"data":null,"fetched_at":null}""")]
    [InlineData("""{"fetched_at":null}""")]
    [InlineData("""{"data":[]}""")]
    [InlineData("[]")]
    public void Snapshot_from_envelope_without_data_object_is_none(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SubscriptionsSnapshot.FromEnvelope(doc.RootElement).DataJson);
    }

    // ---- Projection: detail entries ------------------------------------------------

    [Fact]
    public void Project_builds_one_entry_per_subscription_with_badges()
    {
        var display = Project($$"""
            {"premium_connectivity":true,"premium_connectivity_expiry_date":"{{FutureExpiry}}",
             "full_self_driving":true,"full_self_driving_expiry":"{{PastExpiry}}"}
            """);

        Assert.True(display.HasSubscriptions);
        Assert.Equal(2, display.Entries.Count);

        var active = display.Entries[0];
        Assert.Equal("Premium Connectivity", active.Label);
        Assert.True(active.Active);
        Assert.Equal("Active", active.BadgeText);
        Assert.Equal(SubscriptionsProjection.FormatDate(FutureExpiry, Now), active.Value);

        var expired = display.Entries[1];
        Assert.False(expired.Active);
        Assert.Equal("Expired", expired.BadgeText);
    }

    [Fact]
    public void Project_entry_value_falls_back_to_renewal_then_em_dash()
    {
        var renewal = Assert.Single(Project("""{"premium_connectivity":true,"premium_connectivity_renewal":"annual"}""").Entries);
        Assert.Equal("annual", renewal.Value);

        var none = Assert.Single(Project("""{"data_sharing":true}""").Entries);
        Assert.Equal(EmDash, none.Value);
    }

    [Fact]
    public void Project_entry_accessibility_name_is_label_value_badge()
    {
        var entry = Assert.Single(Project("""{"premium_connectivity":true,"premium_connectivity_renewal":"annual"}""").Entries);
        Assert.Equal("Premium Connectivity: annual, Active", entry.AccessibilityName);
    }

    // ---- Projection: compact summary -----------------------------------------------

    [Fact]
    public void Project_compact_counts_active_and_picks_nearest_expiry()
    {
        var display = Project(
            $$"""
            {"premium_connectivity":true,"premium_connectivity_expiry_date":"{{FutureExpiry}}",
             "full_self_driving":true,
             "data_sharing":true,"data_sharing_expiry_date":"{{PastExpiry}}"}
            """,
            new SubscriptionsSize(1, 2));

        Assert.True(display.IsCompact);
        Assert.Equal(2, display.ActiveCount); // premium (future) + fsd (no-expiry truthy); data_sharing expired
        Assert.Equal(SubscriptionsProjection.FormatDate(FutureExpiry, Now), display.NextExpiryText);
    }

    [Fact]
    public void Project_compact_next_expiry_prefers_smallest_positive_days()
    {
        const string nearer = "2026-06-13T12:00:00Z"; // +5 days
        var display = Project(
            $$"""
            {"premium_connectivity":true,"premium_connectivity_expiry_date":"{{FutureExpiry}}",
             "data_sharing":true,"data_sharing_expiry_date":"{{nearer}}"}
            """,
            new SubscriptionsSize(1, 2));

        Assert.Equal(SubscriptionsProjection.FormatDate(nearer, Now), display.NextExpiryText);
    }

    [Fact]
    public void Project_compact_accessibility_name_summarizes_count_and_expiry()
    {
        var display = Project(
            $$"""{"premium_connectivity":true,"premium_connectivity_expiry_date":"{{FutureExpiry}}"}""",
            new SubscriptionsSize(1, 2));

        Assert.StartsWith("Subscriptions: 1 active", display.CompactAccessibilityName);
        Assert.Contains(SubscriptionsProjection.FormatDate(FutureExpiry, Now), display.CompactAccessibilityName);
    }

    [Fact]
    public void Project_empty_snapshot_has_no_subscriptions()
    {
        var display = SubscriptionsProjection.Project(SubscriptionsSnapshot.None, SubscriptionsSize.Default, Now, Localizer);

        Assert.False(display.HasSubscriptions);
        Assert.Equal(0, display.ActiveCount);
        Assert.Null(display.NextExpiryText);
        Assert.Empty(display.Entries);
        Assert.Equal("No subscriptions", display.CompactAccessibilityName);
    }

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Project_compact_flag_tracks_footprint(int cols, int rows, bool compact)
    {
        var display = SubscriptionsProjection.Project(
            SubscriptionsSnapshot.None, new SubscriptionsSize(cols, rows), Now, Localizer);
        Assert.Equal(compact, display.IsCompact);
    }

    // ---- FormatDate ----------------------------------------------------------------

    [Fact]
    public void FormatDate_null_or_unparseable_is_em_dash()
    {
        Assert.Equal(EmDash, SubscriptionsProjection.FormatDate(null, Now));
        Assert.Equal(EmDash, SubscriptionsProjection.FormatDate("not-a-date", Now));
    }

    [Fact]
    public void FormatDate_valid_date_is_month_day_year()
    {
        var formatted = SubscriptionsProjection.FormatDate("2027-01-01T12:00:00Z", Now);
        Assert.NotEqual(EmDash, formatted);
        Assert.Contains("Jan", formatted);
        Assert.Contains("2027", formatted);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SubscriptionsSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Loading, vm.State);
        Assert.False(vm.HasSubscriptions);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_subscriptions_exposes_entries()
    {
        using var vm = NewViewModel(Loaded(Snapshot("""{"premium_connectivity":true}""")));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Loaded, vm.State);
        Assert.True(vm.HasSubscriptions);
        Assert.Single(vm.Display.Entries);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_no_recognized_subscriptions_is_empty()
    {
        using var vm = NewViewModel(Loaded(Snapshot("""{"unrelated":1}""")));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Empty, vm.State);
        Assert.False(vm.HasSubscriptions);
        Assert.Equal("No subscriptions", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_engine_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SubscriptionsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Empty, vm.State);
        Assert.False(vm.HasSubscriptions);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SubscriptionsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_entries()
    {
        using var vm = NewViewModel(
            RepositoryResult<SubscriptionsSnapshot>.Cached(Snapshot("""{"premium_connectivity":true}"""), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasSubscriptions);
        Assert.Single(vm.Display.Entries);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_entries()
    {
        using var vm = NewViewModel(RepositoryResult<SubscriptionsSnapshot>.OfflineCached(
            Snapshot("""{"premium_connectivity":true}"""), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasSubscriptions);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SubscriptionsSnapshot>.Loading(),
            RepositoryResult<SubscriptionsSnapshot>.Cached(Snapshot("""{"premium_connectivity":true}"""), Now, stale: false),
            RepositoryResult<SubscriptionsSnapshot>.Loaded(Snapshot("""{"premium_connectivity":true,"full_self_driving":true}"""), Now));
        await vm.LoadAsync();

        Assert.Equal(SubscriptionsState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Entries.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_flag()
    {
        using var vm = NewViewModel(new SubscriptionsSize(2, 4), Loaded(Snapshot("""{"premium_connectivity":true}""")));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new SubscriptionsSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(SubscriptionsState.Loaded, vm.State);
        Assert.True(vm.HasSubscriptions);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SubscriptionsSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Subscriptions", vm.Title);
        Assert.Equal("No subscriptions", vm.EmptyMessage);
        Assert.Equal("active", vm.ActiveCountLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot("""{"premium_connectivity":true}""")));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SubscriptionsViewModel.State), changed);
        Assert.Contains(nameof(SubscriptionsViewModel.Display), changed);
    }

    // ---- Source: vehicle resolution + read -----------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SubscriptionsSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_subscriptions()
    {
        using var envelope = JsonDocument.Parse(
            """{"data":{"premium_connectivity":true},"fetched_at":"2026-06-06T00:00:00Z"}""");
        var api = new FakeApiClient().ReturnsValue(envelope.RootElement);
        var source = new SubscriptionsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.NotNull(terminal.Value!.DataJson);
        Assert.Single(SubscriptionsProjection.ParseSnapshot(terminal.Value, Now, Localizer));

        Assert.Single(api.Requests);
        Assert.Equal(SubscriptionsRegistration.SubscriptionsOperationId, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams![SubscriptionsRegistration.VehiclePathParam]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var envelope = JsonDocument.Parse("""{"data":{"data_sharing":true},"fetched_at":null}""");
        var api = new FakeApiClient().ReturnsValue(envelope.RootElement);
        var source = new SubscriptionsSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("42", api.Requests[^1].PathParams![SubscriptionsRegistration.VehiclePathParam]);
    }

    [Fact]
    public async Task Source_envelope_without_data_resolves_empty_subscription_snapshot()
    {
        using var envelope = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");
        var api = new FakeApiClient().ReturnsValue(envelope.RootElement);
        var source = new SubscriptionsSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Null(terminal.Value!.DataJson);
        Assert.Empty(SubscriptionsProjection.ParseSnapshot(terminal.Value, Now, Localizer));
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("subscriptions", SubscriptionsRegistration.Id);
        Assert.Equal("vehicle", SubscriptionsRegistration.Category);
        Assert.Equal("SubscriptionsWidget", SubscriptionsRegistration.Slug);
        Assert.Equal(new SubscriptionsSize(2, 4), SubscriptionsRegistration.DefaultSize);
        Assert.Equal(new SubscriptionsSize(1, 2), SubscriptionsRegistration.MinSize);
        Assert.Equal(new SubscriptionsSize(4, 40), SubscriptionsRegistration.MaxSize);
        Assert.Equal("Subscriptions", SubscriptionsRegistration.Name(Localizer));
        Assert.Contains("FSD", SubscriptionsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
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
        Assert.Equal(within, SubscriptionsRegistration.IsWithinBounds(new SubscriptionsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SubscriptionsSize(1, 2), SubscriptionsRegistration.Clamp(new SubscriptionsSize(0, 0)));
        Assert.Equal(new SubscriptionsSize(4, 40), SubscriptionsRegistration.Clamp(new SubscriptionsSize(9, 99)));
    }

    [Fact]
    public void Registration_operation_id_resolves_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);

        Assert.True(index.TryGetValue(SubscriptionsRegistration.SubscriptionsOperationId, out var endpoint));
        Assert.Contains(SubscriptionsRegistration.VehiclePathParam, endpoint!.PathParams);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SubscriptionsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SubscriptionsWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static IReadOnlyList<ParsedSubscription> Parse(string dataJson)
    {
        using var doc = JsonDocument.Parse(dataJson);
        return SubscriptionsParser.Parse(doc.RootElement, Now, Localizer);
    }

    private static SubscriptionsSnapshot Snapshot(string dataJson) => new(dataJson);

    private static SubscriptionsDisplay Project(string dataJson) => Project(dataJson, SubscriptionsSize.Default);

    private static SubscriptionsDisplay Project(string dataJson, SubscriptionsSize size) =>
        SubscriptionsProjection.Project(Snapshot(dataJson), size, Now, Localizer);

    private static RepositoryResult<SubscriptionsSnapshot> Loaded(SubscriptionsSnapshot snapshot) =>
        RepositoryResult<SubscriptionsSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<SubscriptionsSnapshot>>> Drain(ISubscriptionsSource source)
    {
        var results = new List<RepositoryResult<SubscriptionsSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static SubscriptionsViewModel NewViewModel(params RepositoryResult<SubscriptionsSnapshot>[] emissions) =>
        NewViewModel(SubscriptionsSize.Default, emissions);

    private static SubscriptionsViewModel NewViewModel(
        SubscriptionsSize size,
        params RepositoryResult<SubscriptionsSnapshot>[] emissions) =>
        new(new FakeSubscriptionsSource(emissions), Localizer, size, () => Now);

    private sealed class FakeSubscriptionsSource(params RepositoryResult<SubscriptionsSnapshot>[] emissions)
        : ISubscriptionsSource
    {
        public async IAsyncEnumerable<RepositoryResult<SubscriptionsSnapshot>> StreamAsync(
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
