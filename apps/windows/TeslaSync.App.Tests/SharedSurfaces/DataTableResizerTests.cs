using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DataTableResizer surface's UI-thread-free logic — the registration metadata (slug,
/// automation id, the ARIA separator role + vertical orientation, the default bound / keyboard constants, the i18n
/// key + fallback behind the accessible label, the label composition), the pure <see cref="DataTableResizerMath"/>
/// clamp, the <see cref="DataTableResizerProjection"/> adapter (width clamp, bounds + drag passthrough, the
/// accessible-name contract, value equality) and the <see cref="DataTableResizerViewModel"/> state holder (initial
/// clamp, the drag begin/move/end seam contract, the keyboard nudge/Home/End dual-commit, the automation set-value
/// path, the controlled-prop echoes and subscription-free re-projection) plus the PII-safe diagnostics. Mirrors the
/// web spec (web/src/components/ui/DataTableResizer.tsx). The WinUI view (shared-surfaces/DataTableResizer.cs) is
/// exercised by the app build. Because the component reads no network data, there is no loading / error / stale /
/// offline state — the reproduced branches are the rest / hover / focus / dragging highlight states and the pointer
/// + keyboard resize interactions.
/// </summary>
public sealed class DataTableResizerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DataTableResizer", DataTableResizerRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("data-table-resizer", DataTableResizerRegistration.RootAutomationId);

    [Fact]
    public void Role_and_orientation_describe_a_vertical_window_splitter()
    {
        // web role="separator" aria-orientation="vertical" — the WAI-ARIA Window Splitter pattern.
        Assert.Equal("separator", DataTableResizerRegistration.SeparatorRole);
        Assert.Equal("vertical", DataTableResizerRegistration.Orientation);
    }

    [Fact]
    public void Default_bounds_and_keyboard_constants_match_the_web_source()
    {
        // web minWidth = 60, maxWidth = 800; Left/Right ±8; Home → 80.
        Assert.Equal(60, DataTableResizerRegistration.DefaultMinWidth);
        Assert.Equal(800, DataTableResizerRegistration.DefaultMaxWidth);
        Assert.Equal(8, DataTableResizerRegistration.KeyboardStep);
        Assert.Equal(80, DataTableResizerRegistration.HomeWidth);
    }

    [Fact]
    public void Resize_label_key_and_fallback_match_the_catalog_entry()
    {
        // web aria-label={label ?? `Resize column ${columnKey}`}; catalog table.columns.resizeLabel = "Resize column {{col}}".
        Assert.Equal("translation.table.columns.resizeLabel", DataTableResizerRegistration.ResizeLabelKey);
        Assert.Equal("Resize column {0}", DataTableResizerRegistration.ResizeLabelFallback);
    }

    [Fact]
    public void Resolve_accessible_name_composes_the_column_key_when_no_label_is_given() =>
        Assert.Equal("Resize column energy", DataTableResizerRegistration.ResolveAccessibleName("energy", null, Localizer));

    [Fact]
    public void Resolve_accessible_name_prefers_a_trimmed_label_override() =>
        Assert.Equal("Widen the energy column",
            DataTableResizerRegistration.ResolveAccessibleName("energy", "  Widen the energy column  ", Localizer));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Resolve_accessible_name_falls_back_to_the_column_key_for_blank_labels(string? label) =>
        Assert.Equal("Resize column energy",
            DataTableResizerRegistration.ResolveAccessibleName("energy", label, Localizer));

    [Fact]
    public void Resolve_accessible_name_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => DataTableResizerRegistration.ResolveAccessibleName("energy", null, localizer: null!));

    // ── clamp maths (web clamp) ───────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(200, 60, 800, 200)]   // within range, untouched
    [InlineData(10, 60, 800, 60)]     // below min → min
    [InlineData(2000, 60, 800, 800)]  // above max → max
    [InlineData(119.6, 60, 800, 120)] // rounds to the nearest pixel first
    [InlineData(119.4, 60, 800, 119)]
    [InlineData(60.5, 60, 800, 61)]   // half away from zero
    public void Clamp_rounds_then_bounds_like_the_web_helper(double value, int min, int max, int expected) =>
        Assert.Equal(expected, DataTableResizerMath.Clamp(value, min, max));

    [Fact]
    public void Clamp_with_inverted_bounds_lets_the_minimum_win()
    {
        // web Math.max(minWidth, Math.min(maxWidth, n)) — the outer max wins when the bounds cross.
        Assert.Equal(200, DataTableResizerMath.Clamp(100, minWidth: 200, maxWidth: 50));
    }

    // ── projection adapter (web component body) ───────────────────────────────────────────────────────────

    [Fact]
    public void Projection_clamps_the_width_and_passes_the_bounds_through()
    {
        var projection = DataTableResizerProjection.Project("energy", 2000, 60, 800, null, isDragging: false, Localizer);

        Assert.Equal("energy", projection.ColumnKey);
        Assert.Equal(800, projection.Width);
        Assert.Equal(60, projection.MinWidth);
        Assert.Equal(800, projection.MaxWidth);
        Assert.False(projection.IsDragging);
        Assert.Equal("Resize column energy", projection.AccessibleName);
    }

    [Fact]
    public void Projection_carries_the_dragging_flag_for_the_highlight()
    {
        var resting = DataTableResizerProjection.Project("energy", 200, 60, 800, null, isDragging: false, Localizer);
        var dragging = DataTableResizerProjection.Project("energy", 200, 60, 800, null, isDragging: true, Localizer);

        Assert.False(resting.IsDragging);
        Assert.True(dragging.IsDragging);
    }

    [Fact]
    public void Projection_uses_the_label_override_for_the_accessible_name()
    {
        var projection = DataTableResizerProjection.Project("energy", 200, 60, 800, "Resize energy", false, Localizer);

        Assert.Equal("Resize energy", projection.AccessibleName);
    }

    [Fact]
    public void Projection_trims_the_column_key()
    {
        var projection = DataTableResizerProjection.Project("  energy  ", 200, 60, 800, null, false, Localizer);

        Assert.Equal("energy", projection.ColumnKey);
        Assert.Equal("Resize column energy", projection.AccessibleName);
    }

    [Theory]
    [InlineData(10, false, 60)]
    [InlineData(200, false, 200)]
    [InlineData(2000, true, 800)]
    public void Projection_snapshot_per_state(double width, bool isDragging, int expectedWidth)
    {
        var projection = DataTableResizerProjection.Project("energy", width, 60, 800, null, isDragging, Localizer);

        Assert.Equal(expectedWidth, projection.Width);
        Assert.Equal(isDragging, projection.IsDragging);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = DataTableResizerProjection.Project("energy", 200, 60, 800, null, false, Localizer);
        var b = DataTableResizerProjection.Project("energy", 200, 60, 800, null, false, Localizer);
        var different = DataTableResizerProjection.Project("energy", 200, 60, 800, null, true, Localizer);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => DataTableResizerProjection.Project("energy", 200, 60, 800, null, false, localizer: null!));

    // ── view-model: construction ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("DataTableResizer", DataTableResizerViewModel.Slug);

    [Fact]
    public void ViewModel_clamps_the_initial_width()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 5000);

        Assert.Equal(800, viewModel.Width);
        Assert.Equal(60, viewModel.MinWidth);
        Assert.Equal(800, viewModel.MaxWidth);
        Assert.Equal("energy", viewModel.ColumnKey);
        Assert.False(viewModel.IsDragging);
        Assert.Equal("Resize column energy", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(
            () => new DataTableResizerViewModel(columnKey: null!, 200, NoOpColumnResizeSink.Instance, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => new DataTableResizerViewModel("energy", 200, sink: null!, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => new DataTableResizerViewModel("energy", 200, NoOpColumnResizeSink.Instance, localizer: null!));
    }

    // ── view-model: drag seam (web pointer-down / move / up) ──────────────────────────────────────────────

    [Fact]
    public void BeginResize_sets_dragging_and_raises_once()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink);
        var (unsubscribe, count) = Track(viewModel);

        viewModel.BeginResize();
        viewModel.BeginResize(); // idempotent — already dragging
        unsubscribe();

        Assert.True(viewModel.IsDragging);
        Assert.Equal(1, count());
        Assert.Empty(sink.Resizes);
        Assert.Empty(sink.Commits);
    }

    [Fact]
    public void Resize_clamps_updates_width_and_reports_a_continuous_change_only()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);
        viewModel.BeginResize();

        viewModel.Resize(305.6);

        Assert.Equal(306, viewModel.Width);
        Assert.Equal(("energy", 306), Assert.Single(sink.Resizes));
        Assert.Empty(sink.Commits); // onResize fires during the drag, onResizeEnd only on release
    }

    [Fact]
    public void Resize_clamps_to_the_bounds()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);
        viewModel.BeginResize();

        viewModel.Resize(5);
        viewModel.Resize(9000);

        Assert.Equal(60, sink.Resizes[0].Width);
        Assert.Equal(800, sink.Resizes[1].Width);
        Assert.Equal(800, viewModel.Width);
    }

    [Fact]
    public void Resize_reports_every_move_even_when_the_clamped_width_is_unchanged()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 800);
        viewModel.BeginResize();

        viewModel.Resize(9000); // already at max
        viewModel.Resize(9000);

        // web onResize fires on every pointer move regardless of clamping.
        Assert.Equal(2, sink.Resizes.Count);
        Assert.All(sink.Resizes, r => Assert.Equal(800, r.Width));
    }

    [Fact]
    public void EndResize_commits_the_current_width_and_clears_dragging()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);
        viewModel.BeginResize();
        viewModel.Resize(260);

        viewModel.EndResize();

        Assert.False(viewModel.IsDragging);
        Assert.Equal(("energy", 260), Assert.Single(sink.Commits));
    }

    [Fact]
    public void EndResize_is_a_no_op_when_not_dragging()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink);

        viewModel.EndResize();

        Assert.Empty(sink.Commits);
        Assert.False(viewModel.IsDragging);
    }

    // ── view-model: keyboard (web Left / Right / Home / End) ──────────────────────────────────────────────

    [Fact]
    public void Nudge_grows_and_shrinks_by_the_step_and_dual_commits()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);

        viewModel.Nudge(8);
        Assert.Equal(208, viewModel.Width);
        viewModel.Nudge(-8);
        Assert.Equal(200, viewModel.Width);

        // web key handler calls BOTH onResize(next) and onResizeEnd(next) per keystroke.
        Assert.Equal(new[] { ("energy", 208), ("energy", 200) }, sink.Resizes);
        Assert.Equal(new[] { ("energy", 208), ("energy", 200) }, sink.Commits);
    }

    [Fact]
    public void Nudge_clamps_at_the_bounds()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 62, minWidth: 60, maxWidth: 800);

        viewModel.Nudge(-8); // 62 - 8 = 54 → clamped to 60

        Assert.Equal(60, viewModel.Width);
    }

    [Fact]
    public void ResetToHome_sets_the_home_width()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 400);

        viewModel.ResetToHome();

        Assert.Equal(80, viewModel.Width);
        Assert.Equal(("energy", 80), Assert.Single(sink.Commits));
    }

    [Fact]
    public void ResizeToMax_sets_the_maximum_width()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200, maxWidth: 640);

        viewModel.ResizeToMax();

        Assert.Equal(640, viewModel.Width);
        Assert.Equal(("energy", 640), Assert.Single(sink.Commits));
    }

    [Fact]
    public void SetWidthFromAutomation_clamps_and_dual_commits()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);

        viewModel.SetWidthFromAutomation(9000);

        Assert.Equal(800, viewModel.Width);
        Assert.Equal(("energy", 800), Assert.Single(sink.Resizes));
        Assert.Equal(("energy", 800), Assert.Single(sink.Commits));
    }

    // ── view-model: controlled prop echoes (no seam callbacks) ────────────────────────────────────────────

    [Fact]
    public void SetWidth_echoes_a_controlled_width_without_calling_the_seam()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);

        viewModel.SetWidth(305.6);

        Assert.Equal(306, viewModel.Width);
        Assert.Empty(sink.Resizes);
        Assert.Empty(sink.Commits);
    }

    [Fact]
    public void SetWidth_does_not_raise_when_the_clamped_width_is_unchanged()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 200);
        var (unsubscribe, count) = Track(viewModel);

        viewModel.SetWidth(200.4); // rounds back to 200

        unsubscribe();
        Assert.Equal(0, count());
    }

    [Fact]
    public void SetColumnKey_re_projects_the_accessible_name()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink);

        viewModel.SetColumnKey("battery");

        Assert.Equal("battery", viewModel.ColumnKey);
        Assert.Equal("Resize column battery", viewModel.AccessibleName);
    }

    [Fact]
    public void SetBounds_re_clamps_the_current_width()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink, width: 700);

        viewModel.SetBounds(100, 300);

        Assert.Equal(100, viewModel.MinWidth);
        Assert.Equal(300, viewModel.MaxWidth);
        Assert.Equal(300, viewModel.Width); // 700 clamped into the new range
        Assert.Empty(sink.Commits);
    }

    [Fact]
    public void SetLabel_overrides_the_accessible_name()
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = NewViewModel(sink);

        viewModel.SetLabel("Resize energy column");
        Assert.Equal("Resize energy column", viewModel.AccessibleName);

        viewModel.SetLabel(null);
        Assert.Equal("Resize column energy", viewModel.AccessibleName);
    }

    // ── accessibility: the splitter is always named ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("energy", null, "Resize column energy")]
    [InlineData("", null, "Resize column")]
    [InlineData("energy", "Grow energy", "Grow energy")]
    public void Accessible_name_is_never_empty(string columnKey, string? label, string expected)
    {
        using var sink = new FakeColumnResizeSink();
        var viewModel = new DataTableResizerViewModel(columnKey, 200, sink, Localizer, label: label);

        Assert.False(string.IsNullOrWhiteSpace(viewModel.AccessibleName));
        Assert.Equal(expected, viewModel.AccessibleName);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never the width or column key) ────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DataTableResizerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DataTableResizer", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new DataTableResizerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new DataTableResizerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(DataTableResizerRegistration.Slug, line, StringComparison.Ordinal);
    }

    private static DataTableResizerViewModel NewViewModel(
        IColumnResizeSink sink,
        double width = 200,
        int minWidth = 60,
        int maxWidth = 800) =>
        new("energy", width, sink, Localizer, minWidth, maxWidth);

    private static (Action Unsubscribe, Func<int> Count) Track(DataTableResizerViewModel viewModel)
    {
        int changes = 0;
        void Handler(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => changes++;
        viewModel.PropertyChanged += Handler;
        return (() => viewModel.PropertyChanged -= Handler, () => changes);
    }

    private sealed class FakeColumnResizeSink : IColumnResizeSink, IDisposable
    {
        public List<(string Key, int Width)> Resizes { get; } = new();

        public List<(string Key, int Width)> Commits { get; } = new();

        public void OnResize(string columnKey, int width) => Resizes.Add((columnKey, width));

        public void OnResizeEnd(string columnKey, int width) => Commits.Add((columnKey, width));

        public void Dispose()
        {
            // Nothing to release; IDisposable lets tests use `using` for symmetry with other surface fakes.
        }
    }
}
