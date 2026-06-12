using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the <c>WidgetStatusGrid</c> widget primitive's UI-thread-free logic — the pure
/// projection (the empty vs. populated branches, the compact value-suppression, the palette mapping and the
/// composed Narrator names), the responsive column maths, the data seam's change notifications, the
/// view-model's state projection, the PII-safe diagnostics and the registration metadata. The cases mirror the
/// web source (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx) one-for-one. The WinUI view
/// itself (the chip borders, dots, brushes and width-driven re-arrange) is exercised by the app build.
/// </summary>
public sealed class WidgetStatusGridTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WidgetStatusCell Cell(
        string id,
        string label,
        WidgetStatusKind status,
        string? value = null,
        string? icon = null) => new(id, label, status, value, icon);

    private static WidgetStatusGridDisplay Project(WidgetStatusGridInput input) =>
        WidgetStatusGridProjection.Project(input, Localizer);

    // ── Empty branch (web L59-L61) ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_cells_render_the_empty_surface_with_the_default_message()
    {
        var d = Project(new WidgetStatusGridInput());

        Assert.Equal(WidgetStatusGridState.Empty, d.State);
        Assert.True(d.IsEmpty);
        Assert.False(d.IsPopulated);
        Assert.Equal(0, d.Count);
        Assert.Equal("No data available", d.EmptyMessage);
        Assert.False(d.HasEmptyIcon);
    }

    [Fact]
    public void Empty_state_uses_the_consumer_supplied_message_when_present()
    {
        var d = Project(new WidgetStatusGridInput { EmptyMessage = "No doors reporting" });

        Assert.Equal(WidgetStatusGridState.Empty, d.State);
        Assert.Equal("No doors reporting", d.EmptyMessage);
    }

    [Fact]
    public void Empty_state_falls_back_to_the_default_when_the_message_is_blank()
    {
        var d = Project(new WidgetStatusGridInput { EmptyMessage = "" });

        Assert.Equal("No data available", d.EmptyMessage);
    }

    [Fact]
    public void Empty_state_carries_the_optional_icon_glyph()
    {
        var d = Project(new WidgetStatusGridInput { EmptyIconGlyph = "\uE8D7" });

        Assert.True(d.HasEmptyIcon);
        Assert.Equal("\uE8D7", d.EmptyIconGlyph);
    }

    // ── Populated branch (web L65-L101) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Populated_cells_render_the_grid()
    {
        var d = Project(new WidgetStatusGridInput
        {
            Cells = [Cell("a", "Front Left", WidgetStatusKind.Ok, "Closed")],
        });

        Assert.Equal(WidgetStatusGridState.Populated, d.State);
        Assert.True(d.IsPopulated);
        Assert.Equal(1, d.Count);

        WidgetStatusCellDisplay cell = d.Cells[0];
        Assert.Equal("a", cell.Id);
        Assert.Equal("Front Left", cell.Label);
        Assert.Equal("Closed", cell.Value);
        Assert.True(cell.HasValue);
        Assert.Equal(WidgetStatusKind.Ok, cell.Status);
    }

    [Fact]
    public void Value_is_shown_when_present_and_not_compact()
    {
        var d = Project(new WidgetStatusGridInput
        {
            Cells = [Cell("a", "Range", WidgetStatusKind.Ok, "248 mi")],
            Compact = false,
        });

        Assert.True(d.Cells[0].HasValue);
        Assert.Equal("248 mi", d.Cells[0].Value);
    }

    [Fact]
    public void Compact_hides_the_value()
    {
        var d = Project(new WidgetStatusGridInput
        {
            Cells = [Cell("a", "Range", WidgetStatusKind.Ok, "248 mi")],
            Compact = true,
        });

        Assert.False(d.Cells[0].HasValue);
        Assert.Equal(string.Empty, d.Cells[0].Value);
    }

    [Fact]
    public void Missing_value_is_not_shown()
    {
        var d = Project(new WidgetStatusGridInput { Cells = [Cell("a", "Sentry", WidgetStatusKind.Inactive)] });

        Assert.False(d.Cells[0].HasValue);
        Assert.Equal(string.Empty, d.Cells[0].Value);
    }

    [Fact]
    public void Icon_glyph_is_projected_when_present()
    {
        var d = Project(new WidgetStatusGridInput
        {
            Cells = [Cell("a", "Locked", WidgetStatusKind.Ok, icon: "\uE72E")],
        });

        Assert.True(d.Cells[0].HasIcon);
        Assert.Equal("\uE72E", d.Cells[0].IconGlyph);
    }

    [Fact]
    public void Missing_icon_is_not_shown()
    {
        var d = Project(new WidgetStatusGridInput { Cells = [Cell("a", "Locked", WidgetStatusKind.Ok)] });

        Assert.False(d.Cells[0].HasIcon);
        Assert.Equal(string.Empty, d.Cells[0].IconGlyph);
    }

    [Fact]
    public void Null_cell_fields_are_coalesced()
    {
        var d = Project(new WidgetStatusGridInput { Cells = [new WidgetStatusCell(null!, null!, WidgetStatusKind.Unknown)] });

        Assert.Equal(string.Empty, d.Cells[0].Id);
        Assert.Equal(string.Empty, d.Cells[0].Label);
        Assert.Equal(string.Empty, d.Cells[0].AccessibleName);
    }

    // ── Accessibility name composition (label, plus value when shown) ────────────────────────────────────

    [Fact]
    public void Accessible_name_is_label_and_value_when_value_is_shown()
    {
        var d = Project(new WidgetStatusGridInput { Cells = [Cell("a", "Front Left", WidgetStatusKind.Ok, "Closed")] });

        Assert.Equal("Front Left: Closed", d.Cells[0].AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_label_only_when_value_is_hidden()
    {
        var d = Project(new WidgetStatusGridInput
        {
            Cells = [Cell("a", "Front Left", WidgetStatusKind.Ok, "Closed")],
            Compact = true,
        });

        Assert.Equal("Front Left", d.Cells[0].AccessibleName);
    }

    [Fact]
    public void Every_populated_cell_exposes_a_non_empty_accessible_name()
    {
        var d = Project(new WidgetStatusGridInput
        {
            Cells =
            [
                Cell("a", "Front Left", WidgetStatusKind.Ok, "Closed"),
                Cell("b", "Front Right", WidgetStatusKind.Warning, "Open"),
                Cell("c", "Rear Left", WidgetStatusKind.Error),
            ],
        });

        foreach (WidgetStatusCellDisplay cell in d.Cells)
        {
            Assert.False(string.IsNullOrWhiteSpace(cell.AccessibleName));
        }
    }

    // ── Palette (web statusStyles, L21-L42) ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(WidgetStatusKind.Ok, "TsColorSuccessBrush")]
    [InlineData(WidgetStatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(WidgetStatusKind.Error, "TsColorDangerBrush")]
    public void Accent_statuses_are_tinted_with_their_semantic_brush(WidgetStatusKind status, string brushKey)
    {
        WidgetStatusPalette palette = WidgetStatusPalette.For(status);

        Assert.True(palette.Tinted);
        Assert.Equal(brushKey, palette.DotBrushKey);
        Assert.Equal(brushKey, palette.BackgroundBrushKey);
        Assert.Equal(brushKey, palette.BorderBrushKey);
    }

    [Theory]
    [InlineData(WidgetStatusKind.Inactive)]
    [InlineData(WidgetStatusKind.Unknown)]
    public void Neutral_statuses_share_the_muted_surface_treatment(WidgetStatusKind status)
    {
        WidgetStatusPalette palette = WidgetStatusPalette.For(status);

        Assert.False(palette.Tinted);
        Assert.Equal("TsColorTextMutedBrush", palette.DotBrushKey);
        Assert.Equal("TsColorSurfaceGlassBrush", palette.BackgroundBrushKey);
        Assert.Equal("TsColorBorderBrush", palette.BorderBrushKey);
    }

    [Fact]
    public void Projected_cell_carries_its_status_palette()
    {
        var d = Project(new WidgetStatusGridInput { Cells = [Cell("a", "Battery", WidgetStatusKind.Error)] });

        Assert.Equal("TsColorDangerBrush", d.Cells[0].Palette.DotBrushKey);
        Assert.True(d.Cells[0].Palette.Tinted);
    }

    // ── Column maths (web container-query table, L44-L50) ────────────────────────────────────────────────

    [Theory]
    [InlineData(0, 2)]
    [InlineData(1, 2)]
    [InlineData(2, 2)]
    [InlineData(3, 3)]
    [InlineData(4, 4)]
    [InlineData(5, 4)]
    [InlineData(99, 4)]
    public void ClampColumns_pins_to_the_supported_two_three_four(int cols, int expected) =>
        Assert.Equal(expected, WidgetStatusGridLayout.ClampColumns(cols));

    [Theory]
    [InlineData(2, false, 2)]
    [InlineData(3, false, 3)]
    [InlineData(4, false, 4)]
    [InlineData(3, true, 2)]
    [InlineData(4, true, 2)]
    public void ResolveBaseColumns_applies_compact(int cols, bool compact, int expected) =>
        Assert.Equal(expected, WidgetStatusGridLayout.ResolveBaseColumns(cols, compact));

    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    [InlineData(320)]
    [InlineData(384)]
    [InlineData(1000)]
    public void Two_column_grid_never_collapses(double width) =>
        Assert.Equal(2, WidgetStatusGridLayout.ResolveColumns(2, compact: false, width));

    [Theory]
    [InlineData(0, 3)]      // unmeasured → base
    [InlineData(100, 1)]    // below @xs → 1
    [InlineData(319, 1)]
    [InlineData(320, 2)]    // @xs → 2
    [InlineData(383, 2)]
    [InlineData(384, 3)]    // @sm → 3
    [InlineData(800, 3)]
    public void Three_column_grid_collapses_at_the_xs_and_sm_breakpoints(double width, int expected) =>
        Assert.Equal(expected, WidgetStatusGridLayout.ResolveColumns(3, compact: false, width));

    [Theory]
    [InlineData(0, 4)]      // unmeasured → base
    [InlineData(100, 2)]    // below @sm → 2
    [InlineData(383, 2)]
    [InlineData(384, 4)]    // @sm → 4
    [InlineData(1200, 4)]
    public void Four_column_grid_collapses_to_two_below_sm(double width, int expected) =>
        Assert.Equal(expected, WidgetStatusGridLayout.ResolveColumns(4, compact: false, width));

    [Fact]
    public void Compact_grid_stays_two_columns_at_every_width() =>
        Assert.Equal(2, WidgetStatusGridLayout.ResolveColumns(4, compact: true, 1200));

    // ── Registration / i18n (P1/S10) ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_the_surface_name() =>
        Assert.Equal("WidgetStatusGrid", WidgetStatusGridRegistration.Slug);

    [Fact]
    public void Registration_uses_the_shared_no_data_catalog_key()
    {
        // Verified against apps/windows/Strings/{en,he,ar}/Resources.resw: translation.common.noData = "No data available".
        Assert.Equal("translation.common.noData", WidgetStatusGridRegistration.EmptyMessageKey);
        Assert.Equal("No data available", WidgetStatusGridRegistration.EmptyMessageFallback);
        Assert.Equal("No data available", WidgetStatusGridRegistration.EmptyMessage(Localizer));
    }

    [Fact]
    public void Registration_empty_message_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => WidgetStatusGridRegistration.EmptyMessage(null!));

    // ── Projection argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => WidgetStatusGridProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => WidgetStatusGridProjection.Project(new WidgetStatusGridInput(), null!));
    }

    // ── Data seam (P1/S8) ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_starts_empty()
    {
        var source = new WidgetStatusGridSource();

        Assert.NotNull(source.Input);
        Assert.Empty(source.Input.Cells);
        Assert.Equal(2, source.Input.Cols);
    }

    [Fact]
    public void Source_SetCells_swaps_the_cells_and_notifies()
    {
        var source = new WidgetStatusGridSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetCells([Cell("a", "Front Left", WidgetStatusKind.Ok)]);

        Assert.Single(source.Input.Cells);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Source_SetColumns_notifies_only_on_change()
    {
        var source = new WidgetStatusGridSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetColumns(2); // unchanged (default is 2)
        source.SetColumns(4);

        Assert.Equal(4, source.Input.Cols);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Source_SetCompact_notifies_only_on_change()
    {
        var source = new WidgetStatusGridSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetCompact(false); // unchanged
        source.SetCompact(true);

        Assert.True(source.Input.Compact);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Source_SetEmpty_publishes_the_empty_copy()
    {
        var source = new WidgetStatusGridSource();

        source.SetEmpty("No doors reporting", "\uE8D7");

        Assert.Equal("No doors reporting", source.Input.EmptyMessage);
        Assert.Equal("\uE8D7", source.Input.EmptyIconGlyph);
    }

    [Fact]
    public void Source_SetInput_null_falls_back_to_a_safe_default()
    {
        var source = new WidgetStatusGridSource();

        source.SetInput(null!);

        Assert.NotNull(source.Input);
        Assert.Empty(source.Input.Cells);
    }

    [Fact]
    public void Source_SetCells_null_falls_back_to_an_empty_list()
    {
        var source = new WidgetStatusGridSource();

        source.SetCells(null!);

        Assert.Empty(source.Input.Cells);
    }

    // ── View-model: per-state projection over the seam ───────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new WidgetStatusGridSource();
        using var vm = new WidgetStatusGridViewModel(source, Localizer);

        Assert.Equal(WidgetStatusGridState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.Equal(0, vm.Count);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_cells_change()
    {
        var source = new WidgetStatusGridSource();
        using var vm = new WidgetStatusGridViewModel(source, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetCells([Cell("a", "Front Left", WidgetStatusKind.Ok, "Closed")]);

        Assert.Equal(WidgetStatusGridState.Populated, vm.State);
        Assert.False(vm.IsEmpty);
        Assert.Equal(1, vm.Count);
        Assert.Contains(nameof(WidgetStatusGridViewModel.Display), changed);
        Assert.Contains(nameof(WidgetStatusGridViewModel.State), changed);
        Assert.Contains(nameof(WidgetStatusGridViewModel.IsEmpty), changed);
    }

    [Fact]
    public void ViewModel_dispose_is_idempotent_and_detaches_from_the_seam()
    {
        var source = new WidgetStatusGridSource();
        var vm = new WidgetStatusGridViewModel(source, Localizer);

        vm.Dispose();
        vm.Dispose();

        // After dispose a further source change must not reproject or throw.
        source.SetCells([Cell("a", "Front Left", WidgetStatusKind.Ok)]);
        Assert.Equal(WidgetStatusGridState.Empty, vm.State);
    }

    [Fact]
    public void ViewModel_exposes_the_registration_slug() =>
        Assert.Equal("WidgetStatusGrid", WidgetStatusGridViewModel.Slug);

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_and_emits_the_view_opened_event()
    {
        var captured = new List<string>();
        var diagnostics = new WidgetStatusGridDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=WidgetStatusGrid", captured);
    }

    [Fact]
    public void Diagnostics_tolerates_a_null_sink()
    {
        var diagnostics = new WidgetStatusGridDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
