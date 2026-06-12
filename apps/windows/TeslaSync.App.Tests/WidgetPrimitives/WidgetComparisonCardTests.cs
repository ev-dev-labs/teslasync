using System.Collections.Generic;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the <c>WidgetComparisonCard</c> widget primitive's UI-thread-free logic — the pure
/// projection (the compact slice, the empty-vs-populated branches, the per-row label / value / unit normalisation
/// and the trailing delta inputs), the data seam's change notifications, the view-model's state projection, the
/// PII-safe diagnostics, the registration metadata and the row accessibility names. The composition cases mirror
/// the web source (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx) one-for-one. The WinUI view
/// itself (the row grid, the hairline dividers, the embedded <c>Delta</c> controls and the brushes) is exercised
/// by the app build.
/// </summary>
public sealed class WidgetComparisonCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ComparisonMetric Metric(
        string label,
        double current,
        double previous,
        string formattedCurrent,
        string? unit = null,
        bool higherIsBetter = true) =>
        new()
        {
            Label = label,
            Current = current,
            Previous = previous,
            FormattedCurrent = formattedCurrent,
            Unit = unit,
            HigherIsBetter = higherIsBetter,
        };

    private static WidgetComparisonCardInput Input(bool compact, params ComparisonMetric[] metrics) =>
        new() { Metrics = metrics, Compact = compact };

    private static WidgetComparisonCardDisplay Project(WidgetComparisonCardInput input) =>
        WidgetComparisonCardProjection.Project(input, Localizer);

    // ── Empty branch (web L52-L56) ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void No_metrics_renders_the_empty_branch()
    {
        var d = Project(Input(compact: false));

        Assert.True(d.IsEmpty);
        Assert.Empty(d.Rows);
        Assert.Equal("No comparison data", d.EmptyMessage);
        Assert.Equal("No comparison data", d.AccessibleName);
    }

    [Fact]
    public void Null_metric_list_renders_the_empty_branch()
    {
        var d = Project(new WidgetComparisonCardInput { Metrics = null! });

        Assert.True(d.IsEmpty);
        Assert.Empty(d.Rows);
    }

    [Fact]
    public void Null_entries_are_skipped_and_an_all_null_list_is_empty()
    {
        var d = Project(new WidgetComparisonCardInput { Metrics = new ComparisonMetric[] { null!, null! } });

        Assert.True(d.IsEmpty);
    }

    [Fact]
    public void Compact_with_no_metrics_is_still_empty()
    {
        var d = Project(Input(compact: true));

        Assert.True(d.IsEmpty);
    }

    // ── Compact slice (web L50) ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Compact_shows_only_the_first_two_metrics()
    {
        var d = Project(Input(
            compact: true,
            Metric("Distance", 100, 90, "100 mi"),
            Metric("Efficiency", 250, 260, "250 Wh/mi"),
            Metric("Cost", 12, 10, "$12")));

        Assert.False(d.IsEmpty);
        Assert.True(d.Compact);
        Assert.Equal(2, d.Rows.Count);
        Assert.Equal("Distance", d.Rows[0].Label);
        Assert.Equal("Efficiency", d.Rows[1].Label);
    }

    [Fact]
    public void Non_compact_shows_every_metric()
    {
        var d = Project(Input(
            compact: false,
            Metric("Distance", 100, 90, "100 mi"),
            Metric("Efficiency", 250, 260, "250 Wh/mi"),
            Metric("Cost", 12, 10, "$12")));

        Assert.Equal(3, d.Rows.Count);
        Assert.False(d.Compact);
    }

    [Fact]
    public void Compact_with_two_or_fewer_metrics_shows_them_all()
    {
        var d = Project(Input(compact: true, Metric("Distance", 100, 90, "100 mi")));

        Assert.Single(d.Rows);
        Assert.Equal("Distance", d.Rows[0].Label);
    }

    [Fact]
    public void Compact_visible_limit_is_two() =>
        Assert.Equal(2, WidgetComparisonCardRegistration.CompactVisibleLimit);

    // ── Row projection (web MetricRow L18-L44) ───────────────────────────────────────────────────────────

    [Fact]
    public void Row_carries_the_label_value_and_unit()
    {
        var d = Project(Input(false, Metric("Efficiency", 250, 260, "250", unit: "Wh/mi")));
        var row = d.Rows[0];

        Assert.Equal("Efficiency", row.Label);
        Assert.Equal("250", row.FormattedCurrent);
        Assert.Equal("Wh/mi", row.Unit);
        Assert.True(row.HasUnit);
    }

    [Fact]
    public void Row_without_a_unit_has_no_unit()
    {
        var d = Project(Input(false, Metric("Drives", 12, 10, "12")));
        var row = d.Rows[0];

        Assert.Equal(string.Empty, row.Unit);
        Assert.False(row.HasUnit);
    }

    [Fact]
    public void Blank_formatted_value_falls_back_to_an_em_dash()
    {
        var d = Project(Input(false, Metric("Range", 0, 0, formattedCurrent: "")));

        Assert.Equal(WidgetComparisonCardRegistration.EmDash, d.Rows[0].FormattedCurrent);
    }

    [Fact]
    public void Null_label_normalises_to_empty()
    {
        var d = Project(Input(false, new ComparisonMetric { Current = 1, Previous = 1, FormattedCurrent = "1" }));

        Assert.Equal(string.Empty, d.Rows[0].Label);
    }

    // ── Trailing delta inputs (web <Delta metric={{direction}} display="percent" size="sm" />, L35-L41) ────

    [Fact]
    public void Higher_is_better_maps_to_a_higher_better_delta()
    {
        var d = Project(Input(false, Metric("Range", 280, 250, "280 mi", higherIsBetter: true)));
        DeltaInput delta = d.Rows[0].DeltaInput;

        Assert.Equal(MetricDirection.HigherBetter, delta.Metric.Direction);
        Assert.Equal(DeltaMetricUnit.None, delta.Metric.Unit);
        Assert.Equal(DeltaDisplayMode.Percent, delta.Display);
        Assert.Equal(DeltaSize.Sm, delta.Size);
        Assert.Equal(280, delta.Current);
        Assert.Equal(250, delta.Previous);
    }

    [Fact]
    public void Lower_is_better_maps_to_a_lower_better_delta()
    {
        var d = Project(Input(false, Metric("Cost", 12, 10, "$12", higherIsBetter: false)));

        Assert.Equal(MetricDirection.LowerBetter, d.Rows[0].DeltaInput.Metric.Direction);
    }

    [Fact]
    public void Default_metric_direction_is_higher_better()
    {
        // web L19: higherIsBetter ?? true.
        var d = Project(Input(false, new ComparisonMetric { Label = "X", Current = 2, Previous = 1, FormattedCurrent = "2" }));

        Assert.Equal(MetricDirection.HigherBetter, d.Rows[0].DeltaInput.Metric.Direction);
    }

    [Fact]
    public void Row_delta_projects_a_positive_percent_for_a_good_increase()
    {
        var d = Project(Input(false, Metric("Range", 280, 250, "280 mi", higherIsBetter: true)));

        DeltaDisplay delta = DeltaProjection.Project(d.Rows[0].DeltaInput, DeltaUnitContext.Metric, Localizer);

        Assert.Equal(DeltaState.Value, delta.State);
        Assert.Equal(DeltaTone.Positive, delta.Tone);
        Assert.Equal("12.0%", delta.PrimaryText);
    }

    [Fact]
    public void Row_delta_projects_a_negative_percent_for_a_bad_increase()
    {
        var d = Project(Input(false, Metric("Cost", 12, 10, "$12", higherIsBetter: false)));

        DeltaDisplay delta = DeltaProjection.Project(d.Rows[0].DeltaInput, DeltaUnitContext.Metric, Localizer);

        Assert.Equal(DeltaTone.Negative, delta.Tone);
        Assert.Equal("20.0%", delta.PrimaryText);
    }

    // ── Accessibility names ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Row_accessible_name_includes_the_label_value_and_unit()
    {
        var d = Project(Input(false, Metric("Efficiency", 250, 260, "250", unit: "Wh/mi")));

        Assert.Equal("Efficiency, 250 Wh/mi", d.Rows[0].AccessibleName);
    }

    [Fact]
    public void Row_accessible_name_omits_an_absent_unit()
    {
        var d = Project(Input(false, Metric("Drives", 12, 10, "12")));

        Assert.Equal("Drives, 12", d.Rows[0].AccessibleName);
    }

    [Fact]
    public void Every_row_exposes_a_non_empty_accessible_name()
    {
        var d = Project(Input(
            false,
            Metric("Distance", 100, 90, "100 mi"),
            Metric("Efficiency", 250, 260, "250", unit: "Wh/mi")));

        foreach (WidgetComparisonCardRow row in d.Rows)
        {
            Assert.False(string.IsNullOrWhiteSpace(row.AccessibleName));
        }
    }

    // ── Projection argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => WidgetComparisonCardProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            WidgetComparisonCardProjection.Project(new WidgetComparisonCardInput(), null!));
    }

    // ── Data seam (P1/S8) ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Default_source_is_empty_and_non_compact()
    {
        var source = new WidgetComparisonCardSource();

        Assert.Empty(source.Input.Metrics);
        Assert.False(source.Input.Compact);
    }

    [Fact]
    public void Source_set_metrics_raises_changed()
    {
        var source = new WidgetComparisonCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetMetrics(new[] { Metric("Distance", 100, 90, "100 mi") });

        Assert.Single(source.Input.Metrics);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Source_set_compact_raises_changed_only_on_a_real_change()
    {
        var source = new WidgetComparisonCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetCompact(true);
        source.SetCompact(true);

        Assert.True(source.Input.Compact);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Source_set_input_replaces_the_whole_input()
    {
        var source = new WidgetComparisonCardSource();

        source.SetInput(Input(true, Metric("Cost", 12, 10, "$12")));

        Assert.True(source.Input.Compact);
        Assert.Single(source.Input.Metrics);
    }

    [Fact]
    public void Source_null_assignments_fall_back_to_safe_defaults()
    {
        var source = new WidgetComparisonCardSource(null!);
        Assert.NotNull(source.Input);

        source.SetMetrics(null!);
        Assert.Empty(source.Input.Metrics);

        source.SetInput(null!);
        Assert.NotNull(source.Input);
        Assert.Empty(source.Input.Metrics);
    }

    // ── View-model ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new WidgetComparisonCardSource(Input(false, Metric("Range", 280, 250, "280 mi")));
        using var vm = new WidgetComparisonCardViewModel(source, Localizer);

        Assert.False(vm.IsEmpty);
        Assert.Single(vm.Display.Rows);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_metrics_change()
    {
        var source = new WidgetComparisonCardSource();
        using var vm = new WidgetComparisonCardViewModel(source, Localizer);
        Assert.True(vm.IsEmpty);

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetMetrics(new[] { Metric("Range", 280, 250, "280 mi") });

        Assert.False(vm.IsEmpty);
        Assert.Single(vm.Display.Rows);
        Assert.Contains(nameof(WidgetComparisonCardViewModel.Display), changed);
        Assert.Contains(nameof(WidgetComparisonCardViewModel.IsEmpty), changed);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new WidgetComparisonCardSource();
        var vm = new WidgetComparisonCardViewModel(source, Localizer);

        vm.Dispose();
        source.SetMetrics(new[] { Metric("Range", 280, 250, "280 mi") });

        Assert.True(vm.IsEmpty);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new WidgetComparisonCardViewModel(new WidgetComparisonCardSource(), Localizer);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new WidgetComparisonCardViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            new WidgetComparisonCardViewModel(new WidgetComparisonCardSource(), null!));
    }

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_view_opened_increments_and_emits_the_slug()
    {
        var events = new List<string>();
        var diagnostics = new WidgetComparisonCardDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetComparisonCard", Assert.Single(events));
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug() =>
        Assert.Equal("WidgetComparisonCard", WidgetComparisonCardRegistration.Slug);

    [Fact]
    public void Empty_message_uses_the_shared_delta_no_comparison_key()
    {
        Assert.Equal(DeltaRegistration.NoComparisonKey, WidgetComparisonCardRegistration.NoComparisonKey);
        Assert.Equal("No comparison data", WidgetComparisonCardRegistration.NoComparison(Localizer));
    }
}
