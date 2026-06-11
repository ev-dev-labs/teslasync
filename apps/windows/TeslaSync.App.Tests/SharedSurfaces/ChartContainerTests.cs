using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.ChartContainerSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ChartContainer surface's UI-thread-free logic — the i18n projection
/// (<see cref="ChartContainerProjection"/>), the direction / axis-anchor adapter (<see cref="ChartDirection"/>,
/// the web <c>useChartLabelAnchor</c> / <c>textAnchorForDir</c>), the annotation row projection
/// (<see cref="ChartAnnotationRow.ToDataAnnotation"/>, web <c>toDataAnnotation</c>), the fallback-table helpers,
/// the hidden-series + hidden-preference primitives, the state holder (<see cref="ChartContainerViewModel"/>) and
/// the PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/charts/ChartContainer.tsx,
/// web/src/api/hooks/useAnnotations.ts, web/src/types/annotations.ts, web/src/hooks/useHiddenSeries.ts,
/// web/src/lib/i18nDir.ts). The WinUI view (shared-surfaces/ChartContainer.cs, which composes the glass panel,
/// toolbar, body states, accessible figcaption fallback, annotation list and add popover, and marshals
/// notifications onto the dispatcher) is exercised by the app build.
/// </summary>
public sealed class ChartContainerTests
{
    private static ChartContainerOptions BaseOptions(
        ChartAnnotationsConfig? annotations = null,
        bool loading = false,
        bool empty = false,
        bool exportable = true,
        string? ariaDescription = null,
        string? chartKey = null,
        IReadOnlyList<ChartDataRow>? data = null,
        IReadOnlyList<ChartDataColumn>? columns = null) =>
        new()
        {
            Title = "Daily energy",
            AriaLabel = "Daily energy use over the last 30 days",
            Loading = loading,
            Empty = empty,
            Exportable = exportable,
            Annotations = annotations,
            AriaDescription = ariaDescription,
            ChartKey = chartKey,
            Data = data,
            DataColumns = columns,
        };

    private static ChartContainerViewModel NewViewModel(
        ChartContainerOptions options,
        IChartAnnotationSource? source = null,
        IAnnotationHiddenStore? store = null) =>
        new(
            source ?? new InMemoryChartAnnotationSource(),
            store ?? new InMemoryAnnotationHiddenStore(),
            PassthroughLocalizer.Instance,
            options);

    // ── registration + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ChartContainer", ChartContainerRegistration.Slug);

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChartContainerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChartContainer", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ChartContainerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── i18n projection (web t('…') call sites, resolved to the English fallbacks by PassthroughLocalizer) ──

    [Fact]
    public void Projection_resolves_every_chrome_label_to_the_web_fallback()
    {
        ChartContainerDisplay display = ChartContainerProjection.Project(PassthroughLocalizer.Instance);

        Assert.Equal("Add annotation", display.AddAnnotation);
        Assert.Equal("Show annotations", display.ShowAnnotations);
        Assert.Equal("Hide annotations", display.HideAnnotations);
        Assert.Equal("Annotations on this chart", display.MarkerRow);
        Assert.Equal("No data available", display.NoData);
        Assert.Equal("This chart failed to load", display.ChartFailed);
        Assert.Equal("Date", display.DateLabel);
        Assert.Equal("Cancel", display.CancelLabel);
    }

    [Fact]
    public void Projection_keeps_the_title_parameterized_templates()
    {
        ChartContainerDisplay display = ChartContainerProjection.Project(PassthroughLocalizer.Instance);

        Assert.Equal("Speed \u2014 data table", display.FallbackTableLabel("Speed"));
        Assert.Equal("Chart: Speed", display.Summary("Speed"));
    }

    [Theory]
    [InlineData("{0} \u2014 data table", "Battery", "Battery \u2014 data table")]
    [InlineData("{{title}} \u2014 data table", "Battery", "Battery \u2014 data table")]
    [InlineData("Chart: {0}", "Power", "Chart: Power")]
    [InlineData("no placeholder", "X", "no placeholder")]
    public void Format_interpolates_both_native_and_web_placeholders(string template, string title, string expected) =>
        Assert.Equal(expected, ChartContainerRegistration.Format(template, title));

    // ── adapter: ChartDirection (web getLangDir + textAnchorForDir / useChartLabelAnchor) ──────────────────

