using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MiniGridPreview</c> feature surface's UI-thread-free logic — the grid
/// geometry projection (the web <c>GRID_COLS.lg</c> / <c>safeMaxY</c> guard / percentage layout), the
/// per-cell icon join (web <c>widgets.find(...)</c> then <c>getWidgetDef(widgetId)?.icon</c>), the widget
/// icon catalog, the per-state display, the i18n binding, the accessibility name and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/dashboard/components/MiniGridPreview.tsx), a pure
/// presentational component whose only content states are populated vs. empty; the WinUI view itself
/// (feature-views\MiniGridPreview\MiniGridPreview.cs) is exercised by the app build.
/// </summary>
public sealed class MiniGridPreviewTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static MiniGridLayoutItem Item(string key, int x, int y, int w, int h) => new(key, x, y, w, h);

    private static MiniGridWidgetInstance Widget(string id, string widgetId) => new(id, widgetId);

    private static MiniGridPreviewDisplay Project(
        MiniGridPreviewModel model,
        Func<string, string?>? resolver = null) =>
        MiniGridPreviewProjection.Project(model, Localizer, resolver);

    // ── Constants mirror the web grid (GRID_COLS.lg = 4; empty/invalid span falls back to 2) ─────────────

    [Fact]
    public void Projection_constants_match_the_web_grid()
    {
        Assert.Equal(4, MiniGridPreviewProjection.GridColumns);
        Assert.Equal(2, MiniGridPreviewProjection.FallbackRowSpan);
    }

    [Fact]
    public void Columns_is_always_four_regardless_of_layout()
    {
        Assert.Equal(4, Project(MiniGridPreviewModel.Empty).Columns);
        Assert.Equal(
            4,
            Project(MiniGridPreviewModel.Create(null, new[] { Item("a", 0, 0, 1, 1) })).Columns);
    }

    // ── safeMaxY: max(y + h) over the layout, else 2; non-positive spans fall back to 2 ──────────────────

    [Fact]
    public void RowSpan_of_empty_layout_is_the_fallback()
    {
        Assert.Equal(2, MiniGridPreviewProjection.RowSpan(Array.Empty<MiniGridLayoutItem>()));
    }

    [Fact]
    public void RowSpan_is_the_max_of_y_plus_h()
    {
        var layout = new[] { Item("a", 0, 0, 1, 2), Item("b", 1, 2, 2, 3), Item("c", 0, 1, 1, 1) };
        Assert.Equal(5, MiniGridPreviewProjection.RowSpan(layout));
    }

    [Fact]
    public void RowSpan_falls_back_when_the_span_is_zero()
    {
        Assert.Equal(2, MiniGridPreviewProjection.RowSpan(new[] { Item("a", 0, 0, 1, 0) }));
    }

    [Fact]
    public void RowSpan_falls_back_when_the_span_is_negative()
    {
        // web guard: safeMaxY = maxY > 0 ? maxY : 2
        Assert.Equal(2, MiniGridPreviewProjection.RowSpan(new[] { Item("a", 0, -5, 1, 1) }));
    }

    [Fact]
    public void RowSpan_rejects_a_null_layout()
    {
        Assert.Throws<ArgumentNullException>(() => MiniGridPreviewProjection.RowSpan(null!));
    }

    // ── Aspect ratio = cols / safeMaxY (web aspectRatio) ─────────────────────────────────────────────────

    [Fact]
    public void Empty_aspect_ratio_is_cols_over_fallback()
    {
        // web: aspectRatio `${cols} / ${safeMaxY}` = 4 / 2
        Assert.Equal(2.0, Project(MiniGridPreviewModel.Empty).AspectRatio, 10);
    }

    [Fact]
    public void Populated_aspect_ratio_tracks_the_row_span()
    {
        var model = MiniGridPreviewModel.Create(null, new[] { Item("a", 0, 0, 4, 5) });
        Assert.Equal(4.0 / 5.0, Project(model).AspectRatio, 10);
        Assert.Equal(5, Project(model).RowSpan);
    }

    // ── Per-cell percentage geometry: left x/cols, top y/safeMaxY, width w/cols, height h/safeMaxY ───────

    [Fact]
    public void Tile_fractions_match_the_web_percentages()
    {
        // safeMaxY = max(2 + 3) = 5
        var model = MiniGridPreviewModel.Create(
            Array.Empty<MiniGridWidgetInstance>(),
            new[] { Item("cell", 1, 2, 2, 3) });

        var tile = Assert.Single(Project(model).Tiles);

        Assert.Equal("cell", tile.Key);
        Assert.Equal(1.0 / 4.0, tile.LeftFraction, 10);   // x / cols
        Assert.Equal(2.0 / 5.0, tile.TopFraction, 10);    // y / safeMaxY
        Assert.Equal(2.0 / 4.0, tile.WidthFraction, 10);  // w / cols
        Assert.Equal(3.0 / 5.0, tile.HeightFraction, 10); // h / safeMaxY
    }

    [Fact]
    public void Tile_fractions_are_not_clamped_matching_the_web()
    {
        // A widget wider than the grid keeps its raw ratio (web emits the percentage uncapped).
        var model = MiniGridPreviewModel.Create(null, new[] { Item("wide", 0, 0, 8, 2) });

        var tile = Assert.Single(Project(model).Tiles);
        Assert.Equal(2.0, tile.WidthFraction, 10); // 8 / 4
    }

    [Fact]
    public void Tiles_preserve_layout_order_and_keys()
    {
        var layout = new[] { Item("first", 0, 0, 1, 1), Item("second", 1, 0, 1, 1), Item("third", 2, 0, 1, 1) };
        var tiles = Project(MiniGridPreviewModel.Create(null, layout)).Tiles;

        Assert.Equal(new[] { "first", "second", "third" }, tiles.Select(t => t.Key).ToArray());
    }

    // ── Icon join: widgets.find(w => w.id === item.i) then getWidgetDef(widget.widgetId)?.icon ───────────

    [Fact]
    public void Tile_resolves_its_widget_glyph_through_the_resolver()
    {
        var model = MiniGridPreviewModel.Create(
            new[] { Widget("a", "known-widget") },
            new[] { Item("a", 0, 0, 1, 1) });

        var tile = Assert.Single(Project(model, wid => wid == "known-widget" ? "\uE111" : null).Tiles);
        Assert.Equal("\uE111", tile.IconGlyph);
    }

    [Fact]
    public void Tile_with_no_matching_widget_has_no_icon()
    {
        // layout key 'c' has no widget instance -> web `widget ? ... : null` -> no icon
        var model = MiniGridPreviewModel.Create(
            new[] { Widget("a", "known-widget") },
            new[] { Item("c", 0, 0, 1, 1) });

        var tile = Assert.Single(Project(model, _ => "\uE111").Tiles);
        Assert.Null(tile.IconGlyph);
    }

    [Fact]
    public void Tile_with_unknown_widget_id_has_no_icon()
    {
        // widget exists but its widgetId has no registry entry -> getWidgetDef(...)?.icon is undefined
        var model = MiniGridPreviewModel.Create(
            new[] { Widget("a", "not-a-real-widget-id") },
            new[] { Item("a", 0, 0, 1, 1) });

        var tile = Assert.Single(Project(model).Tiles);
        Assert.Null(tile.IconGlyph);
    }

    [Fact]
    public void Icon_join_matches_widget_by_layout_key_not_by_index()
    {
        // Widgets are out of layout order; the join must be by id, like web Array.find.
        var model = MiniGridPreviewModel.Create(
            new[] { Widget("b", "wid-b"), Widget("a", "wid-a") },
            new[] { Item("a", 0, 0, 1, 1), Item("b", 1, 0, 1, 1) });

        var tiles = Project(model, wid => wid == "wid-a" ? "\uE0A1" : "\uE0B2").Tiles;

        Assert.Equal("\uE0A1", tiles[0].IconGlyph); // 'a' -> wid-a
        Assert.Equal("\uE0B2", tiles[1].IconGlyph); // 'b' -> wid-b
    }

    [Fact]
    public void Default_resolver_uses_the_widget_icon_catalog()
    {
        var model = MiniGridPreviewModel.Create(
            new[] { Widget("a", "battery-gauge") },
            new[] { Item("a", 0, 0, 1, 1) });

        var tile = Assert.Single(Project(model).Tiles);
        Assert.Equal(MiniGridWidgetIcons.GlyphFor("battery-gauge"), tile.IconGlyph);
        Assert.False(string.IsNullOrEmpty(tile.IconGlyph));
    }

    // ── Widget icon catalog: faithful id => Lucide transcription + complete glyph coverage ───────────────

    [Fact]
    public void Catalog_covers_the_full_web_registry()
    {
        Assert.Equal(118, MiniGridWidgetIcons.KnownWidgetCount);
        Assert.Equal(76, MiniGridWidgetIcons.KnownIconCount);
    }

    [Theory]
    [InlineData("vehicle-hero", "Car")]
    [InlineData("battery-gauge", "Battery")]
    [InlineData("charge-status", "Zap")]
    [InlineData("quick-nav", "MapPin")]
    [InlineData("system-health", "Server")]
    [InlineData("fleet-stats", "BarChart3")]
    [InlineData("media-now-playing", "Music")]
    [InlineData("position-heatmap", "MapIcon")]
    public void Catalog_transcribes_the_web_id_to_icon(string widgetId, string iconName)
    {
        Assert.Equal(iconName, MiniGridWidgetIcons.IconNameFor(widgetId));
    }

    [Fact]
    public void Every_known_widget_resolves_to_a_non_empty_glyph()
    {
        foreach (var widgetId in MiniGridWidgetIcons.KnownWidgetIds)
        {
            Assert.False(
                string.IsNullOrEmpty(MiniGridWidgetIcons.GlyphFor(widgetId)),
                $"widget id '{widgetId}' resolved to no glyph");
        }
    }

    [Fact]
    public void Every_catalog_icon_name_has_a_glyph()
    {
        foreach (var iconName in MiniGridWidgetIcons.KnownIconNames)
        {
            Assert.False(
                string.IsNullOrEmpty(MiniGridWidgetIcons.GlyphForIcon(iconName)),
                $"icon '{iconName}' has no glyph");
        }
    }

    [Fact]
    public void Battery_widget_maps_to_the_battery_glyph()
    {
        Assert.Equal("\uE83F", MiniGridWidgetIcons.GlyphForIcon("Battery"));
        Assert.Equal("\uE83F", MiniGridWidgetIcons.GlyphFor("battery-gauge"));
    }

    [Fact]
    public void Unknown_widget_id_resolves_to_null()
    {
        Assert.Null(MiniGridWidgetIcons.IconNameFor("nope-not-real"));
        Assert.Null(MiniGridWidgetIcons.GlyphFor("nope-not-real"));
    }

    [Fact]
    public void Unknown_icon_name_resolves_to_null()
    {
        Assert.Null(MiniGridWidgetIcons.GlyphForIcon("NotAnIcon"));
    }

    [Fact]
    public void Icon_resolvers_tolerate_null_input()
    {
        Assert.Null(MiniGridWidgetIcons.IconNameFor(null));
        Assert.Null(MiniGridWidgetIcons.GlyphForIcon(null));
        Assert.Null(MiniGridWidgetIcons.GlyphFor(null));
    }

    // ── Per-state "snapshot": each state renders a complete, distinct display ─────────────────────────────

    [Fact]
    public void Populated_state_renders_a_cell_for_every_layout_item()
    {
        var model = MiniGridPreviewModel.Create(
            new[] { Widget("a", "battery-gauge"), Widget("b", "charge-status") },
            new[] { Item("a", 0, 0, 2, 2), Item("b", 2, 0, 2, 2) });

        var display = Project(model);

        Assert.False(display.IsEmpty);
        Assert.Equal(2, display.Tiles.Count);
        Assert.All(display.Tiles, t => Assert.False(string.IsNullOrEmpty(t.Key)));
        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
    }

    [Fact]
    public void Empty_state_renders_no_cells_but_keeps_a_friendly_caption()
    {
        var display = Project(MiniGridPreviewModel.Empty);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Tiles);
        Assert.Equal(2, display.RowSpan);
        Assert.Equal("No data available", display.EmptyMessage);
        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
    }

    [Fact]
    public void Whitespace_only_layout_resolves_through_the_create_null_guard()
    {
        // web: dashboard.layouts.lg ?? [] -> empty layout is the empty state
        var display = Project(MiniGridPreviewModel.Create(null, null));
        Assert.True(display.IsEmpty);
    }

    // ── Model defaults / null-guards ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_model_has_no_widgets_or_layout()
    {
        Assert.Empty(MiniGridPreviewModel.Empty.Widgets);
        Assert.Empty(MiniGridPreviewModel.Empty.Layout);
    }

    [Fact]
    public void Create_coalesces_null_lists_to_empty()
    {
        var model = MiniGridPreviewModel.Create(null, null);
        Assert.Empty(model.Widgets);
        Assert.Empty(model.Layout);
    }

    [Fact]
    public void Project_rejects_a_null_model()
    {
        Assert.Throws<ArgumentNullException>(() => MiniGridPreviewProjection.Project(null!, Localizer));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            MiniGridPreviewProjection.Project(MiniGridPreviewModel.Empty, null!));
    }

    // ── i18n: the anonymous web surface resolves only an accessible name + empty caption ─────────────────

    [Fact]
    public void Preview_label_resolves_through_the_dashboard_layout_key()
    {
        var fake = new RecordingLocalizer();

        _ = MiniGridPreviewRegistration.PreviewLabel(fake);

        Assert.Equal("dashboard.layout.label", Assert.Single(fake.RequestedKeys));
    }

    [Fact]
    public void Empty_message_resolves_through_the_common_no_data_key()
    {
        var fake = new RecordingLocalizer();

        _ = MiniGridPreviewRegistration.EmptyMessage(fake);

        Assert.Equal("common.noData", Assert.Single(fake.RequestedKeys));
    }

    [Fact]
    public void Copy_flows_through_the_localizer_with_no_hardcoded_english()
    {
        // Non-ASCII translations must reach the display, proving the surface contributes no hardcoded English.
        var fake = new RecordingLocalizer("レイアウト");

        var display = MiniGridPreviewProjection.Project(MiniGridPreviewModel.Empty, fake);

        Assert.Equal("レイアウト", display.AutomationName);
        Assert.Equal("レイアウト", display.EmptyMessage);
    }

    [Fact]
    public void Preview_label_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => MiniGridPreviewRegistration.PreviewLabel(null!));
    }

    [Fact]
    public void Empty_message_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => MiniGridPreviewRegistration.EmptyMessage(null!));
    }

    // ── Accessibility: a non-empty Narrator name in every state ───────────────────────────────────────────

    [Fact]
    public void Automation_name_is_the_localized_preview_label()
    {
        Assert.Equal("Layout", Project(MiniGridPreviewModel.Empty).AutomationName);
    }

    [Fact]
    public void Empty_caption_is_a_non_empty_announcement()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(MiniGridPreviewModel.Empty).EmptyMessage));
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_keys_fallbacks_and_glyph()
    {
        Assert.Equal("MiniGridPreview", MiniGridPreviewRegistration.Slug);
        Assert.Equal("dashboard.layout.label", MiniGridPreviewRegistration.PreviewLabelKey);
        Assert.Equal("Layout", MiniGridPreviewRegistration.PreviewLabelFallback);
        Assert.Equal("common.noData", MiniGridPreviewRegistration.EmptyMessageKey);
        Assert.Equal("No data available", MiniGridPreviewRegistration.EmptyMessageFallback);
        Assert.Equal("\uE80A", MiniGridPreviewRegistration.EmptyGlyph);
    }

    [Fact]
    public void Registration_labels_resolve_to_their_fallbacks_under_passthrough()
    {
        Assert.Equal("Layout", MiniGridPreviewRegistration.PreviewLabel(Localizer));
        Assert.Equal("No data available", MiniGridPreviewRegistration.EmptyMessage(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened slug=MiniGridPreview, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new MiniGridPreviewDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MiniGridPreview", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_counts_every_open()
    {
        var diagnostics = new MiniGridPreviewDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_line_is_exactly_the_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new MiniGridPreviewDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.StartsWith("view.opened ", line, StringComparison.Ordinal);
        Assert.DoesNotContain('%', line);
    }

    /// <summary>An <see cref="ILocalizer"/> test double recording the requested keys and returning either a
    /// configured translation or the supplied fallback.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly string? _override;

        public RecordingLocalizer(string? translation = null) => _override = translation;

        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return _override ?? fallback;
        }
    }
}
