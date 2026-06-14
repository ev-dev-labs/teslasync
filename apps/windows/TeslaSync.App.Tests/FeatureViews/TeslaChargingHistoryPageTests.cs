using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TeslaChargingHistoryPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/charging/pages/TeslaChargingHistoryPage.tsx), the tolerant parsers (incl. the platform
/// <c>{data:…}</c> envelope), the monthly-spending aggregation, the client-side date-range + location-search filters,
/// the invoice-URL builder, the view-model's four-state matrix (loading / empty / error / success), and the
/// generated-client feed's request shaping (web <c>useTeslaChargingHistory</c> / <c>useVehicles</c> /
/// <c>useRefreshTeslaChargingHistory</c>). The WinUI view is exercised by the app build; its per-region visibility is
/// driven entirely by the <see cref="TeslaChargingHistoryDisplay"/> flags asserted here.
/// </summary>
public sealed class TeslaChargingHistoryPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 31 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "charging.invoice", "table.bulkActions.exportCsv", "tesla_charging.allVehicles",
        "tesla_charging.col.cost_decimal", "tesla_charging.col.date", "tesla_charging.col.duration",
        "tesla_charging.col.energy", "tesla_charging.col.invoice", "tesla_charging.col.location",
        "tesla_charging.col.month", "tesla_charging.col.rate", "tesla_charging.col.total",
        "tesla_charging.downloadInvoice", "tesla_charging.filterLabel.search", "tesla_charging.lastSync",
        "tesla_charging.monthlySpending", "tesla_charging.monthlySpending.aria", "tesla_charging.noChartData",
        "tesla_charging.noData", "tesla_charging.noMatches", "tesla_charging.refresh",
        "tesla_charging.refreshing", "tesla_charging.searchPlaceholder", // parity:allow i18n key 'searchPlaceholder' is a verbatim web key, not a stub
        "tesla_charging.selectVehicle", "tesla_charging.sessions", "tesla_charging.stats.avgCost",
        "tesla_charging.stats.energy", "tesla_charging.stats.sessions", "tesla_charging.stats.spend",
        "tesla_charging.subtitle", "tesla_charging.title",
    ];

    private static TeslaChargingHistoryEntry SampleEntry(
        long id = 1,
        string? vin = "5YJ3E1EA1KF000123",
        string? site = "Tesla Supercharger - Mountain View",
        string? start = "2026-03-15T10:30:00Z",
        string? stop = "2026-03-15T11:31:00Z",
        double? usageWh = 50000,
        double? totalDue = 12.5,
        double? rateBase = 0.25,
        string? pricingType = "kWh",
        bool hasInvoice = true,
        string? invoiceId = "inv-abc",
        string? currency = "USD",
        string? fetched = "2026-06-12T09:00:00Z") =>
        new(id, vin, site, start, stop, currency, pricingType, rateBase, usageWh, totalDue, hasInvoice, invoiceId, fetched);

    private static TeslaChargingHistorySummary SampleSummary(
        long sessions = 3,
        double? wh = 50000,
        double? spend = 123.45,
        double? avg = 0.234) =>
        new(sessions, wh, spend, avg);

    private static TeslaChargingHistoryModel SuccessModel(
        IReadOnlyList<TeslaChargingHistoryEntry>? entries = null,
        TeslaChargingHistorySummary? summary = null,
        IReadOnlyList<TeslaChargingVehicle>? vehicles = null,
        string selectedVin = "",
        string searchQuery = "",
        DateOnly? rangeStart = null,
        DateOnly? rangeEnd = null,
        bool refreshPending = false) => new(
        HasData: true,
        Entries: entries ?? [SampleEntry()],
        Summary: summary ?? SampleSummary(),
        Vehicles: vehicles ?? Array.Empty<TeslaChargingVehicle>(),
        SelectedVin: selectedVin,
        SearchQuery: searchQuery,
        RangeStart: rangeStart,
        RangeEnd: rangeEnd,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        RefreshPending: refreshPending,
        Units: UnitPref.Metric,
        CurrencySymbol: "$");

    // ---- i18n key coverage (all 31 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = TeslaChargingHistoryProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state; visibility is gated separately.
        _ = TeslaChargingHistoryProjection.Project(TeslaChargingHistoryModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = TeslaChargingHistoryProjection.Project(TeslaChargingHistoryModel.Initial, Localizer, Now);

        Assert.Equal(TeslaChargingHistoryState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_entries()
    {
        var model = SuccessModel(entries: [], summary: TeslaChargingHistorySummary.Empty);
        var display = TeslaChargingHistoryProjection.Project(model, Localizer, Now);

        Assert.Equal(TeslaChargingHistoryState.Empty, display.State);
        Assert.True(display.ShowContent);     // stat cards + controls still render
        Assert.False(display.ShowTable);      // the table area shows the no-data empty state, never a blank box
        Assert.False(display.ShowChart);
        Assert.False(display.ShowFilterBar);  // no search bar when there is nothing to search
        Assert.True(display.ShowNoData);
        Assert.Equal("No Tesla charging history yet. Click \"Refresh from Tesla\" to import your Supercharger sessions.", display.NoDataMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = TeslaChargingHistoryModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = TeslaChargingHistoryProjection.Project(model, Localizer, Now);

        Assert.Equal(TeslaChargingHistoryState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_entries_present()
    {
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(TeslaChargingHistoryState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowTable);
        Assert.True(display.ShowFilterBar);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Panels: summary stat cards (Total-Sessions … Avg-Cost-kWh) ----------------

    [Fact]
    public void Stat_cards_project_labels_and_values()
    {
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("Total Sessions", display.SessionsStatLabel);
        Assert.Equal("3", display.SessionsStatValue);

        Assert.Equal("Total Energy", display.EnergyStatLabel);
        Assert.Equal("50,000.0 Wh", display.EnergyStatValue);   // SI Wh at the metric display preference

        Assert.Equal("Total Spend", display.SpendStatLabel);
        Assert.Equal("$123.45", display.SpendStatValue);

        Assert.Equal("Avg Cost/kWh", display.AvgCostStatLabel);
        Assert.Equal("$0.234", display.AvgCostStatValue);
    }

    [Fact]
    public void Stat_card_values_fall_back_to_em_dash_when_null()
    {
        var summary = new TeslaChargingHistorySummary(0, null, null, null);
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(summary: summary), Localizer, Now);

        Assert.Equal("0", display.SessionsStatValue);
        Assert.Equal("\u2014", display.EnergyStatValue);
        Assert.Equal("\u2014", display.SpendStatValue);
        Assert.Equal("\u2014", display.AvgCostStatValue);
    }

    [Fact]
    public void Stat_cards_read_the_api_summary_not_the_filtered_rows()
    {
        // web parity: the summary cards bind to response.summary, NOT the range-filtered entries.
        var start = new DateOnly(2030, 1, 1);
        var end = new DateOnly(2030, 12, 31);
        var display = TeslaChargingHistoryProjection.Project(
            SuccessModel(rangeStart: start, rangeEnd: end), Localizer, Now);

        Assert.Equal("3", display.SessionsStatValue);     // still the API total even though the range excludes every row
        Assert.False(display.ShowTable);
        Assert.True(display.ShowNoData);
    }

    // ---- Chart: Monthly-Spending (ChartContainer + BarChart) -----------------------

    [Fact]
    public void Monthly_spending_aggregates_by_month_and_sorts_ascending()
    {
        var entries = new[]
        {
            SampleEntry(id: 1, start: "2026-04-02T08:00:00Z", totalDue: 5),
            SampleEntry(id: 2, start: "2026-03-15T10:00:00Z", totalDue: 10),
            SampleEntry(id: 3, start: "2026-03-20T12:00:00Z", totalDue: 7),
        };

        var monthly = TeslaChargingHistoryProjection.BuildMonthlySpending(entries);

        Assert.Collection(
            monthly,
            m => { Assert.Equal("2026-03", m.Month); Assert.Equal(17, m.Total); },
            m => { Assert.Equal("2026-04", m.Month); Assert.Equal(5, m.Total); });
    }

    [Fact]
    public void Chart_is_ready_with_one_series_when_entries_have_spend()
    {
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);

        Assert.True(display.ShowChart);
        var series = Assert.Single(display.ChartSeries);
        Assert.Equal("Total ($)", series.Name);            // accessible-table value column header (col.total)
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.NotEmpty(series.Points);
        Assert.Equal("Month", display.MonthColumnLabel);   // accessible-table X column header (col.month)
        Assert.Equal("Monthly Tesla charging spending bar chart", display.MonthlySpendingAria);
        Assert.Equal("Monthly Spending", display.MonthlySpendingTitle);
    }

    [Fact]
    public void Chart_is_empty_with_no_spend_data()
    {
        var entry = SampleEntry(start: null, totalDue: null);
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(entries: [entry]), Localizer, Now);

        Assert.False(display.ShowChart);
        Assert.Empty(display.ChartSeries);
        Assert.Equal("No spending data yet. Click \"Refresh from Tesla\" to sync.", display.NoChartDataMessage);
    }

    // ---- Panel: GlassPanel6 (session table) ----------------------------------------

    [Fact]
    public void Table_has_the_seven_web_columns()
    {
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Collection(
            display.Columns,
            c => AssertColumn(c, "date", "Date", numeric: false),
            c => AssertColumn(c, "location", "Location", numeric: false),
            c => AssertColumn(c, "duration", "Duration", numeric: false),
            c => AssertColumn(c, "energy", "Energy", numeric: true),
            c => AssertColumn(c, "cost", "Cost", numeric: true),
            c => AssertColumn(c, "rate", "Rate", numeric: false),
            c => AssertColumn(c, "invoice", "Invoice", numeric: false));
    }

    [Fact]
    public void Table_rows_format_every_cell()
    {
        var entry = SampleEntry(
            id: 7, site: "Supercharger A", start: "2026-03-15T10:30:00Z", stop: "2026-03-15T11:31:00Z",
            usageWh: 50000, totalDue: 12.5, rateBase: 0.25, pricingType: "kWh", hasInvoice: true, invoiceId: "inv-7");
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(entries: [entry]), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal(7, row.SessionId);
        Assert.Equal("Supercharger A", row.Location);
        Assert.Equal("50,000.0 Wh", row.Energy);
        Assert.Equal("1h 1m", row.Duration);
        Assert.Equal("$12.50", row.Cost);
        Assert.Equal("0.250/kWh", row.Rate);
        Assert.Equal("Invoice", row.Invoice);
        Assert.True(row.HasInvoice);
        Assert.Equal("/api/v1/tesla/charging/invoice/inv-7", row.InvoiceUrl);
        Assert.NotEqual("\u2014", row.Date);
    }

    [Fact]
    public void Table_row_nullable_cells_fall_back_to_em_dash()
    {
        var entry = new TeslaChargingHistoryEntry(9, null, null, "2026-03-15T10:30:00Z", null, null, null, null, null, null, false, null, null);
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(entries: [entry]), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("\u2014", row.Location);
        Assert.Equal("\u2014", row.Duration);
        Assert.Equal("\u2014", row.Energy);
        Assert.Equal("\u2014", row.Cost);
        Assert.Equal("\u2014", row.Rate);
        Assert.Equal("\u2014", row.Invoice);
        Assert.False(row.HasInvoice);
        Assert.Equal(string.Empty, row.InvoiceUrl);
    }

    [Fact]
    public void Table_rows_sort_by_date_descending()
    {
        var entries = new[]
        {
            SampleEntry(id: 1, start: "2026-03-01T08:00:00Z"),
            SampleEntry(id: 2, start: "2026-05-01T08:00:00Z"),
            SampleEntry(id: 3, start: "2026-04-01T08:00:00Z"),
        };
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(entries: entries), Localizer, Now);

        Assert.Collection(
            display.Rows,
            r => Assert.Equal(2, r.SessionId),
            r => Assert.Equal(3, r.SessionId),
            r => Assert.Equal(1, r.SessionId));
    }

    [Fact]
    public void Invoice_cell_is_em_dash_when_no_downloadable_invoice()
    {
        var entry = SampleEntry(hasInvoice: false, invoiceId: null);
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(entries: [entry]), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("\u2014", row.Invoice);
        Assert.False(row.HasInvoice);
    }

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData("2026-03-15T11:31:00Z", "1h 1m")]
    [InlineData("2026-03-15T11:00:00Z", "30m")]
    public void Duration_formats_match_web(string? stop, string expected)
    {
        long? minutes = TeslaChargingHistoryProjection.DurationMinutes("2026-03-15T10:30:00Z", stop);
        Assert.Equal(expected, TeslaChargingHistoryProjection.FormatDurationMinutes(minutes));
    }

    // ---- Client-side filters (web range + search) ----------------------------------

    [Fact]
    public void Range_filter_narrows_the_chart_and_table_but_not_the_summary()
    {
        var entries = new[]
        {
            SampleEntry(id: 1, start: "2026-03-15T10:00:00Z", totalDue: 10),
            SampleEntry(id: 2, start: "2026-04-15T10:00:00Z", totalDue: 20),
        };
        var display = TeslaChargingHistoryProjection.Project(
            SuccessModel(entries: entries, rangeStart: new DateOnly(2026, 4, 1), rangeEnd: new DateOnly(2026, 4, 30)),
            Localizer,
            Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal(2, row.SessionId);
        var month = Assert.Single(display.MonthlySpends);
        Assert.Equal("2026-04", month.Month);
        Assert.Equal(20, month.Total);
        Assert.Equal("3", display.SessionsStatValue);   // summary is unaffected by the range filter
    }

    [Fact]
    public void Search_filter_matches_location_case_insensitively()
    {
        var entries = new[]
        {
            SampleEntry(id: 1, site: "Mountain View Supercharger"),
            SampleEntry(id: 2, site: "Gilroy Supercharger"),
        };
        var display = TeslaChargingHistoryProjection.Project(
            SuccessModel(entries: entries, searchQuery: "gilroy"), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal(2, row.SessionId);
        Assert.True(display.ShowTable);
        Assert.True(display.ShowSearchChip);
        var chip = Assert.Single(display.FilterChips);
        Assert.Equal("q", chip.Key);
        Assert.Equal("Search", chip.Label);
        Assert.Equal("gilroy", chip.Value);
    }

    [Fact]
    public void Search_with_no_matches_shows_the_no_matches_empty_state()
    {
        var display = TeslaChargingHistoryProjection.Project(
            SuccessModel(searchQuery: "nonexistent-location"), Localizer, Now);

        Assert.False(display.ShowTable);
        Assert.True(display.ShowNoMatches);
        Assert.False(display.ShowNoData);
        Assert.True(display.ShowFilterBar);   // the search bar stays visible so the user can clear the query
        Assert.Equal("No sessions match your search.", display.NoMatchesMessage);
        Assert.Equal(TeslaChargingHistoryState.Success, display.State);   // the page still has data, just filtered out
    }

    [Fact]
    public void No_search_chip_when_query_is_empty()
    {
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);

        Assert.False(display.ShowSearchChip);
        Assert.Empty(display.FilterChips);
    }

    // ---- Controls bar (vehicle selector + refresh + last-synced) -------------------

    [Fact]
    public void Vehicle_options_lead_with_all_vehicles_then_each_vehicle()
    {
        var vehicles = new[]
        {
            new TeslaChargingVehicle("5YJ3E1EA1KF000123", "Model 3"),
            new TeslaChargingVehicle("7SAYGDEE9PF000456", "Model Y"),
        };
        var display = TeslaChargingHistoryProjection.Project(
            SuccessModel(vehicles: vehicles, selectedVin: "7SAYGDEE9PF000456"), Localizer, Now);

        Assert.Collection(
            display.VehicleOptions,
            o => { Assert.Equal("", o.Value); Assert.Equal("All Vehicles", o.Label); Assert.False(o.IsSelected); },
            o => { Assert.Equal("5YJ3E1EA1KF000123", o.Value); Assert.Equal("Model 3 (000123)", o.Label); Assert.False(o.IsSelected); },
            o => { Assert.Equal("7SAYGDEE9PF000456", o.Value); Assert.Equal("Model Y (000456)", o.Label); Assert.True(o.IsSelected); });
    }

    [Fact]
    public void Refresh_button_label_toggles_with_the_pending_flag()
    {
        var idle = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);
        var pending = TeslaChargingHistoryProjection.Project(SuccessModel(refreshPending: true), Localizer, Now);

        Assert.Equal("Refresh from Tesla", idle.RefreshButtonLabel);
        Assert.False(idle.RefreshPending);
        Assert.Equal("Syncing...", pending.RefreshButtonLabel);
        Assert.True(pending.RefreshPending);
    }

    [Fact]
    public void Last_sync_caption_shows_when_an_entry_carries_a_fetched_at()
    {
        var withFetch = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);
        var withoutFetch = TeslaChargingHistoryProjection.Project(
            SuccessModel(entries: [SampleEntry(fetched: null)]), Localizer, Now);

        Assert.True(withFetch.ShowLastSync);
        Assert.StartsWith("Last synced:", withFetch.LastSyncText, StringComparison.Ordinal);
        Assert.False(withoutFetch.ShowLastSync);
    }

    [Fact]
    public void Select_vehicle_label_resolves()
    {
        var display = TeslaChargingHistoryProjection.Project(SuccessModel(), Localizer, Now);
        Assert.Equal("Select vehicle", display.SelectVehicleLabel);
        Assert.Equal("Tesla Charging History", display.Title);
        Assert.StartsWith("Supercharger", display.Subtitle, StringComparison.Ordinal);
    }

    // ---- Invoice URL builder (web getTeslaChargingInvoiceURL) ----------------------

    [Fact]
    public void Invoice_url_builds_the_download_path()
    {
        Assert.Equal("/api/v1/tesla/charging/invoice/abc123", TeslaChargingHistoryRegistration.InvoiceUrl("abc123"));
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_unwraps_the_data_envelope_and_reads_entries_and_summary()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"entries\":[{\"session_id\":42,\"vin\":\"VIN1\",\"site_location_name\":\"Site\"," +
            "\"charge_start_datetime\":\"2026-03-01T00:00:00Z\",\"charge_stop_datetime\":\"2026-03-01T01:00:00Z\"," +
            "\"usage_wh\":12000,\"total_due\":8.5,\"rate_base\":0.2,\"pricing_type\":\"kWh\",\"currency_code\":\"USD\"," +
            "\"has_invoice\":true,\"invoice_content_id\":\"c-1\",\"fetched_at\":\"2026-03-01T02:00:00Z\"}]," +
            "\"summary\":{\"total_sessions\":1,\"total_wh\":12000,\"total_spend\":8.5,\"avg_cost_per_kwh\":0.2}}}");

        var snapshot = TeslaChargingHistorySnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var entry = Assert.Single(snapshot.Entries);
        Assert.Equal(42, entry.SessionId);
        Assert.Equal("VIN1", entry.Vin);
        Assert.Equal("Site", entry.SiteLocationName);
        Assert.Equal(12000, entry.UsageWh);
        Assert.True(entry.HasInvoice);
        Assert.Equal("c-1", entry.InvoiceContentId);
        Assert.Equal(1, snapshot.Summary.TotalSessions);
        Assert.Equal(8.5, snapshot.Summary.TotalSpend);
    }

    [Fact]
    public void Snapshot_parse_reads_a_bare_unwrapped_object()
    {
        using var doc = JsonDocument.Parse("{\"entries\":[],\"summary\":{\"total_sessions\":0}}");
        var snapshot = TeslaChargingHistorySnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Empty(snapshot.Entries);
        Assert.Equal(0, snapshot.Summary.TotalSessions);
    }

    [Fact]
    public void Snapshot_parse_is_tolerant_of_missing_summary_and_partial_rows()
    {
        using var doc = JsonDocument.Parse("{\"data\":{\"entries\":[{\"session_id\":5}]}}");
        var snapshot = TeslaChargingHistorySnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var entry = Assert.Single(snapshot.Entries);
        Assert.Equal(5, entry.SessionId);
        Assert.Null(entry.Vin);
        Assert.Null(entry.UsageWh);
        Assert.False(entry.HasInvoice);
        Assert.Equal(TeslaChargingHistorySummary.Empty, snapshot.Summary);
    }

    [Fact]
    public void Snapshot_parse_treats_non_object_as_no_data()
    {
        using var notObject = JsonDocument.Parse("null");
        Assert.False(TeslaChargingHistorySnapshot.FromJson(notObject.RootElement).HasData);
    }

    [Fact]
    public void Vehicles_parse_from_a_bare_array_and_a_data_envelope()
    {
        using var bare = JsonDocument.Parse("[{\"vin\":\"V1\",\"display_name\":\"Three\"},{\"vin\":\"V2\",\"display_name\":\"Y\"}]");
        var fromBare = TeslaChargingVehicle.ListFromJson(bare.RootElement);
        Assert.Equal(2, fromBare.Count);
        Assert.Equal("V1", fromBare[0].Vin);
        Assert.Equal("Three", fromBare[0].DisplayName);

        using var enveloped = JsonDocument.Parse("{\"data\":[{\"vin\":\"V3\",\"display_name\":\"S\"}]}");
        var fromEnvelope = TeslaChargingVehicle.ListFromJson(enveloped.RootElement);
        Assert.Equal("V3", Assert.Single(fromEnvelope).Vin);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_history_into_the_success_state()
    {
        var feed = new FakeFeed(new TeslaChargingHistorySnapshot(true, [SampleEntry()], SampleSummary()));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingHistoryState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.False(vm.IsFetching);
        Assert.Equal(1, feed.HistoryFetchCount);
        Assert.Equal(1, feed.VehiclesFetchCount);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new TeslaChargingHistoryPageViewModel(EmptyTeslaChargingHistoryFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingHistoryState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.Display.ShowTable);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new FakeFeed(TeslaChargingHistorySnapshot.Empty, historyError: new InvalidOperationException("network down"));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingHistoryState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_set_vehicle_reloads_the_history_with_the_vin()
    {
        var feed = new FakeFeed(new TeslaChargingHistorySnapshot(true, [SampleEntry()], SampleSummary()));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.SetVehicleAsync("5YJ3E1EA1KF000123");

        Assert.Equal("5YJ3E1EA1KF000123", vm.SelectedVin);
        Assert.Equal(2, feed.HistoryFetchCount);
        Assert.Equal("5YJ3E1EA1KF000123", feed.LastHistoryVin);
    }

    [Fact]
    public async Task ViewModel_set_search_filters_without_a_network_round_trip()
    {
        var entries = new[]
        {
            SampleEntry(id: 1, site: "Mountain View"),
            SampleEntry(id: 2, site: "Gilroy"),
        };
        var feed = new FakeFeed(new TeslaChargingHistorySnapshot(true, entries, SampleSummary()));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        vm.SetSearch("gilroy");

        Assert.Equal(1, feed.HistoryFetchCount);   // search is client-side only — no refetch
        var row = Assert.Single(vm.Display.Rows);
        Assert.Equal(2, row.SessionId);
        Assert.Equal("gilroy", vm.SearchQuery);

        vm.ClearSearch();
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.Equal(1, feed.HistoryFetchCount);
    }

    [Fact]
    public async Task ViewModel_set_range_filters_without_a_network_round_trip()
    {
        var entries = new[]
        {
            SampleEntry(id: 1, start: "2026-03-15T10:00:00Z"),
            SampleEntry(id: 2, start: "2026-04-15T10:00:00Z"),
        };
        var feed = new FakeFeed(new TeslaChargingHistorySnapshot(true, entries, SampleSummary()));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        vm.SetRange(new DateOnly(2026, 4, 1), new DateOnly(2026, 4, 30));

        Assert.Equal(1, feed.HistoryFetchCount);   // range is client-side only — no refetch
        var row = Assert.Single(vm.Display.Rows);
        Assert.Equal(2, row.SessionId);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new TeslaChargingHistorySnapshot(true, [SampleEntry()], SampleSummary()));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshFromTeslaAsync();

        Assert.Equal(1, feed.RefreshCount);
        Assert.Equal(TeslaChargingHistoryState.Success, vm.State);
        Assert.False(vm.Display.RefreshPending);
    }

    [Fact]
    public async Task ViewModel_refresh_failure_keeps_the_existing_data()
    {
        var feed = new FakeFeed(
            new TeslaChargingHistorySnapshot(true, [SampleEntry()], SampleSummary()),
            refreshError: new InvalidOperationException("sync failed"));
        using var vm = new TeslaChargingHistoryPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshFromTeslaAsync();

        Assert.True(vm.Display.ShowTable);   // the existing data + table survive a failed refresh
        Assert.False(vm.Display.RefreshPending);
        Assert.Equal(TeslaChargingHistoryState.Success, vm.State);
    }

    // ---- Generated-client feed (web hooks) -----------------------------------------

    [Fact]
    public async Task ClientFeed_history_sends_the_operation_with_the_vin_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"entries\":[],\"summary\":{\"total_sessions\":0}}"));
        var feed = new TeslaChargingHistoryClientFeed(api);

        var snapshot = await feed.FetchHistoryAsync("VIN9", default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tesla_charging_history", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("VIN9", request.Query!["vin"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_history_omits_the_vin_query_for_all_vehicles()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"entries\":[]}"));
        var feed = new TeslaChargingHistoryClientFeed(api);

        await feed.FetchHistoryAsync(null, default);

        Assert.Null(Assert.Single(api.Requests).Query);
    }

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_vehicles_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"vin\":\"V1\",\"display_name\":\"Three\"}]"));
        var feed = new TeslaChargingHistoryClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        Assert.Equal("V1", Assert.Single(vehicles).Vin);
        Assert.Equal("get_api_v1_vehicles", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_refresh_sends_the_refresh_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"entries\":[],\"summary\":{\"total_sessions\":0}}"));
        var feed = new TeslaChargingHistoryClientFeed(api);

        await feed.RefreshAsync("VIN3", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_tesla_charging_history_refresh", request.OperationId);
        Assert.Equal("VIN3", request.Query!["vin"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_the_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("server error", 500));
        var feed = new TeslaChargingHistoryClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchHistoryAsync(null, default));
        Assert.Equal(500, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_view_opened()
    {
        var diagnostics = new TeslaChargingHistoryDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.OpenedCount);
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("TeslaChargingHistory", TeslaChargingHistoryRegistration.RouteName);
        Assert.Equal("/tesla-charging-history", TeslaChargingHistoryRegistration.WebRoute);
        Assert.Equal("get_api_v1_tesla_charging_history", TeslaChargingHistoryRegistration.HistoryOperation);
        Assert.Equal("post_api_v1_tesla_charging_history_refresh", TeslaChargingHistoryRegistration.RefreshOperation);
        Assert.Equal("get_api_v1_vehicles", TeslaChargingHistoryRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_tesla_charging_invoice_contentID", TeslaChargingHistoryRegistration.InvoiceOperation);
    }

    private static void AssertColumn(TeslaChargingHistoryColumn column, string key, string header, bool numeric)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
        Assert.Equal(numeric, column.IsNumeric);
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

    private sealed class FakeFeed : ITeslaChargingHistoryFeed
    {
        private readonly TeslaChargingHistorySnapshot _snapshot;
        private readonly IReadOnlyList<TeslaChargingVehicle> _vehicles;
        private readonly Exception? _historyError;
        private readonly Exception? _refreshError;

        public FakeFeed(
            TeslaChargingHistorySnapshot snapshot,
            IReadOnlyList<TeslaChargingVehicle>? vehicles = null,
            Exception? historyError = null,
            Exception? refreshError = null)
        {
            _snapshot = snapshot;
            _vehicles = vehicles ?? [new TeslaChargingVehicle("5YJ3E1EA1KF000123", "Model 3")];
            _historyError = historyError;
            _refreshError = refreshError;
        }

        public int HistoryFetchCount { get; private set; }

        public int VehiclesFetchCount { get; private set; }

        public int RefreshCount { get; private set; }

        public string? LastHistoryVin { get; private set; }

        public Task<TeslaChargingHistorySnapshot> FetchHistoryAsync(string? vin, CancellationToken cancellationToken)
        {
            HistoryFetchCount++;
            LastHistoryVin = vin;
            if (_historyError is not null)
            {
                throw _historyError;
            }

            return Task.FromResult(_snapshot);
        }

        public Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetchCount++;
            return Task.FromResult(_vehicles);
        }

        public Task<TeslaChargingHistorySnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken)
        {
            RefreshCount++;
            if (_refreshError is not null)
            {
                throw _refreshError;
            }

            return Task.FromResult(_snapshot);
        }
    }
}
