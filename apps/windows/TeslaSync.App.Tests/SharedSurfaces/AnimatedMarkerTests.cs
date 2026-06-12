using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>AnimatedMarker</c> shared surface's UI-thread-free logic — the marker-fix
/// adapter (<see cref="AnimatedMarkerSample.FromRepositoryResult{T}"/>), the pure per-state projection (the
/// loading / empty / error / stale / offline / live branches with their marker placement, dimming, heading
/// pointer, pulse gating, chrome flags, localized labels and accessible name), the keep-in-view pan geometry, the
/// P1/S8 live-position and map seams, the view-model's reproject + pan side-effect + retry, the PII-safe
/// diagnostics and the registration metadata. The composition mirrors the web source
/// (web/src/components/maps/AnimatedMarker.tsx). The WinUI view itself (the pulsing halo, the rotated pointer, the
/// centered chrome) is exercised by the app build.
/// </summary>
public sealed class AnimatedMarkerTests
{
    private sealed record Fix(double Lat, double Lng, double? Heading = null, string? Accent = null);

    private static AnimatedMarkerProjection Project(LoadState<AnimatedMarkerSample> state, bool reduceMotion = false) =>
        AnimatedMarkerProjection.Project(state, reduceMotion, PassthroughLocalizer.Instance);

    private static AnimatedMarkerSample Sample(double? heading = null, string? accent = null) =>
        AnimatedMarkerSample.At(37.7749, -122.4194, heading, accent);

    private static LoadState<AnimatedMarkerSample> Loading() => new LoadState<AnimatedMarkerSample>.Loading();

    private static LoadState<AnimatedMarkerSample> Live(double? heading = null, string? accent = null) =>
        new LoadState<AnimatedMarkerSample>.Loaded(Sample(heading, accent), DateTimeOffset.UtcNow);

    // ── Sample: tint / heading helpers ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Sample_resolves_default_accent_when_none_supplied()
    {
        Assert.Equal(AnimatedMarkerRegistration.DefaultAccentBrushKey, Sample().ResolvedAccentBrushKey);
        Assert.Equal("TsColorBrandBrush", AnimatedMarkerSample.At(0, 0, accentBrushKey: "TsColorBrandBrush").ResolvedAccentBrushKey);
    }

    [Fact]
    public void Sample_has_heading_only_for_finite_values()
    {
        Assert.False(Sample().HasHeading);
        Assert.True(Sample(90).HasHeading);
        Assert.False(AnimatedMarkerSample.At(0, 0, double.NaN).HasHeading);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(90, 90)]
    [InlineData(360, 0)]
    [InlineData(450, 90)]
    [InlineData(-90, 270)]
    public void Sample_normalizes_heading_into_0_360(double input, double expected)
    {
        Assert.Equal(expected, Sample(input).NormalizedHeading);
    }

    // ── Adapter: FromRepositoryResult (cached/value-bearing vs non-value) ─────────────────────────────────

    [Fact]
    public void FromRepositoryResult_maps_value_and_preserves_status()
    {
        var result = RepositoryResult<Fix>.Cached(new Fix(10, 20, 45, "TsColorWarningBrush"), DateTimeOffset.UtcNow, stale: true);

        var mapped = AnimatedMarkerSample.FromRepositoryResult(
            result, f => new GeoPoint(f.Lat, f.Lng), f => f.Heading, f => f.Accent);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.NotNull(mapped.Value);
        Assert.Equal(10, mapped.Value!.Position.Lat);
        Assert.Equal(20, mapped.Value.Position.Lng);
        Assert.Equal(45, mapped.Value.Heading);
        Assert.Equal("TsColorWarningBrush", mapped.Value.AccentBrushKey);
    }

    [Fact]
    public void FromRepositoryResult_drops_value_for_non_value_states()
    {
        var loading = AnimatedMarkerSample.FromRepositoryResult(RepositoryResult<Fix>.Loading(), f => new GeoPoint(f.Lat, f.Lng));
        Assert.Equal(LoadStatus.Loading, loading.Status);
        Assert.Null(loading.Value);

        var empty = AnimatedMarkerSample.FromRepositoryResult(RepositoryResult<Fix>.Empty(), f => new GeoPoint(f.Lat, f.Lng));
        Assert.Equal(LoadStatus.Empty, empty.Status);
        Assert.Null(empty.Value);
    }

