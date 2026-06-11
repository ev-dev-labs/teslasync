using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>ElevationProfile</c> shared surface's UI-thread-free logic — the pure
/// projection (gain/loss roll-up, cursor resolution, point + series build, the empty/populated branch and
/// every localized string), the data seam's change notifications, the view-model's state projection and
/// click→index output, the PII-safe diagnostics and the registration metadata. Mirrors the web spec
/// (web/src/components/charts/ElevationProfile.tsx). The WinUI view itself (the <see cref="ElevationProfile"/>
/// chart container, canvas rendering, cursor line and hover tooltip) is exercised by the app build.
/// </summary>
public sealed class ElevationProfileTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // elevations 100 → 150 → 120 → 200: gains 50 + 80 = 130, loss |120-150| = 30.
    private static IReadOnlyList<ElevationSample> Route() =>
    [
        new(Index: 0, Distance: 0.0, Elevation: 100),
        new(Index: 1, Distance: 1.0, Elevation: 150),
        new(Index: 2, Distance: 2.0, Elevation: 120),
        new(Index: 3, Distance: 3.0, Elevation: 200),
    ];

    // Original indices deliberately differ from array positions so click-mapping is unambiguous.
    private static IReadOnlyList<ElevationSample> OffsetRoute() =>
    [
        new(Index: 10, Distance: 0.0, Elevation: 100),
        new(Index: 20, Distance: 5.0, Elevation: 130),
        new(Index: 30, Distance: 9.0, Elevation: 110),
    ];

    // ── Projection (the adapter): empty branch (web data.length === 0) ───────────────────────────────────

    [Fact]
    public void Project_with_no_samples_is_the_empty_state()
    {
        var display = ElevationProfileProjection.Project([], currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Equal(ElevationProfileState.Empty, display.State);
        Assert.True(display.IsEmpty);
        Assert.Empty(display.Points);
        Assert.Equal(0, display.GainMeters);
        Assert.Equal(0, display.LossMeters);
        Assert.Equal(string.Empty, display.Subtitle);
        Assert.Null(display.CursorDistance);
        Assert.Null(display.CursorIndex);
    }

    [Fact]
    public void Project_treats_a_null_series_as_empty()
    {
        var display = ElevationProfileProjection.Project(null, currentIndex: 2, distanceUnit: null, Localizer);

        Assert.Equal(ElevationProfileState.Empty, display.State);
        Assert.Equal(ElevationProfileRegistration.DefaultDistanceUnit, display.DistanceUnit);
    }

    // ── Projection: populated branch — gain/loss roll-up + subtitle (web elevGain + ↑…↓… subtitle) ───────

    [Fact]
    public void Project_with_samples_is_the_ready_state_with_points()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Equal(ElevationProfileState.Ready, display.State);
        Assert.False(display.IsEmpty);
        Assert.Equal(4, display.Points.Count);
        Assert.Equal(new ChartPoint(0.0, 100), display.Points[0]);
        Assert.Equal(new ChartPoint(3.0, 200), display.Points[3]);
    }

    [Fact]
    public void Project_accumulates_gain_and_loss_from_consecutive_deltas()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Equal(130, display.GainMeters);
        Assert.Equal(30, display.LossMeters);
    }

    [Fact]
    public void Project_formats_the_gain_loss_subtitle_like_the_web()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        // web: `↑ ${gain}m  ↓ ${loss}m` (two spaces between the two figures).
        Assert.Equal("\u2191 130m  \u2193 30m", display.Subtitle);
    }

    [Fact]
    public void Project_rounds_fractional_gain_and_loss()
    {
        IReadOnlyList<ElevationSample> samples =
        [
            new(0, 0.0, 100.4),
            new(1, 1.0, 101.0), // +0.6 gain
            new(2, 2.0, 100.1), // -0.9 loss
        ];

        var display = ElevationProfileProjection.Project(samples, currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Equal(1, display.GainMeters);
        Assert.Equal(1, display.LossMeters);
    }

    // ── Projection: cursor resolution (web cursorDistance memo) ──────────────────────────────────────────

    [Fact]
    public void Project_resolves_the_cursor_distance_for_an_in_range_index()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: 2, distanceUnit: "km", Localizer);

        Assert.Equal(2.0, display.CursorDistance);
        Assert.Equal(2, display.CursorIndex);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(4)]
    [InlineData(99)]
    public void Project_ignores_an_out_of_range_cursor_index(int index)
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: index, distanceUnit: "km", Localizer);

        Assert.Null(display.CursorDistance);
        Assert.Null(display.CursorIndex);
    }

    [Fact]
    public void Project_has_no_cursor_when_no_index_is_selected()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Null(display.CursorDistance);
        Assert.Null(display.CursorIndex);
    }

    // ── Projection: distance unit fallback (web distanceUnit = 'km') ─────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Project_falls_back_to_the_default_distance_unit(string? unit)
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: unit, Localizer);

        Assert.Equal("km", display.DistanceUnit);
    }

    [Fact]
    public void Project_keeps_an_explicit_distance_unit()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "mi", Localizer);

        Assert.Equal("mi", display.DistanceUnit);
    }

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() =>
            ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", null!));

    // ── Projection: the chart series (web Area, #10b981) ─────────────────────────────────────────────────

    [Fact]
    public void BuildSeries_is_an_emerald_elevation_area_in_metres()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        var series = ElevationProfileProjection.BuildSeries(display, "Elevation");

        Assert.Equal("Elevation", series.Name);
        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(ChartRole.Regen, series.Role);
        Assert.Equal("m", series.Unit);
        Assert.Equal(0, series.Decimals);
        Assert.Equal(display.Points, series.Points);
    }

    [Fact]
    public void BuildSeries_validates_its_arguments()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Throws<ArgumentNullException>(() => ElevationProfileProjection.BuildSeries(null!, "Elevation"));
        Assert.Throws<ArgumentException>(() => ElevationProfileProjection.BuildSeries(display, string.Empty));
    }

    // ── Accessibility / i18n: every label resolves through the facade (web replay.elevation.* keys) ──────

    [Fact]
    public void Empty_state_exposes_the_no_data_accessible_summary()
    {
        var display = ElevationProfileProjection.Project([], currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Equal("Elevation profile chart \u2014 no data available yet", display.AccessibleSummary);
        Assert.Equal("No elevation data available", display.EmptyMessage);
        Assert.Equal("Elevation Profile", display.Title);
    }

    [Fact]
    public void Ready_state_exposes_the_route_summary_accessible_label()
    {
        var display = ElevationProfileProjection.Project(Route(), currentIndex: null, distanceUnit: "km", Localizer);

        Assert.Equal(
            "Elevation profile chart along the route, with total gain and loss in meters",
            display.AccessibleSummary);
        Assert.Equal("Elevation Profile", display.Title);
        Assert.Equal("Elevation", display.ElevationLabel);
        Assert.Equal("m", display.ElevationAxisLabel);
    }

    // ── View-model: per-state projection over the seam ───────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_empty_when_the_source_has_no_samples()
    {
        using var vm = new ElevationProfileViewModel(new ElevationProfileSource(), Localizer);

        Assert.Equal(ElevationProfileState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No elevation data available", vm.EmptyMessage);
        Assert.Equal("Elevation Profile", vm.Title);
    }

    [Fact]
    public void ViewModel_is_ready_when_the_source_has_samples()
    {
        var source = new ElevationProfileSource(Route(), currentIndex: 1, distanceUnit: "km");
        using var vm = new ElevationProfileViewModel(source, Localizer);

        Assert.Equal(ElevationProfileState.Ready, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("\u2191 130m  \u2193 30m", vm.Subtitle);
        Assert.Equal(1.0, vm.Display.CursorDistance);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_the_source_changes()
    {
        var source = new ElevationProfileSource();
        using var vm = new ElevationProfileViewModel(source, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetData(Route());

        Assert.Equal(ElevationProfileState.Ready, vm.State);
        Assert.Contains(nameof(ElevationProfileViewModel.Display), changed);
        Assert.Contains(nameof(ElevationProfileViewModel.State), changed);
    }

    [Fact]
    public void ViewModel_returns_to_empty_when_the_series_is_cleared()
    {
        var source = new ElevationProfileSource(Route());
        using var vm = new ElevationProfileViewModel(source, Localizer);
        Assert.Equal(ElevationProfileState.Ready, vm.State);

        source.SetData([]);

        Assert.Equal(ElevationProfileState.Empty, vm.State);
    }

    [Fact]
    public void ViewModel_moves_the_cursor_when_the_current_index_changes()
    {
        var source = new ElevationProfileSource(Route());
        using var vm = new ElevationProfileViewModel(source, Localizer);
        Assert.Null(vm.Display.CursorDistance);

        source.SetCurrentIndex(3);

        Assert.Equal(3.0, vm.Display.CursorDistance);
        Assert.Equal(3, vm.Display.CursorIndex);
    }

    // ── View-model: click → original index (web onClickIndex(data[idx].index)) ──────────────────────────

    [Fact]
    public void RequestSelect_raises_the_samples_original_index()
    {
        var source = new ElevationProfileSource(OffsetRoute());
        using var vm = new ElevationProfileViewModel(source, Localizer);
        var selected = new List<int>();
        vm.IndexSelected += (_, index) => selected.Add(index);

        vm.RequestSelect(0);
        vm.RequestSelect(2);

        Assert.Equal([10, 30], selected);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(3)]
    [InlineData(100)]
    public void RequestSelect_ignores_an_out_of_range_position(int position)
    {
        var source = new ElevationProfileSource(OffsetRoute());
        using var vm = new ElevationProfileViewModel(source, Localizer);
        var selected = new List<int>();
        vm.IndexSelected += (_, index) => selected.Add(index);

        vm.RequestSelect(position);

        Assert.Empty(selected);
    }

    // ── View-model: argument validation + lifecycle ──────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new ElevationProfileSource();

        Assert.Throws<ArgumentNullException>(() => new ElevationProfileViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new ElevationProfileViewModel(source, null!));
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new ElevationProfileSource();
        var vm = new ElevationProfileViewModel(source, Localizer);

        vm.Dispose();
        source.SetData(Route());

        Assert.Equal(ElevationProfileState.Empty, vm.State);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new ElevationProfileViewModel(new ElevationProfileSource(), Localizer);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_slug_matches_the_registration() =>
        Assert.Equal(ElevationProfileRegistration.Slug, ElevationProfileViewModel.Slug);

    // ── Source seam: change notifications ────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_raises_changed_on_set_data()
    {
        var source = new ElevationProfileSource();
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetData(Route(), "mi");

        Assert.Equal(1, raised);
        Assert.Equal(4, source.Samples.Count);
        Assert.Equal("mi", source.DistanceUnit);
    }

    [Fact]
    public void Source_treats_null_samples_as_empty()
    {
        var source = new ElevationProfileSource(Route());

        source.SetData(null!);

        Assert.Empty(source.Samples);
    }

    [Fact]
    public void Source_raises_changed_only_when_the_cursor_actually_moves()
    {
        var source = new ElevationProfileSource(Route());
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.SetCurrentIndex(2);
        source.SetCurrentIndex(2); // no-op
        source.SetCurrentIndex(null);

        Assert.Equal(2, raised);
        Assert.Null(source.CurrentIndex);
    }

    [Fact]
    public void Source_defaults_to_the_canonical_distance_unit()
    {
        var source = new ElevationProfileSource();

        Assert.Equal("km", source.DistanceUnit);
        Assert.Empty(source.Samples);
        Assert.Null(source.CurrentIndex);
    }

    // ── Registration + diagnostics (P1/S11): slug-only, never sample values ─────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ElevationProfile", ElevationProfileRegistration.Slug);

    [Fact]
    public void Registration_exposes_the_localized_title() =>
        Assert.Equal("Elevation Profile", ElevationProfileRegistration.Title(Localizer));

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ElevationProfileDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ElevationProfile", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new ElevationProfileDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_leak_sample_values()
    {
        var lines = new List<string>();
        var diagnostics = new ElevationProfileDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("100", line, StringComparison.Ordinal);
            Assert.DoesNotContain("200", line, StringComparison.Ordinal);
        });
    }
}