    [Theory]
    [InlineData("en", Direction.Ltr)]
    [InlineData("pt-BR", Direction.Ltr)]
    [InlineData("ar", Direction.Rtl)]
    [InlineData("he-IL", Direction.Rtl)]
    [InlineData("fa", Direction.Rtl)]
    [InlineData("ur", Direction.Rtl)]
    [InlineData("AR", Direction.Rtl)]
    [InlineData("", Direction.Ltr)]
    [InlineData(null, Direction.Ltr)]
    public void Resolve_maps_language_tag_to_direction(string? lang, Direction expected) =>
        Assert.Equal(expected, ChartDirection.Resolve(lang));

    [Theory]
    [InlineData(ChartAxis.X, Direction.Ltr, "middle")]
    [InlineData(ChartAxis.X, Direction.Rtl, "middle")]
    [InlineData(ChartAxis.Y, Direction.Ltr, "end")]
    [InlineData(ChartAxis.Y, Direction.Rtl, "start")]
    public void TextAnchor_flips_the_y_axis_label_by_direction(ChartAxis axis, Direction dir, string expected) =>
        Assert.Equal(expected, ChartDirection.TextAnchor(axis, dir));

    [Fact]
    public void LabelAnchor_resolves_anchor_straight_from_a_language_tag()
    {
        Assert.Equal("end", ChartDirection.LabelAnchor(ChartAxis.Y, "en"));
        Assert.Equal("start", ChartDirection.LabelAnchor(ChartAxis.Y, "he"));
        Assert.Equal("middle", ChartDirection.LabelAnchor(ChartAxis.X, "ar"));
    }

    // ── adapter: AnnotationCategories + ChartAnnotationRow.ToDataAnnotation (web toDataAnnotation) ──────────

    [Theory]
    [InlineData(AnnotationCategory.Milestone, "milestone")]
    [InlineData(AnnotationCategory.Maintenance, "maintenance")]
    [InlineData(AnnotationCategory.Trip, "trip")]
    [InlineData(AnnotationCategory.Issue, "issue")]
    [InlineData(AnnotationCategory.Upgrade, "upgrade")]
    [InlineData(AnnotationCategory.Custom, "custom")]
    public void Annotation_category_round_trips_through_the_wire_token(AnnotationCategory category, string wire)
    {
        Assert.Equal(wire, AnnotationCategories.ToWire(category));
        Assert.Equal(category, AnnotationCategories.FromWire(wire));
    }

    [Theory]
    [InlineData("MILESTONE", AnnotationCategory.Milestone)]
    [InlineData("unknown-token", AnnotationCategory.Custom)]
    [InlineData(null, AnnotationCategory.Custom)]
    public void Unknown_wire_token_falls_back_to_custom(string? wire, AnnotationCategory expected) =>
        Assert.Equal(expected, AnnotationCategories.FromWire(wire));

    [Fact]
    public void ToDataAnnotation_projects_the_backend_row_like_the_web_helper()
    {
        var row = new ChartAnnotationRow(
            Id: 42,
            VehicleId: 7,
            OccurredAt: "2024-03-01T12:00:00Z",
            Category: AnnotationCategory.Maintenance,
            Title: "Tire rotation",
            Description: "Front-to-back",
            Scope: new[] { "tire", "mileage" },
            Color: "#f59e0b",
            CreatedAt: "2024-03-01T12:05:00Z",
            UpdatedAt: "2024-03-01T12:05:00Z");

        ChartDataAnnotation projected = row.ToDataAnnotation();

        Assert.Equal("42", projected.Id);
        Assert.Equal("2024-03-01T12:00:00Z", projected.Timestamp);
        Assert.Equal("Tire rotation", projected.Label);
        Assert.Equal("Front-to-back", projected.Description);
        Assert.Equal(AnnotationCategory.Maintenance, projected.Category);
        Assert.Equal("tire", projected.Context);
        Assert.Equal(7, projected.VehicleId);
        Assert.Equal("2024-03-01T12:05:00Z", projected.CreatedAt);
    }

    [Fact]
    public void ToDataAnnotation_handles_empty_scope_and_null_optionals()
    {
        var row = new ChartAnnotationRow(
            Id: 1,
            VehicleId: null,
            OccurredAt: "t",
            Category: AnnotationCategory.Custom,
            Title: "Fleet note",
            Description: null,
            Scope: Array.Empty<string>(),
            Color: null,
            CreatedAt: "c",
            UpdatedAt: "u");

        ChartDataAnnotation projected = row.ToDataAnnotation();

        Assert.Equal(string.Empty, projected.Context);
        Assert.Null(projected.Description);
        Assert.Null(projected.VehicleId);
    }

