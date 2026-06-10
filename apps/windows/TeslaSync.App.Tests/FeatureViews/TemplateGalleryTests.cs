using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TemplateGallery</c> feature surface's UI-thread-free logic — the preset
/// catalog transcription, the <c>lg</c> layout builder (web <c>buildDefaultLayouts</c> / <c>buildLayoutItem</c>),
/// the widget catalog (web <c>getWidgetDef</c>), the gallery / detail projections (web <c>TemplateGallery</c> /
/// <c>TemplateCard</c> / <c>TemplateDetail</c>), the <c>useCategoryIcons</c> port, the i18n key wiring (including
/// the web's <c>{{count}}</c> interpolation and camelCase description keys), the PII-safe diagnostics and the
/// registration metadata. Mirrors the web spec
/// (web/src/features/dashboard/components/TemplateGallery.tsx). The WinUI view itself
/// (feature-views\TemplateGallery\TemplateGallery.cs) is exercised by the app build.
/// </summary>
public sealed class TemplateGalleryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Presets: faithful transcription of DASHBOARD_PRESETS ──────────────────────────────────────────

    [Fact]
    public void Presets_match_the_web_catalog_order_and_ids()
    {
        var ids = DashboardPresets.All.Select(p => p.Id).ToArray();

        Assert.Equal(
            new[]
            {
                "default", "commuter", "fleet_manager", "data_nerd", "charging_focus",
                "security_monitor", "road_trip", "performance", "kiosk_wall", "minimal",
            },
            ids);
        Assert.Equal(10, DashboardPresets.Count);
    }

    [Theory]
    [InlineData("default", "Default", 8)]
    [InlineData("commuter", "Daily Commuter", 7)]
    [InlineData("fleet_manager", "Fleet Manager", 6)]
    [InlineData("data_nerd", "Data Nerd", 5)]
    [InlineData("charging_focus", "Charging Hub", 7)]
    [InlineData("security_monitor", "Security Monitor", 6)]
    [InlineData("road_trip", "Road Trip", 8)]
    [InlineData("performance", "Performance", 6)]
    [InlineData("kiosk_wall", "Wall Display", 6)]
    [InlineData("minimal", "Minimal", 4)]
    public void Each_preset_has_the_expected_name_and_widget_count(string id, string name, int count)
    {
        var preset = DashboardPresets.Find(id);

        Assert.NotNull(preset);
        Assert.Equal(name, preset!.NameFallback);
        Assert.Equal(count, preset.WidgetCount);
    }

    [Fact]
    public void Preset_widget_instance_ids_follow_the_web_makePreset_scheme()
    {
        var preset = DashboardPresets.Find("minimal")!;

        Assert.Equal(
            new[] { "minimal-1", "minimal-2", "minimal-3", "minimal-4" },
            preset.Widgets.Select(w => w.InstanceId).ToArray());
        Assert.Equal(
            new[] { "battery-radial-gauge", "charge-status", "climate-status", "quick-nav" },
            preset.Widgets.Select(w => w.WidgetId).ToArray());
    }

    [Fact]
    public void Find_returns_null_for_unknown_or_null_ids()
    {
        Assert.Null(DashboardPresets.Find("does-not-exist"));
        Assert.Null(DashboardPresets.Find(null));
    }

    // ── Widget catalog: every preset widget id resolves ───────────────────────────────────────────────

    [Fact]
    public void Catalog_covers_every_widget_id_referenced_by_a_preset()
    {
        foreach (var preset in DashboardPresets.All)
        {
            foreach (var widget in preset.Widgets)
            {
                Assert.True(
                    DashboardWidgetCatalog.TryGet(widget.WidgetId, out var meta),
                    $"missing catalog entry for {widget.WidgetId} (preset {preset.Id})");
                Assert.False(string.IsNullOrWhiteSpace(meta.NameFallback));
                Assert.False(string.IsNullOrWhiteSpace(meta.Category));
                Assert.True(meta.DefaultCols >= 1 && meta.DefaultRows >= 1);
                Assert.True(meta.MaxCols >= meta.MinCols && meta.MaxRows >= meta.MinRows);
            }
        }
    }

    [Fact]
    public void Catalog_resolves_a_glyph_for_every_preset_widget()
    {
        foreach (var preset in DashboardPresets.All)
        {
            foreach (var widget in preset.Widgets)
            {
                Assert.False(
                    string.IsNullOrEmpty(DashboardWidgetCatalog.GlyphFor(widget.WidgetId)),
                    $"missing glyph for {widget.WidgetId}");
            }
        }
    }

    [Fact]
    public void Catalog_returns_null_for_unknown_or_null_ids()
    {
        Assert.Null(DashboardWidgetCatalog.Get("nope"));
        Assert.Null(DashboardWidgetCatalog.Get(null));
        Assert.False(DashboardWidgetCatalog.TryGet("nope", out _));
    }

    [Fact]
    public void Catalog_name_resolves_through_a_per_widget_key_with_the_registry_fallback()
    {
        var recorder = new RecordingLocalizer();

        var name = DashboardWidgetCatalog.Name(recorder, "battery-gauge");

        Assert.Equal("Battery Level", name);
        Assert.Contains(("dashboard.widget.battery-gauge.name", "Battery Level"), recorder.Calls);
    }

    // ── Layout builder: faithful port of buildDefaultLayouts (lg) ─────────────────────────────────────

    [Fact]
    public void Lg_layout_for_minimal_matches_the_web_auto_flow()
    {
        var layout = DashboardPresets.Find("minimal")!.LgLayout;

        Assert.Collection(
            layout,
            i => AssertItem(i, "minimal-1", 0, 0, 1, 2),
            i => AssertItem(i, "minimal-2", 1, 0, 2, 2),
            i => AssertItem(i, "minimal-3", 3, 0, 1, 2),
            i => AssertItem(i, "minimal-4", 0, 2, 4, 2));
    }

    [Fact]
    public void Lg_layout_wraps_to_a_new_row_when_a_widget_overflows_the_columns()
    {
        var layout = DashboardPresets.Find("default")!.LgLayout;

        Assert.Equal(8, layout.Count);
        AssertItem(layout[0], "default-1", 0, 0, 2, 4); // onboarding-checklist
        AssertItem(layout[1], "default-2", 2, 0, 2, 9); // vehicle-hero fills the first row
        AssertItem(layout[2], "default-3", 0, 9, 1, 2); // battery-gauge wraps below the tallest item
    }

    [Theory]
    [InlineData("quick-nav", 4, 2)]
    [InlineData("battery-gauge", 1, 2)]
    [InlineData("vehicle-hero", 2, 9)]
    [InlineData("fleet-stats", 4, 2)]
    [InlineData("vehicle-twin", 2, 4)]
    public void Span_clamps_default_size_into_min_max_and_column_count(string widgetId, int w, int h)
    {
        var (actualW, actualH) = DashboardLayoutBuilder.Span(widgetId);

        Assert.Equal(w, actualW);
        Assert.Equal(h, actualH);
    }

    [Fact]
    public void Span_uses_the_web_fallback_for_an_unknown_widget()
    {
        Assert.Equal((1, 1), DashboardLayoutBuilder.Span("totally-unknown"));
    }

    [Fact]
    public void Lg_layout_keys_match_the_widget_instance_ids()
    {
        foreach (var preset in DashboardPresets.All)
        {
            var widgetIds = preset.Widgets.Select(w => w.InstanceId).ToArray();
            var layoutKeys = preset.LgLayout.Select(l => l.Key).ToArray();
            Assert.Equal(widgetIds, layoutKeys);
        }
    }

    // ── Gallery projection (web non-selected branch) ──────────────────────────────────────────────────

    [Fact]
    public void Gallery_renders_the_title_blank_option_and_one_card_per_preset()
    {
        var display = TemplateGalleryProjection.ProjectGallery(TemplateGalleryModel.Default, Localizer);

        Assert.Equal("Dashboard Templates", display.Title);
        Assert.False(display.IsEmpty);
        Assert.Equal(DashboardPresets.Count, display.Cards.Count);

        Assert.Equal("Blank Dashboard", display.Blank.Title);
        Assert.Equal("Start from scratch and add widgets manually", display.Blank.Description);
        Assert.Equal(TemplateGalleryRegistration.BlankGlyph, display.Blank.Glyph);
        Assert.Contains("Blank Dashboard", display.Blank.AutomationName);
        Assert.Contains("Start from scratch", display.Blank.AutomationName);
    }

    [Fact]
    public void Gallery_empty_state_keeps_the_blank_option_and_shows_a_friendly_note()
    {
        var display = TemplateGalleryProjection.ProjectGallery(TemplateGalleryModel.Empty, Localizer);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Cards);
        Assert.Equal("No templates available", display.EmptyMessage);
        Assert.Equal("Blank Dashboard", display.Blank.Title); // never a blank box — the blank option remains
    }

    [Fact]
    public void Gallery_card_carries_name_count_description_category_icons_and_a_preview()
    {
        var display = TemplateGalleryProjection.ProjectGallery(TemplateGalleryModel.Default, Localizer);
        var card = display.Cards.Single(c => c.Id == "default");

        Assert.Equal("Default", card.Name);
        Assert.Equal(8, card.WidgetCount);
        Assert.Equal("Balanced overview of vehicle status, battery, climate, and recent drives", card.Description);
        Assert.NotEmpty(card.CategoryIcons);
        Assert.Equal(8, card.Preview.Widgets.Count);
        Assert.Equal(8, card.Preview.Layout.Count);
        Assert.Contains("Default", card.AutomationName);
        Assert.Contains("8 widgets", card.AutomationName);
    }

    // ── useCategoryIcons port ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Category_icons_dedupe_by_category_in_placement_order_and_cap_at_five()
    {
        var icons = TemplateGalleryProjection.CategoryIcons(DashboardPresets.Find("default")!, Localizer);

        Assert.Equal(TemplateGalleryRegistration.MaxCategoryIcons, icons.Count);
        Assert.Equal(
            new[] { "system", "vehicle", "battery", "climate", "driving" },
            icons.Select(i => i.Category).ToArray());
        Assert.All(icons, i => Assert.False(string.IsNullOrEmpty(i.Glyph)));
    }

    [Fact]
    public void Category_icons_for_a_small_preset_keep_every_distinct_category()
    {
        var icons = TemplateGalleryProjection.CategoryIcons(DashboardPresets.Find("minimal")!, Localizer);

        Assert.Equal(
            new[] { "battery", "charging", "climate", "system" },
            icons.Select(i => i.Category).ToArray());
    }

    [Fact]
    public void Category_icon_label_resolves_through_a_category_key()
    {
        var recorder = new RecordingLocalizer();

        var icons = TemplateGalleryProjection.CategoryIcons(DashboardPresets.Find("minimal")!, recorder);

        Assert.Equal("battery", icons[0].CategoryLabel);
        Assert.Contains(("dashboard.widgetCategory.battery", "battery"), recorder.Calls);
    }

    // ── Detail projection (web TemplateDetail) ────────────────────────────────────────────────────────

    [Fact]
    public void Detail_renders_title_name_description_count_widgets_and_actions()
    {
        var detail = TemplateGalleryProjection.ProjectDetail(DashboardPresets.Find("minimal")!, Localizer);

        Assert.Equal("Template Preview", detail.Title);
        Assert.Equal("Minimal", detail.Name);
        Assert.Equal("Just the essentials — battery, charging, climate, and navigation", detail.Description);
        Assert.Equal("4 widgets", detail.WidgetCountText);
        Assert.Equal("Back", detail.BackLabel);
        Assert.Equal("Use This Template", detail.ApplyLabel);
        Assert.Equal(4, detail.Widgets.Count);
        Assert.Equal(4, detail.Preview.Widgets.Count);
    }

    [Fact]
    public void Detail_widget_rows_carry_each_widget_name_and_glyph()
    {
        var detail = TemplateGalleryProjection.ProjectDetail(DashboardPresets.Find("minimal")!, Localizer);

        Assert.Equal(
            new[] { "Battery Radial Gauge", "Charge Status", "Climate", "Quick Navigation" },
            detail.Widgets.Select(w => w.Name).ToArray());
        Assert.All(detail.Widgets, w => Assert.False(string.IsNullOrEmpty(w.Glyph)));
    }

    [Fact]
    public void Detail_skips_widget_rows_whose_id_is_not_in_the_catalog()
    {
        // web: const def = getWidgetDef(w.widgetId); if (!def) return null;
        var template = new DashboardTemplate(
            "synthetic",
            "Synthetic",
            new[]
            {
                new DashboardTemplateWidget("synthetic-1", "battery-gauge"),
                new DashboardTemplateWidget("synthetic-2", "ghost-widget"),
            },
            DashboardLayoutBuilder.BuildLgLayout(new[]
            {
                new DashboardTemplateWidget("synthetic-1", "battery-gauge"),
                new DashboardTemplateWidget("synthetic-2", "ghost-widget"),
            }));

        var detail = TemplateGalleryProjection.ProjectDetail(template, Localizer);

        Assert.Single(detail.Widgets);
        Assert.Equal("Battery Level", detail.Widgets[0].Name);
    }

    [Fact]
    public void Every_preset_projects_a_detail_with_a_non_null_description()
    {
        foreach (var preset in DashboardPresets.All)
        {
            var detail = TemplateGalleryProjection.ProjectDetail(preset, Localizer);
            Assert.False(string.IsNullOrWhiteSpace(detail.Name));
            Assert.NotNull(detail.Description);
            Assert.Equal(preset.WidgetCount, detail.Widgets.Count);
        }
    }

    // ── i18n: every string flows through the facade ───────────────────────────────────────────────────

    [Fact]
    public void Gallery_labels_resolve_through_the_expected_keys()
    {
        var recorder = new RecordingLocalizer();

        TemplateGalleryProjection.ProjectGallery(TemplateGalleryModel.Default, recorder);

        var keys = recorder.Calls.Select(c => c.Key).ToHashSet();
        Assert.Contains("templates.title", keys);
        Assert.Contains("templates.blank", keys);
        Assert.Contains("templates.blank.desc", keys);
        Assert.Contains("templates.widgetCount", keys);
        Assert.Contains("templates.default.name", keys);
    }

    [Fact]
    public void Detail_labels_resolve_through_the_expected_keys()
    {
        var recorder = new RecordingLocalizer();

        TemplateGalleryProjection.ProjectDetail(DashboardPresets.Find("fleet_manager")!, recorder);

        var keys = recorder.Calls.Select(c => c.Key).ToHashSet();
        Assert.Contains("templates.detail", keys);
        Assert.Contains("templates.fleet_manager.name", keys);
        Assert.Contains("templates.fleetManager.desc", keys); // web uses a camelCase description key
        Assert.Contains("templates.widgetCount", keys);
        Assert.Contains("templates.apply", keys);
        Assert.Contains("common.back", keys);
    }

    [Fact]
    public void Labels_flow_through_the_localizer_verbatim_with_no_hardcoded_english()
    {
        const string localized = "ダッシュボードテンプレート";
        var recorder = new RecordingLocalizer((_, _) => localized);

        var gallery = TemplateGalleryProjection.ProjectGallery(TemplateGalleryModel.Default, recorder);
        var detail = TemplateGalleryProjection.ProjectDetail(DashboardPresets.Find("minimal")!, recorder);

        Assert.Equal(localized, gallery.Title);
        Assert.Equal(localized, gallery.Blank.Title);
        Assert.Equal(localized, detail.Name);
        Assert.Equal(localized, detail.ApplyLabel);
    }

    [Fact]
    public void Widget_count_text_substitutes_the_i18next_count_token()
    {
        Assert.Equal("8 widgets", TemplateGalleryRegistration.WidgetCountText(Localizer, 8));

        var custom = new RecordingLocalizer((_, _) => "Includes {{count}} panels");
        Assert.Equal("Includes 3 panels", TemplateGalleryRegistration.WidgetCountText(custom, 3));
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_blank_id_and_glyphs()
    {
        Assert.Equal("TemplateGallery", TemplateGalleryRegistration.Slug);
        Assert.Equal("__blank__", TemplateGalleryRegistration.BlankApplyId);
        Assert.Equal(5, TemplateGalleryRegistration.MaxCategoryIcons);
        Assert.Equal("\uE80A", TemplateGalleryRegistration.BlankGlyph);
        Assert.Equal("\uE72B", TemplateGalleryRegistration.BackGlyph);
        Assert.Equal("\uE734", TemplateGalleryRegistration.ApplyGlyph);
    }

    [Fact]
    public void Registration_name_key_follows_the_preset_id()
    {
        Assert.Equal("templates.fleet_manager.name", TemplateGalleryRegistration.NameKey("fleet_manager"));
    }

    // ── Diagnostics (P1/S11): view.opened + selection + apply, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new TemplateGalleryDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TemplateGallery", captured[0]);
    }

    [Fact]
    public void Diagnostics_records_selection_and_apply_with_only_the_catalog_id()
    {
        var captured = new List<string>();
        var diagnostics = new TemplateGalleryDiagnostics(captured.Add);

        diagnostics.RecordTemplateSelected("minimal");
        diagnostics.RecordTemplateApplied("__blank__");

        Assert.Equal(1, diagnostics.Selections);
        Assert.Equal(1, diagnostics.Applies);
        Assert.Equal("template.selected slug=TemplateGallery id=minimal", captured[0]);
        Assert.Equal("template.applied slug=TemplateGallery id=__blank__", captured[1]);
    }

    // ── Null-argument guards ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => TemplateGalleryProjection.ProjectGallery(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            TemplateGalleryProjection.ProjectGallery(TemplateGalleryModel.Default, null!));
        Assert.Throws<ArgumentNullException>(() => TemplateGalleryProjection.ProjectCard(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => TemplateGalleryProjection.ProjectDetail(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            TemplateGalleryProjection.CategoryIcons(null!, Localizer));
    }

    [Fact]
    public void Diagnostics_rejects_a_null_preset_id()
    {
        var diagnostics = new TemplateGalleryDiagnostics();
        Assert.Throws<ArgumentNullException>(() => diagnostics.RecordTemplateSelected(null!));
        Assert.Throws<ArgumentNullException>(() => diagnostics.RecordTemplateApplied(null!));
    }

    private static void AssertItem(MiniGridLayoutItem item, string key, int x, int y, int w, int h)
    {
        Assert.Equal(key, item.Key);
        Assert.Equal(x, item.X);
        Assert.Equal(y, item.Y);
        Assert.Equal(w, item.W);
        Assert.Equal(h, item.H);
    }

    /// <summary>An <see cref="ILocalizer"/> double that records every (key, fallback) call and returns either a
    /// configured translation or the fallback verbatim, so the keyed call sites are asserted headlessly.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly Func<string, string, string>? _resolver;

        public RecordingLocalizer(Func<string, string, string>? resolver = null) => _resolver = resolver;

        public List<(string Key, string Fallback)> Calls { get; } = new();

        public string GetString(string key, string fallback)
        {
            Calls.Add((key, fallback));
            return _resolver?.Invoke(key, fallback) ?? fallback;
        }
    }
}