    [Fact]
    public void FromRepositoryResult_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() =>
            AnimatedMarkerSample.FromRepositoryResult<Fix>(null!, f => new GeoPoint(f.Lat, f.Lng)));
        Assert.Throws<ArgumentNullException>(() =>
            AnimatedMarkerSample.FromRepositoryResult(RepositoryResult<Fix>.Loading(), null!));
    }

    // ── Projection: per-state snapshots (every state renders, none hidden) ────────────────────────────────

    [Fact]
    public void Loading_state_shows_the_spinner_only()
    {
        var p = Project(Loading());

        Assert.Equal(AnimatedMarkerVisualState.Loading, p.State);
        Assert.False(p.ShowMarker);
        Assert.True(p.ShowSpinner);
        Assert.False(p.ShowEmptyPanel);
        Assert.False(p.ShowErrorPanel);
        Assert.False(p.HasPosition);
        Assert.Equal(AnimatedMarkerRegistration.LoadingFallback, p.StatusLabel);
    }

    [Fact]
    public void Empty_state_shows_the_friendly_empty_panel()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Empty());

        Assert.Equal(AnimatedMarkerVisualState.Empty, p.State);
        Assert.False(p.ShowMarker);
        Assert.False(p.ShowSpinner);
        Assert.True(p.ShowEmptyPanel);
        Assert.False(p.ShowErrorPanel);
        Assert.Equal(AnimatedMarkerRegistration.EmptyFallback, p.StatusLabel);
    }

    [Fact]
    public void Error_state_shows_the_error_panel_with_retry()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Error(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        Assert.Equal(AnimatedMarkerVisualState.Error, p.State);
        Assert.True(p.ShowErrorPanel);
        Assert.True(p.ShowRetry);
        Assert.False(p.ShowMarker);
        Assert.Equal(AnimatedMarkerRegistration.ErrorFallback, p.StatusLabel);
        Assert.Equal(AnimatedMarkerRegistration.RetryFallback, p.RetryLabel);
        Assert.Equal("TsColorDangerBrush", p.StatusAccentBrushKey);
    }

    [Fact]
    public void Stale_state_shows_a_dimmed_marker_and_stale_chip()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Cached(Sample(), DateTimeOffset.UtcNow, Stale: true));

        Assert.Equal(AnimatedMarkerVisualState.Stale, p.State);
        Assert.True(p.ShowMarker);
        Assert.True(p.HasPosition);
        Assert.Equal(AnimatedMarkerRegistration.StaleMarkerOpacity, p.MarkerOpacity);
        Assert.False(p.ShowPulse);
        Assert.Equal(AnimatedMarkerRegistration.StaleFallback, p.StatusLabel);
        Assert.Equal("TsColorWarningBrush", p.StatusAccentBrushKey);
    }

    [Fact]
    public void Offline_with_cache_shows_a_dimmed_marker_and_offline_chip()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Offline(Sample(), new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(AnimatedMarkerVisualState.Offline, p.State);
        Assert.True(p.ShowMarker);
        Assert.Equal(AnimatedMarkerRegistration.OfflineMarkerOpacity, p.MarkerOpacity);
        Assert.False(p.ShowPulse);
        Assert.Equal(AnimatedMarkerRegistration.OfflineFallback, p.StatusLabel);
        Assert.Equal("TsColorDangerBrush", p.StatusAccentBrushKey);
    }

    [Fact]
    public void Offline_without_cache_falls_back_to_a_centered_panel()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Offline(null, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(AnimatedMarkerVisualState.Offline, p.State);
        Assert.False(p.ShowMarker);
        Assert.True(p.ShowEmptyPanel);
        Assert.Equal(AnimatedMarkerRegistration.OfflineFallback, p.StatusLabel);
    }

    [Fact]
    public void Live_state_shows_the_pulsing_marker()
    {
        var p = Project(Live());

        Assert.Equal(AnimatedMarkerVisualState.Live, p.State);
        Assert.True(p.ShowMarker);
        Assert.Equal(1.0, p.MarkerOpacity);
        Assert.True(p.ShowPulse);
        Assert.Equal(AnimatedMarkerRegistration.LiveFallback, p.StatusLabel);
        Assert.Equal("TsColorSuccessBrush", p.StatusAccentBrushKey);
    }

    [Fact]
    public void Cached_when_not_stale_is_live()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Cached(Sample(), DateTimeOffset.UtcNow, Stale: false));
        Assert.Equal(AnimatedMarkerVisualState.Live, p.State);
    }

    [Fact]
    public void Refreshing_when_stale_is_stale()
    {
        var p = Project(new LoadState<AnimatedMarkerSample>.Refreshing(Sample(), DateTimeOffset.UtcNow, Stale: true));
        Assert.Equal(AnimatedMarkerVisualState.Stale, p.State);
    }

    // ── Projection: reduced-motion pulse gating (the prefers-reduced-motion contract) ────────────────────

    [Fact]
    public void Pulse_is_suppressed_under_reduced_motion()
    {
        Assert.True(Project(Live(), reduceMotion: false).ShowPulse);
        Assert.False(Project(Live(), reduceMotion: true).ShowPulse);
    }

    [Fact]
    public void Only_the_live_state_pulses()
    {
        Assert.False(Project(new LoadState<AnimatedMarkerSample>.Cached(Sample(), DateTimeOffset.UtcNow, Stale: true)).ShowPulse);
        Assert.False(Project(Loading()).ShowPulse);
    }

    // ── Projection: heading pointer (web rotate(${heading}deg)) ───────────────────────────────────────────

    [Fact]
    public void Heading_pointer_shows_and_rotates_when_a_live_fix_has_a_heading()
    {
        var p = Project(Live(heading: 90));

        Assert.True(p.HasHeading);
        Assert.True(p.ShowHeadingArrow);
        Assert.Equal(90, p.HeadingDegrees);
        Assert.Contains("90", p.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Heading_pointer_is_hidden_when_no_heading_is_known()
    {
        var p = Project(Live());

        Assert.False(p.HasHeading);
        Assert.False(p.ShowHeadingArrow);
        Assert.Equal(0, p.HeadingDegrees);
    }

    [Fact]
    public void Heading_is_not_drawn_without_a_marker_even_if_present()
    {
        // A loading state carries no fix, so a heading can never leak a pointer onto a non-existent marker.
        Assert.False(Project(Loading()).ShowHeadingArrow);
    }

    [Fact]
    public void Live_marker_tint_uses_the_sample_accent_override()
    {
        var p = Project(Live(accent: "TsColorWarningBrush"));
        Assert.Equal("TsColorWarningBrush", p.AccentBrushKey);
    }

    // ── Projection: accessibility name is always present ─────────────────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_accessible_name()
    {
        var states = new LoadState<AnimatedMarkerSample>[]
        {
            Loading(),
            new LoadState<AnimatedMarkerSample>.Empty(),
            new LoadState<AnimatedMarkerSample>.Error(new RepositoryError(RepositoryErrorKind.Unknown, "x")),
            new LoadState<AnimatedMarkerSample>.Cached(Sample(), DateTimeOffset.UtcNow, Stale: true),
            new LoadState<AnimatedMarkerSample>.Offline(Sample(), new RepositoryError(RepositoryErrorKind.Network, "x")),
            Live(heading: 12),
        };

        foreach (var state in states)
        {
            Assert.False(string.IsNullOrWhiteSpace(Project(state).AutomationName));
        }
    }

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => AnimatedMarkerProjection.Project(null!, false, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => AnimatedMarkerProjection.Project(Loading(), false, null!));
    }

    // ── Geometry: keep-in-view pan decision (web !getBounds().contains) ───────────────────────────────────

    [Fact]
    public void Pan_is_requested_only_when_the_fix_is_outside_the_visible_bounds()
    {
        var inside = new GeoBounds(37.0, -123.0, 38.0, -122.0);
        Assert.False(AnimatedMarkerGeometry.ShouldPanToKeepInView(inside, new GeoPoint(37.7749, -122.4194)));

        var elsewhere = new GeoBounds(40.0, -75.0, 41.0, -73.0);
        Assert.True(AnimatedMarkerGeometry.ShouldPanToKeepInView(elsewhere, new GeoPoint(37.7749, -122.4194)));
    }

    [Fact]
    public void Pan_is_not_requested_for_an_invalid_viewport()
    {
        var invalid = new GeoBounds(double.NaN, double.NaN, double.NaN, double.NaN);
        Assert.False(AnimatedMarkerGeometry.ShouldPanToKeepInView(invalid, new GeoPoint(0, 0)));
    }

    // ── Source: static seam ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_defaults_to_loading()
    {
        Assert.IsType<LoadState<AnimatedMarkerSample>.Loading>(new StaticAnimatedMarkerSource().Current);
    }

    [Fact]
    public void Static_source_set_notifies_and_replaces()
    {
        var source = new StaticAnimatedMarkerSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(Live(heading: 5));

        Assert.Equal(1, changes);
        Assert.IsType<LoadState<AnimatedMarkerSample>.Loaded>(source.Current);
    }

    [Fact]
    public void Static_source_retry_counts_and_notifies()
    {
        var source = new StaticAnimatedMarkerSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.Retry();
        source.Retry();

        Assert.Equal(2, source.RetryCount);
        Assert.Equal(2, changes);
    }

    [Fact]
    public async Task Repository_source_streams_a_live_fix()
    {
        using var source = new RepositoryAnimatedMarkerSource<Fix>(
            ct => StreamAsync(ct, RepositoryResult<Fix>.Loaded(new Fix(1, 2, 90), DateTimeOffset.UtcNow)),
            f => new GeoPoint(f.Lat, f.Lng),
            f => f.Heading,
            f => f.Accent);

        await WaitForAsync(() => source.Current is LoadState<AnimatedMarkerSample>.Loaded);

        var loaded = Assert.IsType<LoadState<AnimatedMarkerSample>.Loaded>(source.Current);
        Assert.Equal(1, loaded.Value.Position.Lat);
        Assert.Equal(2, loaded.Value.Position.Lng);
        Assert.Equal(90, loaded.Value.Heading);
    }

    [Fact]
    public async Task Repository_source_surfaces_failure_as_error_state()
    {
        using var source = new RepositoryAnimatedMarkerSource<Fix>(
            ct => StreamAsync(ct, RepositoryResult<Fix>.Failure(new RepositoryError(RepositoryErrorKind.Server, "500"))),
            f => new GeoPoint(f.Lat, f.Lng));

        await WaitForAsync(() => source.Current is LoadState<AnimatedMarkerSample>.Error);

        Assert.IsType<LoadState<AnimatedMarkerSample>.Error>(source.Current);
    }

    [Fact]
    public void Repository_source_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new RepositoryAnimatedMarkerSource<Fix>(null!, f => new GeoPoint(f.Lat, f.Lng)));
        Assert.Throws<ArgumentNullException>(() => new RepositoryAnimatedMarkerSource<Fix>(ct => StreamAsync(ct), null!));
    }

    // ── Source: map seam (the useMap analogue) ───────────────────────────────────────────────────────────

    [Fact]
    public void Static_map_defaults_to_world_bounds_and_records_pans()
    {
        var map = new StaticAnimatedMarkerMap();
        Assert.True(map.VisibleBounds.Contains(new GeoPoint(37.7749, -122.4194)));
        Assert.Equal(0, map.PanCount);

        map.PanTo(new GeoPoint(1, 2));

        Assert.Equal(1, map.PanCount);
        Assert.Equal(new GeoPoint(1, 2), map.LastPan);
    }

    [Fact]
    public void Static_map_bounds_can_be_narrowed()
    {
        var map = new StaticAnimatedMarkerMap(new GeoBounds(40.0, -75.0, 41.0, -73.0));
        Assert.False(map.VisibleBounds.Contains(new GeoPoint(37.7749, -122.4194)));
    }

    // ── View-model: reproject + pan side-effect + retry ──────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new StaticAnimatedMarkerSource();
        using var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, new StaticAnimatedMarkerMap());

        Assert.Equal(AnimatedMarkerVisualState.Loading, vm.State);
        Assert.False(vm.HasPosition);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_on_source_change()
    {
        var source = new StaticAnimatedMarkerSource();
        using var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, new StaticAnimatedMarkerMap());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.Set(Live(heading: 33));

        Assert.Equal(AnimatedMarkerVisualState.Live, vm.State);
        Assert.True(vm.ShowMarker);
        Assert.Contains(nameof(AnimatedMarkerViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_pans_when_a_new_fix_is_out_of_view()
    {
        var source = new StaticAnimatedMarkerSource();
        var map = new StaticAnimatedMarkerMap(new GeoBounds(40.0, -75.0, 41.0, -73.0));
        using var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, map);

        source.Set(Live());

        Assert.Equal(1, map.PanCount);
        Assert.Equal(new GeoPoint(37.7749, -122.4194), map.LastPan);
    }

    [Fact]
    public void ViewModel_does_not_pan_when_the_fix_is_already_in_view()
    {
        var source = new StaticAnimatedMarkerSource();
        var map = new StaticAnimatedMarkerMap(); // world bounds
        using var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, map);

        source.Set(Live());

        Assert.Equal(0, map.PanCount);
    }

    [Fact]
    public void ViewModel_pans_on_construction_when_the_initial_fix_is_out_of_view()
    {
        var source = new StaticAnimatedMarkerSource(Live());
        var map = new StaticAnimatedMarkerMap(new GeoBounds(40.0, -75.0, 41.0, -73.0));

        using var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, map);

        Assert.Equal(1, map.PanCount);
    }

    [Fact]
    public void ViewModel_retry_forwards_to_the_source()
    {
        var source = new StaticAnimatedMarkerSource();
        using var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, new StaticAnimatedMarkerMap());

        vm.Retry();

        Assert.Equal(1, source.RetryCount);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new StaticAnimatedMarkerSource();
        var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, new StaticAnimatedMarkerMap());

        vm.Dispose();
        source.Set(Live());

        Assert.Equal(AnimatedMarkerVisualState.Loading, vm.State);
    }

    [Fact]
    public void ViewModel_dispose_is_idempotent()
    {
        var vm = new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, new StaticAnimatedMarkerSource(), new StaticAnimatedMarkerMap());

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new StaticAnimatedMarkerSource();
        var map = new StaticAnimatedMarkerMap();

        Assert.Throws<ArgumentNullException>(() => new AnimatedMarkerViewModel(null!, source, map));
        Assert.Throws<ArgumentNullException>(() => new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, null!, map));
        Assert.Throws<ArgumentNullException>(() => new AnimatedMarkerViewModel(PassthroughLocalizer.Instance, source, null!));
    }

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_and_emits_the_slug()
    {
        var events = new List<string>();
        var diagnostics = new AnimatedMarkerDiagnostics(events.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.Equal("view.opened slug=AnimatedMarker", e));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_counts()
    {
        var diagnostics = new AnimatedMarkerDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_canonical_slug()
    {
        Assert.Equal("AnimatedMarker", AnimatedMarkerRegistration.Slug);
        Assert.Equal("AnimatedMarker", AnimatedMarkerViewModel.Slug);
        Assert.Equal("animated-marker", AnimatedMarkerRegistration.RootAutomationId);
    }

    [Fact]
    public void Registration_classifies_each_load_state()
    {
        Assert.Equal(AnimatedMarkerVisualState.Loading, AnimatedMarkerRegistration.Classify(Loading()));
        Assert.Equal(AnimatedMarkerVisualState.Empty, AnimatedMarkerRegistration.Classify(new LoadState<AnimatedMarkerSample>.Empty()));
        Assert.Equal(AnimatedMarkerVisualState.Error, AnimatedMarkerRegistration.Classify(new LoadState<AnimatedMarkerSample>.Error(new RepositoryError(RepositoryErrorKind.Unknown, "x"))));
        Assert.Equal(AnimatedMarkerVisualState.Offline, AnimatedMarkerRegistration.Classify(new LoadState<AnimatedMarkerSample>.Offline(Sample(), new RepositoryError(RepositoryErrorKind.Network, "x"))));
        Assert.Equal(AnimatedMarkerVisualState.Live, AnimatedMarkerRegistration.Classify(Live()));
    }

    [Fact]
    public void Registration_label_keys_resolve_for_every_state()
    {
        foreach (AnimatedMarkerVisualState state in Enum.GetValues<AnimatedMarkerVisualState>())
        {
            Assert.False(string.IsNullOrWhiteSpace(AnimatedMarkerRegistration.StatusLabelKey(state)));
            Assert.False(string.IsNullOrWhiteSpace(AnimatedMarkerRegistration.StatusLabelFallback(state)));
            Assert.StartsWith("TsColor", AnimatedMarkerRegistration.StatusAccentBrushKey(state), StringComparison.Ordinal);
        }
    }

    // ── async test helpers ───────────────────────────────────────────────────────────────────────────────

    private static async IAsyncEnumerable<RepositoryResult<Fix>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken,
        params RepositoryResult<Fix>[] items)
    {
        foreach (var item in items)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return item;
            await Task.Yield();
        }
    }

    private static async Task WaitForAsync(Func<bool> condition, int timeoutMs = 3000)
    {
        var stopwatch = Stopwatch.StartNew();
        while (!condition() && stopwatch.ElapsedMilliseconds < timeoutMs)
        {
            await Task.Delay(15);
        }

        Assert.True(condition(), "Condition was not met within the timeout.");
    }
}
