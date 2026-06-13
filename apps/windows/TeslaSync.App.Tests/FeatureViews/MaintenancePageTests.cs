using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.VehicleSystems;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MaintenancePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicle-systems/pages/MaintenancePage.tsx), the tolerant array / envelope parsers, the
/// view-model's four-state matrix (loading / empty / error / success) plus the client-side category filter and sort
/// re-projection, and the generated-client feed's request shaping (web's two queries). The WinUI view is exercised by
/// the app build; its per-region visibility is driven entirely by the <see cref="MaintenanceDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class MaintenancePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 30 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "All Categories", "Annual Est.", "Avg / Service", "Completed", "Cost", "Date", "Description", "Due", "Due Soon",
        "EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.", "Estimated Annual Cost",
        "Maintenance", "Mileage", "No cost data available yet. Log service records to see cost estimates.",
        "No items match the selected category. Try a different filter.", "No maintenance items",
        "No maintenance items found for this vehicle.", "No service records found.", "No service records logged yet.",
        "No upcoming service projections available.", "Overdue", "Provider", "Schedule Maintenance",
        "Service Projections", "Service Records", "Service schedule, records, and upcoming maintenance", "Total Items",
        "Total Spent", "error.loadFailed", "mi",
    ];

    private static MaintenanceItem Item(
        long id = 1,
        string category = "tires",
        string name = "Tire rotation",
        string description = "Rotate tires for even wear",
        string? dueDate = null,
        double? dueMileage = null,
        double currentMileage = 12000,
        string? lastServiceDate = null,
        double? lastServiceMileage = null,
        double? intervalMonths = null,
        double? intervalMiles = null,
        string status = "good") =>
        new(id, category, name, description, dueDate, dueMileage, currentMileage, lastServiceDate, lastServiceMileage, intervalMonths, intervalMiles, status);

    private static MaintenanceServiceRecord Record(
        long id = 1,
        string date = "2026-06-01T10:00:00Z",
        string description = "Tire rotation",
        double mileage = 12000,
        double cost = 80,
        string provider = "Tesla Service") =>
        new(id, date, description, mileage, cost, provider);

    private static MaintenanceModel Model(
        IReadOnlyList<MaintenanceItem>? items = null,
        IReadOnlyList<MaintenanceServiceRecord>? records = null,
        string categoryFilter = MaintenanceProjection.AllCategories,
        string sortBy = MaintenanceProjection.DefaultSort,
        bool loading = false,
        bool hasError = false,
        string? errorDetail = null) => new(
        HasData: true,
        Items: items ?? Array.Empty<MaintenanceItem>(),
        Records: records ?? Array.Empty<MaintenanceServiceRecord>(),
        CategoryFilter: categoryFilter,
        SortBy: sortBy,
        Loading: loading,
        HasError: hasError,
        ErrorDetail: errorDetail);

    // ---- i18n key coverage (all 30 manifest strings, every state) -----------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        _ = MaintenanceProjection.Project(Model(items: [Item()], records: [Record()]), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        _ = MaintenanceProjection.Project(MaintenanceModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = MaintenanceProjection.Project(MaintenanceModel.Initial, Localizer, Now);

        Assert.Equal(MaintenanceState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_items()
    {
        var display = MaintenanceProjection.Project(Model(items: []), Localizer, Now);

        Assert.Equal(MaintenanceState.Empty, display.State);
        Assert.True(display.ShowContent);    // summary cards + panels still render
        Assert.True(display.ShowItemsEmpty); // the grid shows an empty state, never a blank box
        Assert.False(display.ShowItems);
        Assert.Equal("No maintenance items", display.ItemsEmptyTitle);
        Assert.Equal("No maintenance items found for this vehicle.", display.ItemsEmptyMessage);
    }

    [Fact]
    public void State_error_shows_failure_banner_above_content()
    {
        var display = MaintenanceProjection.Project(Model(items: [], hasError: true, errorDetail: "network down"), Localizer, Now);

        Assert.Equal(MaintenanceState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.True(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
    }

    [Fact]
    public void State_success_when_items_present()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()]), Localizer, Now);

        Assert.Equal(MaintenanceState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowItems);
        Assert.False(display.ShowItemsEmpty);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Empty_items_message_switches_when_a_category_filter_is_active()
    {
        var items = new[] { Item(id: 1, category: "tires"), Item(id: 2, category: "brakes") };
        var display = MaintenanceProjection.Project(Model(items: items, categoryFilter: "fluids"), Localizer, Now);

        Assert.False(display.ShowItems);
        Assert.Equal("No items match the selected category. Try a different filter.", display.ItemsEmptyMessage);
    }

    // ---- Panel: GlassPanel1 summary cards ------------------------------------------

    [Fact]
    public void Summary_cards_count_by_raw_status()
    {
        var items = new[]
        {
            Item(id: 1, status: "good"),
            Item(id: 2, status: "soon"),
            Item(id: 3, status: "overdue"),
            Item(id: 4, status: "overdue"),
            Item(id: 5, status: "completed"),
        };
        var display = MaintenanceProjection.Project(Model(items: items), Localizer, Now);

        Assert.Collection(
            display.SummaryCards,
            c => AssertMetric(c, "Total Items", "5", "TsColorInfoBrush"),
            c => AssertMetric(c, "Due Soon", "1", "TsColorWarningBrush"),
            c => AssertMetric(c, "Overdue", "2", "TsColorDangerBrush"),
            c => AssertMetric(c, "Completed", "1", "TsColorSuccessBrush"));
    }

    // ---- Panels: GlassPanel6 + cost cards ------------------------------------------

    [Fact]
    public void Cost_cards_project_from_service_records()
    {
        var records = new[]
        {
            Record(id: 1, date: "2025-06-01T10:00:00Z", cost: 100),
            Record(id: 2, date: "2026-06-01T10:00:00Z", cost: 300),
        };
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: records), Localizer, Now);

        Assert.Equal("Estimated Annual Cost", display.CostTitle);
        Assert.True(display.ShowCostCards);
        Assert.False(display.ShowCostEmpty);

        Assert.Collection(
            display.CostCards,
            c => AssertMetric(c, "Total Spent", "$400", "TsColorSuccessBrush"),
            c => AssertMetric(c, "Annual Est.", "$400/yr", "TsColorInfoBrush"),
            c => AssertMetric(c, "Avg / Service", "$200", "TsColorAccentBrush"));
    }

    [Fact]
    public void Cost_panel_shows_empty_state_when_no_records()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: []), Localizer, Now);

        Assert.False(display.ShowCostCards);
        Assert.True(display.ShowCostEmpty);
        Assert.Equal("No cost data available yet. Log service records to see cost estimates.", display.CostEmptyMessage);
    }

    [Fact]
    public void Cost_with_a_single_record_uses_total_as_annual_and_average()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: [Record(cost: 250)]), Localizer, Now);

        Assert.Equal("$250", display.CostCards[0].Value);
        Assert.Equal("$250/yr", display.CostCards[1].Value);
        Assert.Equal("$250", display.CostCards[2].Value);
    }

    // ---- Panel: GlassPanel10 service projections -----------------------------------

    [Fact]
    public void Projections_list_overdue_first_then_by_miles_remaining()
    {
        var items = new[]
        {
            Item(id: 1, name: "Brake fluid", status: "good", intervalMiles: 25000, dueMileage: 13000, currentMileage: 12000),
            Item(id: 2, name: "Cabin filter", status: "overdue", intervalMonths: 12, currentMileage: 12000),
            Item(id: 3, name: "Tire rotation", status: "good", intervalMiles: 10000, dueMileage: 12500, currentMileage: 12000),
            Item(id: 4, name: "Done service", status: "completed", intervalMiles: 10000),
        };
        var display = MaintenanceProjection.Project(Model(items: items), Localizer, Now);

        Assert.True(display.ShowProjections);
        Assert.Collection(
            display.ProjectionRows,
            r => Assert.Equal("Cabin filter", r.Name),  // overdue floats to the top
            r => Assert.Equal("Tire rotation", r.Name),  // 500 mi remaining
            r => Assert.Equal("Brake fluid", r.Name));    // 1,000 mi remaining
    }

    [Fact]
    public void Projection_row_detail_includes_miles_remaining_and_badge()
    {
        var items = new[] { Item(id: 1, name: "Tire rotation", status: "soon", intervalMiles: 10000, dueMileage: 12500, currentMileage: 12000) };
        var display = MaintenanceProjection.Project(Model(items: items), Localizer, Now);

        var row = Assert.Single(display.ProjectionRows);
        Assert.Equal("500 mi", row.DetailText);
        Assert.True(row.HasDetail);
        Assert.Equal(StatusKind.Warning, row.BadgeStatus);
        Assert.Equal("Due Soon", row.BadgeLabel);
    }

    [Fact]
    public void Projections_empty_when_no_interval_items()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item(status: "good")]), Localizer, Now);

        Assert.False(display.ShowProjections);
        Assert.True(display.ShowProjectionsEmpty);
        Assert.Equal("No upcoming service projections available.", display.ProjectionsEmptyMessage);
    }

    // ---- Panel: GlassPanel11 service records ---------------------------------------

    [Fact]
    public void Records_panel_has_five_columns()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: [Record()]), Localizer, Now);

        Assert.True(display.ShowRecords);
        Assert.Collection(
            display.RecordColumns,
            c => AssertColumn(c, "date", "Date", numeric: false),
            c => AssertColumn(c, "description", "Description", numeric: false),
            c => AssertColumn(c, "mileage", "Mileage", numeric: true),
            c => AssertColumn(c, "cost", "Cost", numeric: true),
            c => AssertColumn(c, "provider", "Provider", numeric: false));
    }

    [Fact]
    public void Record_rows_format_every_cell()
    {
        var record = Record(id: 7, date: "2026-06-01T10:00:00Z", description: "Brake pads", mileage: 23456, cost: 149.5, provider: "Tesla");
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: [record]), Localizer, Now);

        var row = Assert.Single(display.RecordRows);
        Assert.Equal(7, row.Id);
        Assert.Equal(MaintenanceProjection.FormatDateTime("2026-06-01T10:00:00Z", Now), row.Date);
        Assert.Equal("Brake pads", row.Description);
        Assert.Equal("23,456 mi", row.Mileage);
        Assert.Equal("$149.50", row.Cost);
        Assert.Equal("Tesla", row.Provider);
    }

    [Fact]
    public void Record_provider_falls_back_to_em_dash_when_blank()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: [Record(provider: "")]), Localizer, Now);
        Assert.Equal(MaintenanceProjection.EmDash, Assert.Single(display.RecordRows).Provider);
    }

    [Fact]
    public void Records_panel_shows_empty_state_when_no_records()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()], records: []), Localizer, Now);

        Assert.False(display.ShowRecords);
        Assert.True(display.ShowRecordsEmpty);
        Assert.Equal("No service records logged yet.", display.RecordsEmptyMessage);
        Assert.Equal("No service records found.", display.RecordsEmptyTableMessage);
    }

    // ---- Toolbar: category + sort selectors ----------------------------------------

    [Fact]
    public void Category_options_lead_with_all_then_sorted_capitalized_categories()
    {
        var items = new[] { Item(id: 1, category: "tires"), Item(id: 2, category: "brakes"), Item(id: 3, category: "brakes") };
        var display = MaintenanceProjection.Project(Model(items: items, categoryFilter: "brakes"), Localizer, Now);

        Assert.Collection(
            display.CategoryOptions,
            o => AssertOption(o, "all", "All Categories", selected: false),
            o => AssertOption(o, "brakes", "Brakes", selected: true),
            o => AssertOption(o, "tires", "Tires", selected: false));
    }

    [Fact]
    public void Sort_options_offer_the_four_web_keys()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item()], sortBy: "name"), Localizer, Now);

        Assert.Collection(
            display.SortOptions,
            o => AssertOption(o, "status", "Status", selected: false),
            o => AssertOption(o, "name", "Name", selected: true),
            o => AssertOption(o, "due_date", "Due Date", selected: false),
            o => AssertOption(o, "category", "Category", selected: false));
    }

    [Fact]
    public void Items_are_filtered_by_the_selected_category()
    {
        var items = new[] { Item(id: 1, category: "tires"), Item(id: 2, category: "brakes") };
        var display = MaintenanceProjection.Project(Model(items: items, categoryFilter: "tires"), Localizer, Now);

        var card = Assert.Single(display.ItemCards);
        Assert.Equal(1, card.Id);
        Assert.Equal("Tires", card.CategoryLabel);
    }

    [Fact]
    public void Items_sort_by_status_precedence_by_default()
    {
        var items = new[]
        {
            Item(id: 1, name: "A", status: "completed"),
            Item(id: 2, name: "B", status: "overdue"),
            Item(id: 3, name: "C", status: "good"),
            Item(id: 4, name: "D", status: "soon"),
        };
        var display = MaintenanceProjection.Project(Model(items: items, sortBy: "status"), Localizer, Now);

        Assert.Collection(
            display.ItemCards,
            c => Assert.Equal(2, c.Id),  // overdue
            c => Assert.Equal(4, c.Id),  // soon
            c => Assert.Equal(3, c.Id),  // good
            c => Assert.Equal(1, c.Id)); // completed
    }

    [Fact]
    public void Items_sort_by_name_when_selected()
    {
        var items = new[] { Item(id: 1, name: "Zebra"), Item(id: 2, name: "Apple") };
        var display = MaintenanceProjection.Project(Model(items: items, sortBy: "name"), Localizer, Now);

        Assert.Equal("Apple", display.ItemCards[0].Name);
        Assert.Equal("Zebra", display.ItemCards[1].Name);
    }

    // ---- Item card derived status + progress ---------------------------------------

    [Fact]
    public void Item_card_derived_status_is_overdue_at_full_progress()
    {
        var item = Item(id: 1, status: "good", intervalMiles: 5000, lastServiceMileage: 10000, currentMileage: 15000);
        var display = MaintenanceProjection.Project(Model(items: [item]), Localizer, Now);

        var card = Assert.Single(display.ItemCards);
        Assert.Equal(StatusKind.Danger, card.StatusKind);
        Assert.Equal("Overdue", card.StatusLabel);
        Assert.True(card.ShowProgress);
        Assert.Equal(1.0, card.ProgressFraction, 3);
        Assert.Equal("100%", card.ProgressPercentText);
        Assert.Equal("TsColorDangerBrush", card.ProgressColorBrushKey);
    }

    [Fact]
    public void Item_card_completed_hides_progress_and_uses_info_badge()
    {
        var item = Item(id: 1, status: "completed", lastServiceDate: "2026-05-01T10:00:00Z", currentMileage: 12000);
        var display = MaintenanceProjection.Project(Model(items: [item]), Localizer, Now);

        var card = Assert.Single(display.ItemCards);
        Assert.False(card.ShowProgress);
        Assert.Equal(StatusKind.Info, card.StatusKind);
        Assert.Equal("Completed", card.StatusLabel);
        Assert.True(card.HasMileage);
        Assert.Equal("12,000 mi", card.MileageText);
        Assert.True(card.HasLastService);
    }

    [Fact]
    public void Item_card_due_text_prefers_due_date_then_due_mileage()
    {
        var withDate = Item(id: 1, status: "good", dueDate: "2026-07-01T10:00:00Z", intervalMiles: 10000, lastServiceMileage: 8000, currentMileage: 12000);
        var withMileage = Item(id: 2, status: "good", dueMileage: 20000, intervalMiles: 10000, lastServiceMileage: 8000, currentMileage: 12000);

        var dateCard = Assert.Single(MaintenanceProjection.Project(Model(items: [withDate]), Localizer, Now).ItemCards);
        var mileageCard = Assert.Single(MaintenanceProjection.Project(Model(items: [withMileage]), Localizer, Now).ItemCards);

        Assert.Equal($"Due: {MaintenanceProjection.FormatDate("2026-07-01T10:00:00Z", Now)}", dateCard.DueText);
        Assert.Equal("Due: 20,000 mi", mileageCard.DueText);
    }

    [Fact]
    public void Item_card_carries_category_accent_brush()
    {
        var display = MaintenanceProjection.Project(Model(items: [Item(category: "brakes")]), Localizer, Now);
        Assert.Equal("TsColorDangerBrush", Assert.Single(display.ItemCards).CategoryAccentBrushKey);
    }

    // ---- Formatting helpers --------------------------------------------------------

    [Theory]
    [InlineData(0, "0")]
    [InlineData(5, "5")]
    [InlineData(12000, "12,000")]
    [InlineData(1234567, "1,234,567")]
    public void FormatCount_matches_web(double value, string expected) =>
        Assert.Equal(expected, MaintenanceProjection.FormatCount(value));

    [Theory]
    [InlineData(400, 0, "$400")]
    [InlineData(1234.5, 0, "$1,235")]
    [InlineData(149.5, 2, "$149.50")]
    [InlineData(0, 0, "$0")]
    public void FormatCurrency_matches_web(double value, int decimals, string expected) =>
        Assert.Equal(expected, MaintenanceProjection.FormatCurrency(value, decimals));

    [Fact]
    public void FormatDate_returns_em_dash_for_unparseable_input() =>
        Assert.Equal(MaintenanceProjection.EmDash, MaintenanceProjection.FormatDate("not-a-date", Now));

    [Theory]
    [InlineData("good", 5000.0, 10000.0, 15000.0, 100.0)] // elapsed == interval -> 100
    [InlineData("good", 10000.0, 10000.0, 12000.0, 20.0)] // 2000/10000 -> 20
    public void ComputeProgress_uses_the_mile_interval(string status, double intervalMiles, double lastMileage, double current, double expected)
    {
        var item = Item(status: status, intervalMiles: intervalMiles, lastServiceMileage: lastMileage, currentMileage: current);
        Assert.Equal(expected, MaintenanceProjection.ComputeProgress(item, Now), 3);
    }

    [Fact]
    public void ComputeProgress_falls_back_to_due_mileage_ratio()
    {
        var item = Item(status: "good", dueMileage: 10000, currentMileage: 8000);
        Assert.Equal(80.0, MaintenanceProjection.ComputeProgress(item, Now), 3);
    }

    [Fact]
    public void ComputeProgress_is_zero_without_any_target()
    {
        var item = Item(status: "good", currentMileage: 12000);
        Assert.Equal(0.0, MaintenanceProjection.ComputeProgress(item, Now), 3);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Items_parse_from_a_bare_array()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":1,\"category\":\"tires\",\"name\":\"Rotation\",\"description\":\"d\",\"current_mileage\":12000,\"status\":\"soon\"}]");
        var items = MaintenanceSnapshot.ItemsFromJson(doc.RootElement);

        var item = Assert.Single(items);
        Assert.Equal(1, item.Id);
        Assert.Equal("tires", item.Category);
        Assert.Equal("soon", item.Status);
        Assert.Equal(12000, item.CurrentMileage);
    }

    [Fact]
    public void Records_parse_from_a_data_envelope()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":[{\"id\":3,\"date\":\"2026-06-01T10:00:00Z\",\"description\":\"svc\",\"mileage\":1000,\"cost\":50,\"provider\":\"Tesla\"}]}");
        var records = MaintenanceSnapshot.RecordsFromJson(doc.RootElement);

        var record = Assert.Single(records);
        Assert.Equal(3, record.Id);
        Assert.Equal(50, record.Cost);
        Assert.Equal("Tesla", record.Provider);
    }

    [Fact]
    public void Item_parse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("[{\"id\":9}]");
        var item = Assert.Single(MaintenanceSnapshot.ItemsFromJson(doc.RootElement));

        Assert.Equal(9, item.Id);
        Assert.Equal(string.Empty, item.Category);
        Assert.Null(item.DueMileage);
        Assert.Equal("good", item.Status);
    }

    [Fact]
    public void Array_parse_treats_non_array_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Empty(MaintenanceSnapshot.ItemsFromJson(doc.RootElement));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_items_into_the_success_state()
    {
        var feed = new FakeFeed(new MaintenanceSnapshot(true, [Item()], [Record()]));
        using var vm = new MaintenancePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MaintenanceState.Success, vm.State);
        Assert.True(vm.Display.ShowItems);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new MaintenancePageViewModel(EmptyMaintenanceFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MaintenanceState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.True(vm.Display.ShowItemsEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new MaintenancePageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MaintenanceState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_api_exception_is_the_error_state()
    {
        using var vm = new MaintenancePageViewModel(new ApiThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MaintenanceState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new MaintenanceSnapshot(true, [Item()], [Record()]));
        using var vm = new MaintenancePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_set_category_filters_without_refetching()
    {
        var items = new[] { Item(id: 1, category: "tires"), Item(id: 2, category: "brakes") };
        var feed = new FakeFeed(new MaintenanceSnapshot(true, items, Array.Empty<MaintenanceServiceRecord>()));
        using var vm = new MaintenancePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        vm.SetCategoryFilter("brakes");

        Assert.Equal("brakes", vm.CategoryFilter);
        Assert.Equal(1, feed.FetchCount); // no refetch
        Assert.Equal(2, Assert.Single(vm.Display.ItemCards).Id);
    }

    [Fact]
    public async Task ViewModel_set_sort_reprojects_without_refetching()
    {
        var items = new[] { Item(id: 1, name: "Zebra"), Item(id: 2, name: "Apple") };
        var feed = new FakeFeed(new MaintenanceSnapshot(true, items, Array.Empty<MaintenanceServiceRecord>()));
        using var vm = new MaintenancePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        vm.SetSort("name");

        Assert.Equal("name", vm.SortBy);
        Assert.Equal(1, feed.FetchCount);
        Assert.Equal("Apple", vm.Display.ItemCards[0].Name);
    }

    [Fact]
    public async Task ViewModel_set_sort_is_a_no_op_for_unknown_keys()
    {
        var feed = new FakeFeed(new MaintenanceSnapshot(true, [Item()], Array.Empty<MaintenanceServiceRecord>()));
        using var vm = new MaintenancePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        vm.SetSort("unknown-key");

        Assert.Equal(MaintenanceProjection.DefaultSort, vm.SortBy);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_sends_both_maintenance_operations()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"category\":\"tires\",\"name\":\"Rotation\",\"status\":\"good\"}]"));
        api.ReturnsValue(Json("[{\"id\":2,\"date\":\"2026-06-01T10:00:00Z\",\"cost\":80}]"));
        var feed = new MaintenanceClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Single(snapshot.Items);
        Assert.Single(snapshot.Records);
        Assert.Collection(
            api.Requests,
            r => Assert.Equal("get_api_v1_maintenance", r.OperationId),
            r => Assert.Equal("get_api_v1_maintenance_records", r.OperationId));
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("server error", 500));
        var feed = new MaintenanceClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
        Assert.Equal(500, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new MaintenanceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MaintenancePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("Maintenance", MaintenanceRegistration.RouteName);
        Assert.Equal("get_api_v1_maintenance", MaintenanceRegistration.ItemsOperation);
        Assert.Equal("get_api_v1_maintenance_records", MaintenanceRegistration.RecordsOperation);
        Assert.Equal("Maintenance", MaintenanceRegistration.Title(Localizer));
    }

    // ---- Helpers -------------------------------------------------------------------

    private static void AssertMetric(MaintenanceMetric metric, string label, string value, string accentBrushKey)
    {
        Assert.Equal(label, metric.Label);
        Assert.Equal(value, metric.Value);
        Assert.Equal(accentBrushKey, metric.AccentBrushKey);
    }

    private static void AssertColumn(MaintenanceColumn column, string key, string header, bool numeric)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
        Assert.Equal(numeric, column.IsNumeric);
    }

    private static void AssertOption(MaintenanceOption option, string value, string label, bool selected)
    {
        Assert.Equal(value, option.Value);
        Assert.Equal(label, option.Label);
        Assert.Equal(selected, option.IsSelected);
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
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

    private sealed class FakeFeed : IMaintenanceFeed
    {
        private readonly MaintenanceSnapshot _snapshot;

        public FakeFeed(MaintenanceSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public Task<MaintenanceSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : IMaintenanceFeed
    {
        public Task<MaintenanceSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class ApiThrowingFeed : IMaintenanceFeed
    {
        public Task<MaintenanceSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("maintenance fetch failed", 500);
    }
}
