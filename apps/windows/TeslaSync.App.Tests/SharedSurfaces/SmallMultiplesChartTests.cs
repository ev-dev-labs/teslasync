using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>SmallMultiplesChart</c> shared surface's UI-thread-free logic — the data
/// adapter (per-series finite projection + stride downsampling + label/colour resolution, the web
/// <c>cellProjections</c> + <c>strideSample</c>), the source/store (seed / replace / select / change
/// notification), the view-model's empty (no series) vs populated states and per-cell has-data branch, the
/// localized "No data" label and its <c>emptyCellLabel</c> override, the x-axis time formatter binding, the
/// PII-safe diagnostics and the argument validation. Mirrors the web spec one-for-one
/// (web/src/components/charts/SmallMultiplesChart.tsx). The WinUI view itself (the grid of cells, mini chart,
/// "No data" body, interactive button cells) is exercised by the app build.
/// </summary>
public sealed class SmallMultiplesChartTests
{
    // ── Finite guard + stride downsampling (the perf-critical data adapter) ──────────────────────────────

    [Theory]
    [InlineData(0.0, true)]
    [InlineData(-12.5, true)]
    [InlineData(double.NaN, false)]
    [InlineData(double.PositiveInfinity, false)]
    [InlineData(double.NegativeInfinity, false)]
    public void IsFinite_matches_the_web_isFinitePoint(double value, bool expected) =>
        Assert.Equal(expected, SmallMultiplesProjection.IsFinite(value));

    [Fact]
    public void StrideSample_returns_input_when_within_cap()
    {
        IReadOnlyList<int> rows = [1, 2, 3];

        var sampled = SmallMultiplesProjection.StrideSample(rows, 400);

        Assert.Equal(new[] { 1, 2, 3 }, sampled);
    }

    [Fact]
    public void StrideSample_downsamples_and_always_keeps_first_and_last()
    {
        IReadOnlyList<int> rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        // cap 3 → stride ceil(10/3)=4 → indices 0,4,8 then force-append last (9): web preserves first + last.
        var sampled = SmallMultiplesProjection.StrideSample(rows, 3);

        Assert.Equal(new[] { 0, 4, 8, 9 }, sampled);
        Assert.Equal(0, sampled[0]);
        Assert.Equal(9, sampled[^1]);
    }

    [Fact]
    public void StrideSample_does_not_duplicate_the_last_when_stride_lands_on_it()
    {
        IReadOnlyList<int> rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        // cap 4 → stride ceil(10/4)=3 → indices 0,3,6,9 — the last index is already included.
        var sampled = SmallMultiplesProjection.StrideSample(rows, 4);

        Assert.Equal(new[] { 0, 3, 6, 9 }, sampled);
    }

    [Fact]
    public void StrideSample_clamps_a_non_positive_cap_to_one()
    {
        IReadOnlyList<int> rows = [10, 20, 30, 40, 50];

        // cap 0 → clamped to 1 → only the first plus the forced last.
        var sampled = SmallMultiplesProjection.StrideSample(rows, 0);

        Assert.Equal(new[] { 10, 50 }, sampled);
    }

