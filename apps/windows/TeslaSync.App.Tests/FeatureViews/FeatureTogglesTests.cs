using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the feature-toggles surface's UI-thread-free logic — the JSON parse adapters
/// (the JS-truthiness <c>enabled</c> rule, the <c>JSON.stringify</c> detail fold, the envelope snapshot), the
/// projection (Enabled/Disabled badge label → token status, the em-dash scalar detail, the Narrator names and
/// the "Synced {when}" caption), the cache-then-network result mapper, the repository source's request shape
/// (read + refresh operations), the state-holder view-model's state matrix (loading / loaded / empty / error /
/// stale / offline), the refresh mutation's success/refetch and failure/toast flows, the registry metadata and
/// the diagnostics. Mirrors the web spec (web/src/features/settings/components/FeatureToggles.tsx).
/// </summary>
public sealed class FeatureTogglesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Entry parse adapter (web featureEntries memo) ------------------------------

    [Fact]
    public void Entry_object_value_reads_enabled_and_folds_details()
    {
        using var doc = JsonDocument.Parse("""{"enabled":true,"tier":"pro","seats":3}""");
        var entry = FeatureToggleEntry.FromValue("alpha", doc.RootElement);

        Assert.Equal("alpha", entry.Key);
        Assert.True(entry.Enabled);
        Assert.Equal("tier: \"pro\", seats: 3", entry.Details);
        Assert.Equal("tier: \"pro\", seats: 3", entry.DetailsText);
    }

    [Fact]
    public void Entry_object_without_enabled_member_is_disabled()
    {
        using var doc = JsonDocument.Parse("""{"tier":"pro"}""");
        var entry = FeatureToggleEntry.FromValue("alpha", doc.RootElement);

        Assert.False(entry.Enabled);
        Assert.Equal("tier: \"pro\"", entry.Details);
    }

    [Fact]
    public void Entry_object_with_only_enabled_has_empty_detail_not_em_dash()
    {
        using var doc = JsonDocument.Parse("""{"enabled":true}""");
        var entry = FeatureToggleEntry.FromValue("alpha", doc.RootElement);

        Assert.True(entry.Enabled);
        Assert.Equal(string.Empty, entry.Details);
        Assert.Equal(string.Empty, entry.DetailsText);
    }

    [Fact]
    public void Entry_scalar_value_is_the_enabled_flag_and_has_no_detail()
    {
        using var on = JsonDocument.Parse("true");
        using var off = JsonDocument.Parse("false");
        using var str = JsonDocument.Parse("\"on\"");
        using var zero = JsonDocument.Parse("0");
        using var emptyStr = JsonDocument.Parse("\"\"");

        Assert.True(FeatureToggleEntry.FromValue("a", on.RootElement).Enabled);
        Assert.False(FeatureToggleEntry.FromValue("b", off.RootElement).Enabled);
        Assert.True(FeatureToggleEntry.FromValue("c", str.RootElement).Enabled);     // non-empty string is truthy
        Assert.False(FeatureToggleEntry.FromValue("d", zero.RootElement).Enabled);   // 0 is falsy
        Assert.False(FeatureToggleEntry.FromValue("e", emptyStr.RootElement).Enabled); // "" is falsy

        // A scalar value carries no detail object → null → em-dash at the display boundary.
        Assert.Null(FeatureToggleEntry.FromValue("a", on.RootElement).Details);
        Assert.Equal("\u2014", FeatureToggleEntry.FromValue("a", on.RootElement).DetailsText);
    }

    [Fact]
    public void Snapshot_parses_envelope_in_document_order_and_tolerates_non_object()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"alpha":{"enabled":true,"tier":"pro"},"beta":false,"gamma":"on"},"fetched_at":"2026-06-06T11:55:00Z"}""");
        var snap = FeatureConfigSnapshot.FromJson(doc.RootElement);

        Assert.Equal("2026-06-06T11:55:00Z", snap.FetchedAt);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), snap.FetchedAtInstant);
        Assert.Collection(
            snap.Entries,
            e => { Assert.Equal("alpha", e.Key); Assert.True(e.Enabled); Assert.Equal("tier: \"pro\"", e.Details); },
            e => { Assert.Equal("beta", e.Key); Assert.False(e.Enabled); Assert.Null(e.Details); },
            e => { Assert.Equal("gamma", e.Key); Assert.True(e.Enabled); Assert.Null(e.Details); });

        using var notObject = JsonDocument.Parse("null");
        Assert.Empty(FeatureConfigSnapshot.FromJson(notObject.RootElement).Entries);

        using var emptyData = JsonDocument.Parse("""{"data":{},"fetched_at":null}""");
        var emptySnap = FeatureConfigSnapshot.FromJson(emptyData.RootElement);
        Assert.Empty(emptySnap.Entries);
        Assert.Null(emptySnap.FetchedAt);
    }

    [Fact]
    public void Snapshot_tolerates_a_non_object_data_member()
    {
        using var doc = JsonDocument.Parse("""{"data":[1,2,3],"fetched_at":"2026-06-06T11:55:00Z"}""");
        var snap = FeatureConfigSnapshot.FromJson(doc.RootElement);
        Assert.Empty(snap.Entries);
        Assert.Equal("2026-06-06T11:55:00Z", snap.FetchedAt);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_maps_enabled_to_success_and_disabled_to_neutral_with_labels()
    {
        var display = FeatureTogglesProjection.Project(
            new[]
            {
                new FeatureToggleEntry("alpha", true, "tier: \"pro\""),
                new FeatureToggleEntry("beta", false, null),
            },
            Localizer);

        Assert.True(display.HasRows);
        Assert.Equal("Feature", display.FeatureHeader);
        Assert.Equal("Status", display.StatusHeader);
        Assert.Equal("Details", display.DetailsHeader);

        Assert.Equal("Enabled", display.Rows[0].StatusLabel);
        Assert.Equal(StatusKind.Success, display.Rows[0].StatusKind);
        Assert.Equal("tier: \"pro\"", display.Rows[0].DetailsText);

        Assert.Equal("Disabled", display.Rows[1].StatusLabel);
        Assert.Equal(StatusKind.Neutral, display.Rows[1].StatusKind);
        Assert.Equal("\u2014", display.Rows[1].DetailsText);
    }

    [Fact]
    public void Project_rows_carry_descriptive_non_empty_automation_names()
    {
        var display = FeatureTogglesProjection.Project(
            new[]
            {
                new FeatureToggleEntry("alpha", true, "tier: \"pro\""),
                new FeatureToggleEntry("beta", false, null),
                new FeatureToggleEntry("delta", true, string.Empty),
            },
            Localizer);

        Assert.Equal("alpha. Enabled. tier: \"pro\"", display.Rows[0].AutomationName);
        Assert.Equal("beta. Disabled", display.Rows[1].AutomationName);             // scalar: no detail clause
        Assert.Equal("delta. Enabled", display.Rows[2].AutomationName);             // empty detail: no detail clause
        Assert.All(display.Rows, r => Assert.False(string.IsNullOrWhiteSpace(r.AutomationName)));
    }

    [Fact]
    public void Project_blank_key_collapses_to_em_dash()
    {
        var display = FeatureTogglesProjection.Project(
            new[] { new FeatureToggleEntry(string.Empty, true, null) },
            Localizer);

        Assert.Equal("\u2014", display.Rows[0].KeyText);
    }

    [Fact]
    public void Project_empty_entry_list_has_no_rows()
    {
        var display = FeatureTogglesProjection.Project(Array.Empty<FeatureToggleEntry>(), Localizer);
        Assert.False(display.HasRows);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void LastSyncedLabel_is_null_without_a_timestamp_and_prefixed_with_one()
    {
        Assert.Null(FeatureTogglesProjection.LastSyncedLabel(null, Localizer, Now));

        var label = FeatureTogglesProjection.LastSyncedLabel(
            new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), Localizer, Now);
        Assert.NotNull(label);
        Assert.StartsWith("Synced ", label);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, FeatureTogglesResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, FeatureTogglesResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var error = FeatureTogglesResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, error.Status);
        Assert.Equal("boom", error.Error!.Message);
    }

    [Fact]
    public void Mapper_loaded_carries_snapshot_even_when_data_empty()
    {
        using var doc = JsonDocument.Parse("""{"data":{},"fetched_at":"2026-06-06T11:55:00Z"}""");
        var mapped = FeatureTogglesResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Empty(mapped.Value!.Entries);
        Assert.Equal("2026-06-06T11:55:00Z", mapped.Value.FetchedAt);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag_and_offline_carries_entries()
    {
        using var doc = JsonDocument.Parse("""{"data":{"alpha":true},"fetched_at":"2026-06-06T11:50:00Z"}""");

        var cached = FeatureTogglesResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!.Entries);

        var offline = FeatureTogglesResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(
                doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Entries);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_config_and_targets_the_generated_read_operation()
    {
        using var doc = JsonDocument.Parse(
            """{"data":{"alpha":{"enabled":true}},"fetched_at":"2026-06-06T11:55:00Z"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamConfigAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!.Entries);
        Assert.Equal("get_api_v1_tesla_user_feature_config", client.Requests[^1].OperationId);
        Assert.Equal(FeatureTogglesSource.ConfigOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Query);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamConfigAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_refresh_targets_the_generated_write_operation_and_succeeds()
    {
        using var doc = JsonDocument.Parse("""{"data":{},"fetched_at":"2026-06-06T11:55:00Z"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var outcome = await source.RefreshAsync();

        Assert.True(outcome.Succeeded);
        Assert.Null(outcome.Error);
        Assert.Equal("post_api_v1_tesla_user_feature_config_refresh", client.Requests[^1].OperationId);
        Assert.Equal(FeatureTogglesSource.RefreshOperation, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_refresh_maps_a_fault_to_a_failure_outcome()
    {
        var client = new FakeApiClient().Throws(new HttpRequestException("boom"));
        var source = NewSource(client);

        var outcome = await source.RefreshAsync();

        Assert.False(outcome.Succeeded);
        Assert.NotNull(outcome.Error);
        Assert.Equal(RepositoryErrorKind.Network, outcome.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new FeatureTogglesViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(FeatureTogglesState.Loading, vm.State);
        Assert.False(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_one_row_per_entry_with_synced_caption()
    {
        using var vm = NewViewModel(Loaded(Snapshot(
            "2026-06-06T11:58:00Z",
            new FeatureToggleEntry("alpha", true, "tier: \"pro\""),
            new FeatureToggleEntry("beta", false, null))));

        await vm.LoadAsync();

        Assert.Equal(FeatureTogglesState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.NotNull(vm.LastSyncedLabel);
        Assert.StartsWith("Synced ", vm.LastSyncedLabel);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_when_no_entries_but_keeps_synced_caption()
    {
        using var vm = NewViewModel(Loaded(Snapshot("2026-06-06T11:55:00Z")));

        await vm.LoadAsync();

        Assert.Equal(FeatureTogglesState.Empty, vm.State);
        Assert.False(vm.Display.HasRows);
        Assert.NotNull(vm.LastSyncedLabel);
        Assert.StartsWith("No feature config data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<FeatureConfigSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(FeatureTogglesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("boom", vm.ErrorMessage);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_rows()
    {
        using var vm = NewViewModel(RepositoryResult<FeatureConfigSnapshot>.Cached(
            Snapshot("2026-06-06T11:50:00Z", new FeatureToggleEntry("alpha", true, null)), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(FeatureTogglesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_rows_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<FeatureConfigSnapshot>.OfflineCached(
            Snapshot("2026-06-06T11:50:00Z", new FeatureToggleEntry("alpha", true, null)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(FeatureTogglesState.Offline, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    // ---- Refresh mutation (web useRefreshTeslaFeatureConfig) ------------------------

    [Fact]
    public async Task ViewModel_refresh_success_raises_toast_and_reloads()
    {
        var source = new FakeSource(
            FeatureConfigRefreshOutcome.Success(),
            Loaded(Snapshot("2026-06-06T11:58:00Z", new FeatureToggleEntry("alpha", true, null))));
        using var vm = new FeatureTogglesViewModel(source, Localizer, () => Now);
        var toasts = new List<FeatureToggleToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Attempts);                       // web onSuccess invalidate+refetch
        Assert.Equal(1, source.RefreshCount);
        Assert.Equal(FeatureTogglesState.Loaded, vm.State);
        Assert.False(vm.IsRefreshing);
        Assert.False(vm.IsFetching);
        var toast = Assert.Single(toasts);
        Assert.Equal(FeatureToggleToastKind.Success, toast.Kind);
        Assert.Equal("Feature config refreshed", toast.Title);
    }

    [Fact]
    public async Task ViewModel_refresh_failure_raises_error_toast_and_leaves_rows()
    {
        var source = new FakeSource(
            FeatureConfigRefreshOutcome.Failure(new RepositoryError(RepositoryErrorKind.Server, "kaboom")),
            Loaded(Snapshot("2026-06-06T11:58:00Z", new FeatureToggleEntry("alpha", true, null))));
        using var vm = new FeatureTogglesViewModel(source, Localizer, () => Now);
        var toasts = new List<FeatureToggleToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(1, vm.Attempts);                       // no refetch on failure
        Assert.Equal(FeatureTogglesState.Loaded, vm.State); // table untouched
        Assert.True(vm.Display.HasRows);
        Assert.False(vm.IsRefreshing);
        var toast = Assert.Single(toasts);
        Assert.Equal(FeatureToggleToastKind.Error, toast.Kind);
        Assert.Equal("Failed to refresh feature config", toast.Title);
        Assert.Equal("kaboom", toast.Description);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new FeatureTogglesViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Feature Flags", vm.Title);
        Assert.Equal("Tesla account feature configuration", vm.Subtitle);
        Assert.Equal("Refresh", vm.RefreshLabel);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.StartsWith("No feature config data", vm.EmptyMessage);
        Assert.Equal("Failed to refresh feature config", vm.ErrorMessageDefault);
    }

    // ---- Toast payloads ------------------------------------------------------------

    [Fact]
    public void Toast_success_and_failure_resolve_through_the_facade()
    {
        var success = FeatureToggleToast.Success(Localizer);
        Assert.Equal(FeatureToggleToastKind.Success, success.Kind);
        Assert.Equal("Feature config refreshed", success.Title);
        Assert.Null(success.Description);

        var failure = FeatureToggleToast.Failure(Localizer, new RepositoryError(RepositoryErrorKind.Server, "boom"));
        Assert.Equal(FeatureToggleToastKind.Error, failure.Kind);
        Assert.Equal("Failed to refresh feature config", failure.Title);
        Assert.Equal("boom", failure.Description);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("feature-toggles", FeatureTogglesRegistration.Id);
        Assert.Equal("FeatureToggles", FeatureTogglesRegistration.Slug);
        Assert.Equal("Feature Flags", FeatureTogglesRegistration.Title(Localizer));
        Assert.Equal("Tesla account feature configuration", FeatureTogglesRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new FeatureTogglesDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FeatureToggles", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static FeatureTogglesViewModel NewViewModel(params RepositoryResult<FeatureConfigSnapshot>[] results) =>
        new(new FakeSource(FeatureConfigRefreshOutcome.Success(), results), Localizer, () => Now);

    private static FeatureTogglesSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new FeatureTogglesSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<FeatureConfigSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<FeatureConfigSnapshot>> stream)
    {
        var list = new List<RepositoryResult<FeatureConfigSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static RepositoryResult<FeatureConfigSnapshot> Loaded(FeatureConfigSnapshot snapshot) =>
        RepositoryResult<FeatureConfigSnapshot>.Loaded(snapshot, Now);

    private static FeatureConfigSnapshot Snapshot(string? fetchedAt, params FeatureToggleEntry[] entries) =>
        new(fetchedAt, entries);

    private sealed class FakeSource : IFeatureTogglesSource
    {
        private readonly IReadOnlyList<RepositoryResult<FeatureConfigSnapshot>> _results;
        private readonly FeatureConfigRefreshOutcome _refreshOutcome;

        public FakeSource(
            FeatureConfigRefreshOutcome? refreshOutcome = null,
            params RepositoryResult<FeatureConfigSnapshot>[] results)
        {
            _results = results;
            _refreshOutcome = refreshOutcome ?? FeatureConfigRefreshOutcome.Success();
        }

        public int RefreshCount { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<FeatureConfigSnapshot>> StreamConfigAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<FeatureConfigRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
        {
            RefreshCount++;
            return Task.FromResult(_refreshOutcome);
        }
    }
}