    // ── adapter: ChartFallbackTable (web hasFallbackTable + per-cell formatter) ────────────────────────────

    [Fact]
    public void HasTable_requires_both_rows_and_columns()
    {
        var rows = new[] { ChartDataRow.Of(("k", 1)) };
        var cols = new[] { new ChartDataColumn("k", "K") };

        Assert.True(ChartFallbackTable.HasTable(rows, cols));
        Assert.False(ChartFallbackTable.HasTable(rows, Array.Empty<ChartDataColumn>()));
        Assert.False(ChartFallbackTable.HasTable(Array.Empty<ChartDataRow>(), cols));
        Assert.False(ChartFallbackTable.HasTable(null, cols));
        Assert.False(ChartFallbackTable.HasTable(rows, null));
    }

    [Fact]
    public void FormatCell_uses_the_formatter_then_falls_back_to_the_em_dash()
    {
        var formatted = new ChartDataColumn("kwh", "Energy", v => $"{v} kWh");
        var plain = new ChartDataColumn("kwh", "Energy");
        var row = ChartDataRow.Of(("kwh", 12), ("missing-handled", null));

        Assert.Equal("12 kWh", ChartFallbackTable.FormatCell(formatted, row));
        Assert.Equal("12", ChartFallbackTable.FormatCell(plain, row));
        Assert.Equal("\u2014", ChartFallbackTable.FormatCell(new ChartDataColumn("absent", "X"), row));
    }

    // ── adapter: HiddenPreference + HiddenSeriesState + InMemoryAnnotationHiddenStore ─────────────────────

    [Fact]
    public void HiddenPreference_composes_the_web_storage_key()
    {
        Assert.Equal("teslasync-annotations-hidden:", HiddenPreference.StoragePrefix);
        Assert.Equal("teslasync-annotations-hidden:cost-chart", HiddenPreference.StorageKey("cost-chart"));
    }

    [Fact]
    public void HiddenSeriesState_toggles_and_keeps_a_sorted_set()
    {
        var state = new HiddenSeriesState("battery-trend");

        Assert.False(state.IsHidden("health"));
        state.Toggle("projected");
        state.Toggle("health");
        Assert.True(state.IsHidden("health"));
        Assert.True(state.IsHidden("projected"));

        // web sorts the URL param so toggle order does not matter.
        Assert.Equal(new[] { "health", "projected" }, state.Hidden);

        state.Toggle("health");
        Assert.False(state.IsHidden("health"));

        state.Reset();
        Assert.Empty(state.Hidden);
    }

    [Fact]
    public void InMemory_hidden_store_round_trips_under_the_canonical_key()
    {
        var store = new InMemoryAnnotationHiddenStore();

        Assert.False(store.IsHidden("k"));
        store.SetHidden("k", true);
        Assert.True(store.IsHidden("k"));
        store.SetHidden("k", false);
        Assert.False(store.IsHidden("k"));
    }

    // ── view-model: body state, export gate, fullscreen, hidden-series ────────────────────────────────────

    [Fact]
    public void BodyState_maps_loading_then_empty_then_ready()
    {
        using var vm = NewViewModel(BaseOptions(loading: true));
        Assert.Equal(ChartBodyState.Loading, vm.BodyState);

        vm.Loading = false;
        vm.Empty = true;
        Assert.Equal(ChartBodyState.Empty, vm.BodyState);

        vm.Empty = false;
        Assert.Equal(ChartBodyState.Ready, vm.BodyState);
    }

    [Fact]
    public void Loading_setter_raises_change_for_body_state_and_export_gate()
    {
        using var vm = NewViewModel(BaseOptions());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Loading = true;

        Assert.Contains(nameof(ChartContainerViewModel.Loading), changed);
        Assert.Contains(nameof(ChartContainerViewModel.BodyState), changed);
        Assert.Contains(nameof(ChartContainerViewModel.ShowExportMenu), changed);
    }

    [Theory]
    [InlineData(true, false, false, true)]
    [InlineData(false, true, false, false)]
    [InlineData(false, false, true, false)]
    [InlineData(false, false, false, false)]
    public void ShowExportMenu_only_when_exportable_and_not_loading_or_empty(
        bool exportable, bool loading, bool empty, bool expected)
    {
        using var vm = NewViewModel(BaseOptions(exportable: exportable, loading: loading, empty: empty));
        Assert.Equal(expected, vm.ShowExportMenu);
    }