    [Fact]
    public void StrideSample_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => SmallMultiplesProjection.StrideSample<int>(null!, 10));

    // ── Per-series projection: finite filter + timestamp→x mapping ───────────────────────────────────────

    [Fact]
    public void ProjectSeries_keeps_only_finite_points_for_the_key()
    {
        IReadOnlyList<SmallMultiplesSample> samples =
        [
            Sample(1000, ("a", 5), ("b", 1)),
            Sample(2000, ("a", double.NaN), ("b", 2)),   // a: non-finite → skipped
            Sample(3000, ("b", 3)),                       // a: absent → skipped
            Sample(4000, ("a", 9), ("b", double.PositiveInfinity)),
        ];

        var a = SmallMultiplesProjection.ProjectSeries(samples, "a", 400);
        var b = SmallMultiplesProjection.ProjectSeries(samples, "b", 400);

        Assert.Equal(new[] { (1000.0, 5.0), (4000.0, 9.0) }, a.Select(p => (p.X, p.Y)));
        Assert.Equal(new[] { (1000.0, 1.0), (2000.0, 2.0), (3000.0, 3.0) }, b.Select(p => (p.X, p.Y)));
    }

    [Fact]
    public void ProjectSeries_downsamples_to_the_cap()
    {
        var samples = new List<SmallMultiplesSample>();
        for (int i = 0; i < 50; i++)
        {
            samples.Add(Sample(i, ("a", i)));
        }

        var points = SmallMultiplesProjection.ProjectSeries(samples, "a", 10);

        Assert.True(points.Count <= 11, $"expected ≤ 11 points, got {points.Count}");
        Assert.Equal(0.0, points[0].X);
        Assert.Equal(49.0, points[^1].X);
    }

    [Fact]
    public void ProjectSeries_yields_nothing_when_the_key_is_never_finite()
    {
        IReadOnlyList<SmallMultiplesSample> samples = [Sample(1000, ("a", 1)), Sample(2000, ("a", 2))];

        Assert.Empty(SmallMultiplesProjection.ProjectSeries(samples, "missing", 400));
    }

    [Fact]
    public void ProjectSeries_rejects_invalid_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => SmallMultiplesProjection.ProjectSeries(null!, "a", 10));
        Assert.Throws<ArgumentException>(() => SmallMultiplesProjection.ProjectSeries([], "", 10));
    }

    // ── Cell projection: label / colour fallbacks + has-data + range captions ────────────────────────────

    [Fact]
    public void ToCell_falls_back_to_the_key_and_position_like_the_web()
    {
        IReadOnlyList<SmallMultiplesSample> samples = [Sample(1000, ("spd", 30)), Sample(2000, ("spd", 40))];

        var cell = SmallMultiplesProjection.ToCell(
            samples, Series("spd"), position: 3, new SmallMultiplesLayout(), new TokenTimeFormatter());

        Assert.Equal("spd", cell.Key);
        Assert.Equal("spd", cell.Label);                 // web seriesLabel ?? sig
        Assert.Equal(3, cell.ColorIndex);                // web colorIndex ?? i
        Assert.Equal(ChartPalette.KeyForIndex(3), cell.ColorBrushKey);
        Assert.True(cell.HasData);
        Assert.Equal("t1000", cell.RangeStartLabel);     // useDateFormat().formatTime(first)
        Assert.Equal("t2000", cell.RangeEndLabel);       // useDateFormat().formatTime(last)
    }

    [Fact]
    public void ToCell_uses_explicit_label_and_colour_overrides()
    {
        var cell = SmallMultiplesProjection.ToCell(
            [Sample(1000, ("x", 1))], Series("x", label: "Speed", color: 7), position: 0,
            new SmallMultiplesLayout(), new TokenTimeFormatter());

        Assert.Equal("Speed", cell.Label);
        Assert.Equal(7, cell.ColorIndex);
    }

    [Fact]
    public void ToCell_clamps_a_negative_colour_index_to_zero()
    {
        var cell = SmallMultiplesProjection.ToCell(
            [Sample(1000, ("x", 1))], Series("x", color: -5), position: 2,
            new SmallMultiplesLayout(), new TokenTimeFormatter());

        Assert.Equal(0, cell.ColorIndex); // web Math.max(0, idx)
    }

    [Fact]
    public void ToCell_marks_an_empty_series_and_omits_the_range_captions()
    {
        var cell = SmallMultiplesProjection.ToCell(
            [Sample(1000, ("other", 1))], Series("x"), position: 0,
            new SmallMultiplesLayout(), new TokenTimeFormatter());

        Assert.False(cell.HasData);
        Assert.Empty(cell.Points);
        Assert.Null(cell.RangeStartLabel);
        Assert.Null(cell.RangeEndLabel);
    }

    [Fact]
    public void ProjectCells_maps_every_series_preserving_order()
    {
        IReadOnlyList<SmallMultiplesSample> samples = [Sample(1000, ("a", 1), ("b", 2), ("c", 3))];
        IReadOnlyList<SmallMultiplesSeries> series = [Series("a"), Series("b"), Series("c")];

        var cells = SmallMultiplesProjection.ProjectCells(
            samples, series, new SmallMultiplesLayout(), new TokenTimeFormatter());

        Assert.Equal(new[] { "a", "b", "c" }, cells.Select(c => c.Key));
        Assert.Equal(new[] { 0, 1, 2 }, cells.Select(c => c.ColorIndex));
    }

    [Fact]
    public void ProjectCells_rejects_null_arguments()
    {
        var fmt = new TokenTimeFormatter();
        Assert.Throws<ArgumentNullException>(() => SmallMultiplesProjection.ProjectCells(null!, [], new SmallMultiplesLayout(), fmt));
        Assert.Throws<ArgumentNullException>(() => SmallMultiplesProjection.ProjectCells([], null!, new SmallMultiplesLayout(), fmt));
        Assert.Throws<ArgumentNullException>(() => SmallMultiplesProjection.ProjectCells([], [], null!, fmt));
        Assert.Throws<ArgumentNullException>(() => SmallMultiplesProjection.ProjectCells([], [], new SmallMultiplesLayout(), null!));
    }

    // ── Source / store (the P1/S8 seam): seed, layout, interactivity, select, replace ────────────────────

    [Fact]
    public void Store_exposes_seeded_data_series_and_layout()
    {
        var layout = new SmallMultiplesLayout { Columns = 4, CellHeight = 96 };
        var store = new SmallMultiplesChartStore([Sample(1, ("a", 1))], [Series("a"), Series("b")], layout);

        Assert.Single(store.Samples);
        Assert.Equal(new[] { "a", "b" }, store.Series.Select(s => s.Key));
        Assert.Equal(4, store.Layout.Columns);
        Assert.Equal(96, store.Layout.CellHeight);
        Assert.False(store.IsInteractive);
    }

    [Fact]
    public void A_default_store_is_empty_with_the_web_default_layout()
    {
        var store = new SmallMultiplesChartStore();

        Assert.Empty(store.Samples);
        Assert.Empty(store.Series);
        Assert.Null(store.Layout.Columns);
        Assert.Equal(280, store.Layout.CellMinWidth);
        Assert.Equal(120, store.Layout.CellHeight);
        Assert.Equal(400, store.Layout.MaxPointsPerCell);
    }

    [Fact]
    public void Store_with_a_click_handler_is_interactive_and_forwards_the_series_key()
    {
        string? clicked = null;
        var store = new SmallMultiplesChartStore(onCellClick: key => clicked = key);

        Assert.True(store.IsInteractive);
        store.SelectCell("speed");

        Assert.Equal("speed", clicked);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void SelectCell_of_an_empty_key_is_a_no_op(string? key)
    {
        int calls = 0;
        var store = new SmallMultiplesChartStore(onCellClick: _ => calls++);

        store.SelectCell(key!);

        Assert.Equal(0, calls);
    }

    [Fact]
    public void SelectCell_on_a_non_interactive_store_is_a_silent_no_op()
    {
        var store = new SmallMultiplesChartStore();

        var ex = Record.Exception(() => store.SelectCell("a"));

        Assert.Null(ex);
    }

    [Fact]
    public void Replace_swaps_data_and_series_keeping_layout_and_raises_changed()
    {
        var layout = new SmallMultiplesLayout { Columns = 2 };
        var store = new SmallMultiplesChartStore([Sample(1, ("a", 1))], [Series("a")], layout);
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Replace([Sample(2, ("b", 2)), Sample(3, ("b", 3))], [Series("b")]);

        Assert.Equal(2, store.Samples.Count);
        Assert.Equal(new[] { "b" }, store.Series.Select(s => s.Key));
        Assert.Equal(2, store.Layout.Columns); // unchanged
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Replace_can_swap_the_layout_too()
    {
        var store = new SmallMultiplesChartStore([Sample(1, ("a", 1))], [Series("a")]);

        store.Replace([], [], new SmallMultiplesLayout { Columns = 5 });

        Assert.Equal(5, store.Layout.Columns);
    }

    [Fact]
    public void Replace_rejects_null()
    {
        var store = new SmallMultiplesChartStore();

        Assert.Throws<ArgumentNullException>(() => store.Replace(null!, []));
        Assert.Throws<ArgumentNullException>(() => store.Replace([], null!));
    }

    // ── View-model state: empty (no series) vs populated + per-cell has-data ─────────────────────────────

    [Fact]
    public void View_model_is_empty_with_no_series()
    {
        using var vm = new SmallMultiplesChartViewModel(new SmallMultiplesChartStore(), PassthroughLocalizer.Instance);

        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasCells);
        Assert.Empty(vm.Cells);
    }

    [Fact]
    public void View_model_projects_a_cell_per_series_with_per_cell_has_data()
    {
        var store = new SmallMultiplesChartStore(
            [Sample(1000, ("a", 5)), Sample(2000, ("a", 7))],
            [Series("a"), Series("b")]);
        using var vm = new SmallMultiplesChartViewModel(store, PassthroughLocalizer.Instance, new TokenTimeFormatter());

        var cells = vm.Cells;

        Assert.False(vm.IsEmpty);
        Assert.Equal(new[] { "a", "b" }, cells.Select(c => c.Key));
        Assert.True(cells[0].HasData);
        Assert.Equal(2, cells[0].Points.Count);
        Assert.False(cells[1].HasData); // b has no finite points but its cell is still rendered
        Assert.Empty(cells[1].Points);
    }

    [Fact]
    public void View_model_exposes_layout_knobs_and_interactivity()
    {
        var layout = new SmallMultiplesLayout { Columns = 3, CellMinWidth = 240, CellHeight = 100 };
        var store = new SmallMultiplesChartStore([], [Series("a")], layout, onCellClick: _ => { });
        using var vm = new SmallMultiplesChartViewModel(store, PassthroughLocalizer.Instance);

        Assert.Equal(3, vm.Columns);
        Assert.Equal(240, vm.CellMinWidth);
        Assert.Equal(100, vm.CellHeight);
        Assert.True(vm.IsInteractive);
    }

    [Fact]
    public void View_model_select_cell_forwards_to_the_source()
    {
        string? clicked = null;
        var store = new SmallMultiplesChartStore([], [Series("a")], onCellClick: key => clicked = key);
        using var vm = new SmallMultiplesChartViewModel(store, PassthroughLocalizer.Instance);

        vm.SelectCell("a");

        Assert.Equal("a", clicked);
    }

    [Fact]
    public void View_model_reprojects_when_the_source_changes()
    {
        var store = new SmallMultiplesChartStore([], []);
        using var vm = new SmallMultiplesChartViewModel(store, PassthroughLocalizer.Instance, new TokenTimeFormatter());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        store.Replace([Sample(1, ("a", 1))], [Series("a")]);

        Assert.Equal(new[] { "a" }, vm.Cells.Select(c => c.Key));
        Assert.Contains(nameof(SmallMultiplesChartViewModel.IsEmpty), changed);
        Assert.Contains(nameof(SmallMultiplesChartViewModel.HasCells), changed);
        Assert.Contains(nameof(SmallMultiplesChartViewModel.Cells), changed);
    }

    // ── i18n: "No data" via the localizer + the emptyCellLabel override ──────────────────────────────────

    [Fact]
    public void No_data_label_resolves_through_the_localizer_with_the_web_key()
    {
        var localizer = new RecordingLocalizer();
        using var vm = new SmallMultiplesChartViewModel(new SmallMultiplesChartStore(), localizer);

        Assert.Equal("No data", vm.NoDataLabel);
        Assert.Contains(("smallMultiples.noData", "No data"), localizer.Requests);
    }

    [Fact]
    public void No_data_label_honours_the_empty_cell_label_override()
    {
        var store = new SmallMultiplesChartStore(
            layout: new SmallMultiplesLayout { EmptyCellLabel = "Nothing recorded" });
        using var vm = new SmallMultiplesChartViewModel(store, PassthroughLocalizer.Instance);

        Assert.Equal("Nothing recorded", vm.NoDataLabel);
    }

    // ── Diagnostics (P1/S11): slug-only view.opened, never the series content ────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SmallMultiplesChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SmallMultiplesChart", Assert.Single(lines));
    }

    [Fact]
    public void Notify_opened_emits_the_view_opened_event_once()
    {
        var lines = new List<string>();
        using var vm = new SmallMultiplesChartViewModel(
            new SmallMultiplesChartStore(), PassthroughLocalizer.Instance, null, new SmallMultiplesChartDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.NotifyOpened();

        Assert.Equal("view.opened slug=SmallMultiplesChart", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_the_series_content()
    {
        var lines = new List<string>();
        var store = new SmallMultiplesChartStore(
            [Sample(1, ("vin_5YJ_secret", 42))], [Series("vin_5YJ_secret", label: "private label")]);
        using var vm = new SmallMultiplesChartViewModel(
            store, PassthroughLocalizer.Instance, null, new SmallMultiplesChartDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("vin_5YJ_secret", line, StringComparison.Ordinal);
            Assert.DoesNotContain("private label", line, StringComparison.Ordinal);
            Assert.DoesNotContain("42", line, StringComparison.Ordinal);
        });
    }

    // ── Default time formatter (web useDateFormat().formatTime) ──────────────────────────────────────────

    [Fact]
    public void Default_time_formatter_renders_a_finite_instant_and_falls_back_on_non_finite()
    {
        var formatter = SmallMultiplesTimeFormatter.Instance;

        var formatted = formatter.FormatTime(DateTimeOffset.FromUnixTimeMilliseconds(1_700_000_000_000).ToUnixTimeMilliseconds());

        Assert.False(string.IsNullOrEmpty(formatted));
        Assert.NotEqual("\u2014", formatted);
        Assert.Equal("\u2014", formatter.FormatTime(double.NaN));
    }

    // ── Lifecycle + argument validation ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Disposed_view_model_unsubscribes_and_ignores_further_selects()
    {
        string? clicked = null;
        var store = new SmallMultiplesChartStore([], [Series("a")], onCellClick: key => clicked = key);
        var vm = new SmallMultiplesChartViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Dispose();
        vm.SelectCell("a");
        store.Replace([Sample(1, ("a", 1))], [Series("a")]);

        Assert.Null(clicked);
        Assert.Empty(changed);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new SmallMultiplesChartViewModel(new SmallMultiplesChartStore(), PassthroughLocalizer.Instance);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        var store = new SmallMultiplesChartStore();

        Assert.Throws<ArgumentNullException>(() => new SmallMultiplesChartViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new SmallMultiplesChartViewModel(store, null!));
    }

    // ── Registration metadata is stable and matches the web catalogue ────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SmallMultiplesChart", SmallMultiplesChartRegistration.Slug);
        Assert.Equal("SmallMultiplesChart", SmallMultiplesChartViewModel.Slug);
        Assert.Equal("small-multiples-chart-root", SmallMultiplesChartRegistration.RootAutomationId);
    }

    [Fact]
    public void Registration_key_and_defaults_match_the_web_source()
    {
        Assert.Equal("smallMultiples.noData", SmallMultiplesChartRegistration.NoDataKey);
        Assert.Equal("No data", SmallMultiplesChartRegistration.NoDataFallback);
        Assert.Equal(280, SmallMultiplesChartRegistration.DefaultCellMinWidth);
        Assert.Equal(120, SmallMultiplesChartRegistration.DefaultCellHeight);
        Assert.Equal(400, SmallMultiplesChartRegistration.DefaultMaxPointsPerCell);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static SmallMultiplesSample Sample(long unixMilliseconds, params (string Key, double Value)[] values) =>
        new()
        {
            Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(unixMilliseconds),
            Values = values.ToDictionary(v => v.Key, v => v.Value),
        };

    private static SmallMultiplesSeries Series(string key, string? label = null, int? color = null) =>
        new() { Key = key, Label = label, ColorIndex = color };

    private sealed class TokenTimeFormatter : ISmallMultiplesTimeFormatter
    {
        public string FormatTime(double unixMilliseconds) =>
            "t" + unixMilliseconds.ToString(CultureInfo.InvariantCulture);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<(string Key, string Fallback)> Requests { get; } = [];

        public string GetString(string key, string fallback)
        {
            Requests.Add((key, fallback));
            return fallback;
        }
    }
}
