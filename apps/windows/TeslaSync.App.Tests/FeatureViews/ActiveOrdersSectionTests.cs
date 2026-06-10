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
/// Headless verification of the active-orders surface's UI-thread-free logic — the JSON parse adapters (the
/// order envelope snapshot and the per-order fields), the order-status presentation (the
/// <c>orderStatusVariant</c> badge mapping and the <c>formatOrderStatus</c> Title Case), the projection (the
/// card model name with its em-dash fallback, the VIN / delivery-date conditionals, the Narrator names and the
/// "Synced {when}" caption), the cache-then-network result mapper, the repository source's request shape (read
/// + refresh operations), the state-holder view-model's state matrix (loading / loaded / empty / error / stale
/// / offline) including the two empty-body messages, the refresh mutation's success/refetch and failure/toast
/// flows, the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/ActiveOrdersSection.tsx).
/// </summary>
public sealed class ActiveOrdersSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Order-status presentation (web orderStatusVariant + formatOrderStatus) ------

    [Theory]
    [InlineData("DELIVERED", StatusKind.Success)]
    [InlineData("ready_for_delivery", StatusKind.Success)]   // contains DELIVER
    [InlineData("READY_FOR_PICKUP", StatusKind.Info)]
    [InlineData("IN_TRANSPORT", StatusKind.Info)]
    [InlineData("CANCELLED", StatusKind.Danger)]
    [InlineData("REJECTED", StatusKind.Danger)]
    [InlineData("PENDING", StatusKind.Warning)]
    [InlineData("BOOKED_ORDER", StatusKind.Warning)]         // contains ORDER
    [InlineData("SOMETHING_ELSE", StatusKind.Neutral)]
    public void Variant_maps_status_keywords_to_token_status(string status, StatusKind expected)
    {
        Assert.Equal(expected, OrderStatusPresentation.Variant(status));
    }

    [Fact]
    public void Variant_of_missing_status_is_neutral()
    {
        Assert.Equal(StatusKind.Neutral, OrderStatusPresentation.Variant(null));
        Assert.Equal(StatusKind.Neutral, OrderStatusPresentation.Variant(string.Empty));
    }

    [Theory]
    [InlineData("IN_TRANSPORT", "In Transport")]
    [InlineData("ready_for_delivery", "Ready For Delivery")]
    [InlineData("DELIVERED", "Delivered")]
    public void Format_title_cases_each_word_and_replaces_underscores(string status, string expected)
    {
        Assert.Equal(expected, OrderStatusPresentation.Format(status));
    }

    [Fact]
    public void Format_of_missing_status_is_em_dash()
    {
        Assert.Equal("\u2014", OrderStatusPresentation.Format(null));
        Assert.Equal("\u2014", OrderStatusPresentation.Format(string.Empty));
    }

    // ---- Order + snapshot parse adapters --------------------------------------------

    [Fact]
    public void Order_parses_every_card_field_tolerantly()
    {
        using var doc = JsonDocument.Parse(
            """
            {"id":7,"order_id":"RN123","model":"Model 3","status":"IN_TRANSPORT",
             "delivery_date":"2026-07-15T12:00:00Z","vin":"5YJ3E1EA7","is_upgradable":true}
            """);
        var order = TeslaOrderModel.FromJson(doc.RootElement);

        Assert.Equal("RN123", order.OrderId);
        Assert.Equal("Model 3", order.Model);
        Assert.Equal("IN_TRANSPORT", order.Status);
        Assert.Equal("2026-07-15T12:00:00Z", order.DeliveryDate);
        Assert.Equal("5YJ3E1EA7", order.Vin);
        Assert.True(order.IsUpgradable);
    }

    [Fact]
    public void Order_tolerates_missing_optional_fields()
    {
        using var doc = JsonDocument.Parse("""{"order_id":"RN9"}""");
        var order = TeslaOrderModel.FromJson(doc.RootElement);

        Assert.Equal("RN9", order.OrderId);
        Assert.Equal(string.Empty, order.Model);
        Assert.Null(order.Status);
        Assert.Null(order.DeliveryDate);
        Assert.Null(order.Vin);
        Assert.False(order.IsUpgradable);
    }

    [Fact]
    public void Snapshot_parses_envelope_in_document_order_and_tolerates_non_object()
    {
        using var doc = JsonDocument.Parse(
            """
            {"orders":[
              {"order_id":"A","model":"Model Y","status":"DELIVERED"},
              {"order_id":"B","model":"Model S","status":"PENDING"}
            ],"fetched_at":"2026-06-06T11:55:00Z"}
            """);
        var snap = OrdersSnapshot.FromJson(doc.RootElement);

        Assert.Equal("2026-06-06T11:55:00Z", snap.FetchedAt);
        Assert.True(snap.HasFetchTime);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), snap.FetchedAtInstant);
        Assert.Collection(
            snap.Orders,
            o => Assert.Equal("A", o.OrderId),
            o => Assert.Equal("B", o.OrderId));

        using var notObject = JsonDocument.Parse("null");
        Assert.Empty(OrdersSnapshot.FromJson(notObject.RootElement).Orders);

        using var emptyOrders = JsonDocument.Parse("""{"orders":[],"fetched_at":null}""");
        var emptySnap = OrdersSnapshot.FromJson(emptyOrders.RootElement);
        Assert.Empty(emptySnap.Orders);
        Assert.Null(emptySnap.FetchedAt);
        Assert.False(emptySnap.HasFetchTime);
    }

    [Fact]
    public void Snapshot_skips_non_object_array_entries()
    {
        using var doc = JsonDocument.Parse("""{"orders":[1,"x",{"order_id":"C"}],"fetched_at":null}""");
        var snap = OrdersSnapshot.FromJson(doc.RootElement);
        var order = Assert.Single(snap.Orders);
        Assert.Equal("C", order.OrderId);
    }

    // ---- Projection -----------------------------------------------------------------

    [Fact]
    public void Project_maps_each_order_to_a_card_with_labels_and_status()
    {
        var display = ActiveOrdersProjection.Project(
            new[]
            {
                new TeslaOrderModel("RN1", "Model 3", "IN_TRANSPORT", "2026-07-15T12:00:00Z", "5YJ3VIN", true),
                new TeslaOrderModel("RN2", string.Empty, "DELIVERED", null, null, false),
            },
            Localizer,
            Now);

        Assert.True(display.HasOrders);
        Assert.Equal("Order ID", display.OrderIdLabel);
        Assert.Equal("VIN", display.VinLabel);
        Assert.Equal("Delivery Date", display.DeliveryDateLabel);
        Assert.Equal("Upgradable", display.UpgradableLabel);

        var first = display.Cards[0];
        Assert.Equal("Model 3", first.ModelText);
        Assert.Equal("In Transport", first.StatusLabel);
        Assert.Equal(StatusKind.Info, first.StatusKind);
        Assert.Equal("RN1", first.OrderIdValue);
        Assert.True(first.ShowVin);
        Assert.Equal("5YJ3VIN", first.VinValue);
        Assert.True(first.ShowDeliveryDate);
        Assert.Contains("2026", first.DeliveryDateValue);
        Assert.True(first.ShowUpgradable);

        var second = display.Cards[1];
        Assert.Equal("\u2014", second.ModelText);          // empty model -> em-dash
        Assert.Equal("Delivered", second.StatusLabel);
        Assert.Equal(StatusKind.Success, second.StatusKind);
        Assert.False(second.ShowVin);
        Assert.False(second.ShowDeliveryDate);
        Assert.False(second.ShowUpgradable);
    }

    [Fact]
    public void Project_cards_carry_descriptive_non_empty_automation_names()
    {
        var display = ActiveOrdersProjection.Project(
            new[]
            {
                new TeslaOrderModel("RN1", "Model 3", "IN_TRANSPORT", "2026-07-15T12:00:00Z", "5YJ3VIN", true),
                new TeslaOrderModel("RN2", "Model S", "DELIVERED", null, null, false),
            },
            Localizer,
            Now);

        Assert.Contains("Model 3", display.Cards[0].AutomationName);
        Assert.Contains("In Transport", display.Cards[0].AutomationName);
        Assert.Contains("Order ID RN1", display.Cards[0].AutomationName);
        Assert.Contains("VIN 5YJ3VIN", display.Cards[0].AutomationName);
        Assert.Contains("Upgradable", display.Cards[0].AutomationName);

        Assert.Equal("Model S. Delivered. Order ID RN2", display.Cards[1].AutomationName);  // no optional clauses
        Assert.All(display.Cards, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
    }

    [Fact]
    public void Project_empty_order_list_has_no_cards()
    {
        var display = ActiveOrdersProjection.Project(Array.Empty<TeslaOrderModel>(), Localizer, Now);
        Assert.False(display.HasOrders);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Project_unparseable_delivery_date_still_shows_the_cell_with_em_dash()
    {
        var display = ActiveOrdersProjection.Project(
            new[] { new TeslaOrderModel("RN1", "Model 3", "PENDING", "not-a-date", null, false) },
            Localizer,
            Now);

        Assert.True(display.Cards[0].ShowDeliveryDate);
        Assert.Equal("\u2014", display.Cards[0].DeliveryDateValue);
    }

    [Fact]
    public void LastSyncedLabel_is_null_without_a_timestamp_and_prefixed_with_one()
    {
        Assert.Null(ActiveOrdersProjection.LastSyncedLabel(null, Localizer, Now));

        var label = ActiveOrdersProjection.LastSyncedLabel(
            new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), Localizer, Now);
        Assert.NotNull(label);
        Assert.StartsWith("Synced ", label);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, ActiveOrdersResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, ActiveOrdersResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var error = ActiveOrdersResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, error.Status);
        Assert.Equal("boom", error.Error!.Message);
    }

    [Fact]
    public void Mapper_loaded_carries_snapshot_even_when_orders_empty()
    {
        using var doc = JsonDocument.Parse("""{"orders":[],"fetched_at":"2026-06-06T11:55:00Z"}""");
        var mapped = ActiveOrdersResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Empty(mapped.Value!.Orders);
        Assert.Equal("2026-06-06T11:55:00Z", mapped.Value.FetchedAt);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag_and_offline_carries_orders()
    {
        using var doc = JsonDocument.Parse("""{"orders":[{"order_id":"A"}],"fetched_at":"2026-06-06T11:50:00Z"}""");

        var cached = ActiveOrdersResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!.Orders);

        var offline = ActiveOrdersResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(
                doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Orders);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_orders_and_targets_the_generated_read_operation()
    {
        using var doc = JsonDocument.Parse(
            """{"orders":[{"order_id":"A","model":"Model 3"}],"fetched_at":"2026-06-06T11:55:00Z"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamOrdersAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!.Orders);
        Assert.Equal("get_api_v1_tesla_user_orders", client.Requests[^1].OperationId);
        Assert.Equal(ActiveOrdersSource.OrdersOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Query);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamOrdersAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_refresh_targets_the_generated_write_operation_and_succeeds()
    {
        using var doc = JsonDocument.Parse("""{"orders":[],"fetched_at":"2026-06-06T11:55:00Z"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var outcome = await source.RefreshAsync();

        Assert.True(outcome.Succeeded);
        Assert.Null(outcome.Error);
        Assert.Equal("post_api_v1_tesla_user_orders_refresh", client.Requests[^1].OperationId);
        Assert.Equal(ActiveOrdersSource.RefreshOperation, client.Requests[^1].OperationId);
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
        using var vm = new ActiveOrdersSectionViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(ActiveOrdersState.Loading, vm.State);
        Assert.False(vm.Display.HasOrders);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_one_card_per_order_with_synced_caption()
    {
        using var vm = NewViewModel(Loaded(Snapshot(
            "2026-06-06T11:58:00Z",
            new TeslaOrderModel("A", "Model 3", "IN_TRANSPORT", null, null, false),
            new TeslaOrderModel("B", "Model Y", "DELIVERED", null, null, false))));

        await vm.LoadAsync();

        Assert.Equal(ActiveOrdersState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Cards.Count);
        Assert.NotNull(vm.LastSyncedLabel);
        Assert.StartsWith("Synced ", vm.LastSyncedLabel);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_with_fetch_time_shows_no_active_orders_copy()
    {
        using var vm = NewViewModel(Loaded(Snapshot("2026-06-06T11:55:00Z")));

        await vm.LoadAsync();

        Assert.Equal(ActiveOrdersState.Empty, vm.State);
        Assert.False(vm.Display.HasOrders);
        Assert.NotNull(vm.LastSyncedLabel);
        Assert.Equal("No active orders found.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_without_fetch_time_shows_no_data_copy()
    {
        using var vm = NewViewModel(RepositoryResult<OrdersSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(ActiveOrdersState.Empty, vm.State);
        Assert.Null(vm.LastSyncedLabel);
        Assert.Equal("No order data yet. Click Refresh to fetch from Tesla.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<OrdersSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(ActiveOrdersState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("boom", vm.ErrorMessage);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_cards()
    {
        using var vm = NewViewModel(RepositoryResult<OrdersSnapshot>.Cached(
            Snapshot("2026-06-06T11:50:00Z", new TeslaOrderModel("A", "Model 3", "PENDING", null, null, false)),
            Now,
            stale: true));

        await vm.LoadAsync();

        Assert.Equal(ActiveOrdersState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasOrders);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cards_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<OrdersSnapshot>.OfflineCached(
            Snapshot("2026-06-06T11:50:00Z", new TeslaOrderModel("A", "Model 3", "PENDING", null, null, false)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(ActiveOrdersState.Offline, vm.State);
        Assert.True(vm.Display.HasOrders);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    // ---- Refresh mutation (web useRefreshTeslaOrders) -------------------------------

    [Fact]
    public async Task ViewModel_refresh_success_raises_toast_and_reloads()
    {
        var source = new FakeSource(
            OrdersRefreshOutcome.Success(),
            Loaded(Snapshot("2026-06-06T11:58:00Z", new TeslaOrderModel("A", "Model 3", "DELIVERED", null, null, false))));
        using var vm = new ActiveOrdersSectionViewModel(source, Localizer, () => Now);
        var toasts = new List<ActiveOrdersToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Attempts);                       // web onSuccess invalidate+refetch
        Assert.Equal(1, source.RefreshCount);
        Assert.Equal(ActiveOrdersState.Loaded, vm.State);
        Assert.False(vm.IsRefreshing);
        Assert.False(vm.IsFetching);
        var toast = Assert.Single(toasts);
        Assert.Equal(ActiveOrdersToastKind.Success, toast.Kind);
        Assert.Equal("Orders refreshed", toast.Title);
    }

    [Fact]
    public async Task ViewModel_refresh_failure_raises_error_toast_and_leaves_cards()
    {
        var source = new FakeSource(
            OrdersRefreshOutcome.Failure(new RepositoryError(RepositoryErrorKind.Server, "kaboom")),
            Loaded(Snapshot("2026-06-06T11:58:00Z", new TeslaOrderModel("A", "Model 3", "DELIVERED", null, null, false))));
        using var vm = new ActiveOrdersSectionViewModel(source, Localizer, () => Now);
        var toasts = new List<ActiveOrdersToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(1, vm.Attempts);                       // no refetch on failure
        Assert.Equal(ActiveOrdersState.Loaded, vm.State);   // grid untouched
        Assert.True(vm.Display.HasOrders);
        Assert.False(vm.IsRefreshing);
        var toast = Assert.Single(toasts);
        Assert.Equal(ActiveOrdersToastKind.Error, toast.Kind);
        Assert.Equal("Failed to refresh orders", toast.Title);
        Assert.Equal("kaboom", toast.Description);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new ActiveOrdersSectionViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Active Orders", vm.Title);
        Assert.Equal("Vehicle orders and delivery tracking from Tesla", vm.Subtitle);
        Assert.Equal("Refresh", vm.RefreshLabel);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.Equal("No active orders found.", vm.NoOrdersMessage);
        Assert.Equal("No order data yet. Click Refresh to fetch from Tesla.", vm.NoDataMessage);
        Assert.Equal("Failed to refresh orders", vm.ErrorMessageDefault);
    }

    // ---- Toast payloads ------------------------------------------------------------

    [Fact]
    public void Toast_success_and_failure_resolve_through_the_facade()
    {
        var success = ActiveOrdersToast.Success(Localizer);
        Assert.Equal(ActiveOrdersToastKind.Success, success.Kind);
        Assert.Equal("Orders refreshed", success.Title);
        Assert.Null(success.Description);

        var failure = ActiveOrdersToast.Failure(Localizer, new RepositoryError(RepositoryErrorKind.Server, "boom"));
        Assert.Equal(ActiveOrdersToastKind.Error, failure.Kind);
        Assert.Equal("Failed to refresh orders", failure.Title);
        Assert.Equal("boom", failure.Description);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("active-orders-section", ActiveOrdersSectionRegistration.Id);
        Assert.Equal("ActiveOrdersSection", ActiveOrdersSectionRegistration.Slug);
        Assert.Equal("Active Orders", ActiveOrdersSectionRegistration.Title(Localizer));
        Assert.Equal(
            "Vehicle orders and delivery tracking from Tesla",
            ActiveOrdersSectionRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new ActiveOrdersSectionDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ActiveOrdersSection", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static ActiveOrdersSectionViewModel NewViewModel(params RepositoryResult<OrdersSnapshot>[] results) =>
        new(new FakeSource(OrdersRefreshOutcome.Success(), results), Localizer, () => Now);

    private static ActiveOrdersSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new ActiveOrdersSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<OrdersSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<OrdersSnapshot>> stream)
    {
        var list = new List<RepositoryResult<OrdersSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static RepositoryResult<OrdersSnapshot> Loaded(OrdersSnapshot snapshot) =>
        RepositoryResult<OrdersSnapshot>.Loaded(snapshot, Now);

    private static OrdersSnapshot Snapshot(string? fetchedAt, params TeslaOrderModel[] orders) =>
        new(fetchedAt, orders);

    private sealed class FakeSource : IActiveOrdersSource
    {
        private readonly IReadOnlyList<RepositoryResult<OrdersSnapshot>> _results;
        private readonly OrdersRefreshOutcome _refreshOutcome;

        public FakeSource(
            OrdersRefreshOutcome? refreshOutcome = null,
            params RepositoryResult<OrdersSnapshot>[] results)
        {
            _results = results;
            _refreshOutcome = refreshOutcome ?? OrdersRefreshOutcome.Success();
        }

        public int RefreshCount { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<OrdersSnapshot>> StreamOrdersAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<OrdersRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
        {
            RefreshCount++;
            return Task.FromResult(_refreshOutcome);
        }
    }
}