    [Fact]
    public void HiddenSeries_is_null_without_a_chart_key_and_present_with_one()
    {
        using var without = NewViewModel(BaseOptions());
        Assert.Null(without.HiddenSeries);

        using var with = NewViewModel(BaseOptions(chartKey: "battery-trend"));
        Assert.NotNull(with.HiddenSeries);
        Assert.Equal("battery-trend", with.HiddenSeries!.ChartKey);
    }

    // ── view-model: accessible fallback decision (web figcaption branches) ────────────────────────────────

    [Fact]
    public void Fallback_shows_the_bare_summary_when_neither_table_nor_description()
    {
        using var vm = NewViewModel(BaseOptions());

        Assert.False(vm.HasFallbackTable);
        Assert.False(vm.ShowFallbackDescription);
        Assert.True(vm.ShowFallbackSummary);
        Assert.Equal("Chart: Daily energy", vm.AccessibleSummary());
    }

    [Fact]
    public void Fallback_prefers_the_table_and_drops_the_summary()
    {
        var rows = new[] { ChartDataRow.Of(("day", "Mon"), ("kwh", 12)) };
        var cols = new[] { new ChartDataColumn("day", "Day"), new ChartDataColumn("kwh", "kWh") };
        using var vm = NewViewModel(BaseOptions(ariaDescription: "Ranged 10-14 kWh.", data: rows, columns: cols));

        Assert.True(vm.HasFallbackTable);
        Assert.True(vm.ShowFallbackDescription);
        Assert.False(vm.ShowFallbackSummary);
        Assert.Equal("Daily energy \u2014 data table", vm.FallbackTableLabel());
    }

    // ── view-model: annotation flow (fetch / add / delete / hide) ─────────────────────────────────────────

    [Fact]
    public void Annotations_disabled_yields_no_flow()
    {
        using var vm = NewViewModel(BaseOptions());

        Assert.False(vm.AnnotationsEnabled);
        Assert.Empty(vm.VisibleAnnotations);
        Assert.False(vm.ShowMarkerRow);
        Assert.False(vm.AnnotationListVisible);
    }

    [Fact]
    public void AnnotationKey_defaults_to_chart_id_then_title()
    {
        using var withId = NewViewModel(BaseOptions(new ChartAnnotationsConfig("cost", ChartId: "cost-chart")));
        Assert.Equal("cost-chart", withId.AnnotationKey);

        using var withoutId = NewViewModel(BaseOptions(new ChartAnnotationsConfig("cost")));
        Assert.Equal("Daily energy", withoutId.AnnotationKey);
    }

    [Fact]
    public async Task LoadAnnotations_fetches_vehicle_plus_fleet_rows_in_scope()
    {
        var source = new InMemoryChartAnnotationSource(new[]
        {
            Row(1, 5, "battery", "Vehicle 5"),
            Row(2, null, "battery", "Fleet-wide"),
            Row(3, 9, "battery", "Other vehicle"),
            Row(4, 5, "cost", "Wrong scope"),
        });
        using var vm = NewViewModel(BaseOptions(new ChartAnnotationsConfig("battery", VehicleId: 5)), source);

        await vm.LoadAnnotationsAsync();

        Assert.Equal(1, source.FetchCount);
        Assert.Equal(new[] { "Vehicle 5", "Fleet-wide" }, vm.FetchedAnnotations.Select(a => a.Label));
        Assert.True(vm.AnnotationListVisible);
    }

    [Fact]
    public async Task VisibleAnnotations_collapse_when_hidden()
    {
        var source = new InMemoryChartAnnotationSource(new[] { Row(1, null, "battery", "Note") });
        using var vm = NewViewModel(BaseOptions(new ChartAnnotationsConfig("battery")), source);
        await vm.LoadAnnotationsAsync();

        Assert.Single(vm.VisibleAnnotations);
        Assert.True(vm.ShowMarkerRow);

        vm.ToggleHidden();

        Assert.Empty(vm.VisibleAnnotations);
        Assert.False(vm.ShowMarkerRow);
        Assert.True(vm.AnnotationListVisible); // the footer list still shows the fetched rows.
    }

    [Fact]
    public void ToggleHidden_persists_and_initializes_from_the_store()
    {
        var store = new InMemoryAnnotationHiddenStore();
        var config = new ChartAnnotationsConfig("battery", ChartId: "battery-chart");

        using (var vm = NewViewModel(BaseOptions(config), store: store))
        {
            var changed = new List<string?>();
            vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

            Assert.False(vm.Hidden);
            vm.ToggleHidden();

            Assert.True(vm.Hidden);
            Assert.Contains(nameof(ChartContainerViewModel.Hidden), changed);
            Assert.True(store.IsHidden("battery-chart"));
            Assert.Equal("Show annotations", vm.ToggleAnnotationsLabel);
        }

        // A fresh holder over the same store reads back the persisted hidden state (web readHiddenPref).
        using var reopened = NewViewModel(BaseOptions(config), store: store);
        Assert.True(reopened.Hidden);
    }

    [Fact]
    public void ToggleHidden_is_a_no_op_when_annotations_are_disabled()
    {
        using var vm = NewViewModel(BaseOptions());

        vm.ToggleHidden();

        Assert.False(vm.Hidden);
    }

    [Fact]
    public async Task AddAnnotation_creates_with_the_configured_scope_then_reloads()
    {
        var source = new InMemoryChartAnnotationSource();
        var config = new ChartAnnotationsConfig("cost", VehicleId: 7);
        using var vm = NewViewModel(BaseOptions(config), source);
        vm.OpenPopover();

        await vm.AddAnnotationAsync("Rate change", AnnotationCategory.Milestone, "PG&E TOU", "2024-05-01T00:00:00Z");

        Assert.Equal(1, source.CreateCount);
        Assert.NotNull(source.LastCreated);
        Assert.Equal(7, source.LastCreated!.VehicleId);
        Assert.Equal("2024-05-01T00:00:00Z", source.LastCreated.OccurredAt);
        Assert.Equal(AnnotationCategory.Milestone, source.LastCreated.Category);
        Assert.Equal("Rate change", source.LastCreated.Title);
        Assert.Equal("PG&E TOU", source.LastCreated.Description);
        Assert.Equal(new[] { "cost" }, source.LastCreated.Scope);

        Assert.False(vm.PopoverOpen);
        Assert.Equal(1, source.FetchCount); // reloaded after the create.
        Assert.Contains(vm.FetchedAnnotations, a => a.Label == "Rate change");
    }

    [Fact]
    public async Task AddAnnotation_is_skipped_without_an_occurrence_timestamp()
    {
        var source = new InMemoryChartAnnotationSource();
        using var vm = NewViewModel(BaseOptions(new ChartAnnotationsConfig("cost")), source);

        await vm.AddAnnotationAsync("No date", AnnotationCategory.Custom, null, null);
        await vm.AddAnnotationAsync("Empty date", AnnotationCategory.Custom, null, string.Empty);

        Assert.Equal(0, source.CreateCount);
    }

    [Fact]
    public async Task RemoveAnnotation_deletes_a_positive_numeric_id_then_reloads()
    {
        var source = new InMemoryChartAnnotationSource(new[] { Row(3, null, "cost", "Removable") });
        using var vm = NewViewModel(BaseOptions(new ChartAnnotationsConfig("cost")), source);
        await vm.LoadAnnotationsAsync();

        await vm.RemoveAnnotationAsync("3");

        Assert.Equal(1, source.DeleteCount);
        Assert.Equal(3, source.LastDeleted);
        Assert.Empty(vm.FetchedAnnotations);
    }

    [Theory]
    [InlineData("not-a-number")]
    [InlineData("0")]
    [InlineData("-5")]
    public async Task RemoveAnnotation_ignores_non_numeric_or_non_positive_ids(string id)
    {
        var source = new InMemoryChartAnnotationSource(new[] { Row(3, null, "cost", "Keep") });
        using var vm = NewViewModel(BaseOptions(new ChartAnnotationsConfig("cost")), source);

        await vm.RemoveAnnotationAsync(id);

        Assert.Equal(0, source.DeleteCount);
    }

    [Fact]
    public void Popover_open_close_round_trips()
    {
        using var vm = NewViewModel(BaseOptions(new ChartAnnotationsConfig("cost")));

        Assert.False(vm.PopoverOpen);
        vm.OpenPopover();
        Assert.True(vm.PopoverOpen);
        vm.ClosePopover();
        Assert.False(vm.PopoverOpen);
    }

    private static ChartAnnotationRow Row(long id, int? vehicleId, string scope, string title) => new(
        Id: id,
        VehicleId: vehicleId,
        OccurredAt: "2024-01-01T00:00:00Z",
        Category: AnnotationCategory.Custom,
        Title: title,
        Description: null,
        Scope: new[] { scope },
        Color: null,
        CreatedAt: "2024-01-01T00:00:00Z",
        UpdatedAt: "2024-01-01T00:00:00Z");
}
