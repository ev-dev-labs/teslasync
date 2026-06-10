using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>CollapsibleCommandGroup</c> feature surface's UI-thread-free logic — the
/// category metadata registry (the web <c>CATEGORY_META</c> / <c>CATEGORY_ORDER</c>), the projection (label +
/// glyph + count + persisted key + accessible name), the persisted-expansion adapter (cached → initial state),
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/CollapsibleCommandGroup.tsx and the category map in
/// web/src/features/system/commands.ts). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class CollapsibleCommandGroupTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static CollapsibleCommandGroupDisplay Project(CollapsibleCommandGroupModel model) =>
        CollapsibleCommandGroupProjection.Project(model, Localizer);

    private static CollapsibleCommandGroupModel Model(
        CommandCategory category = CommandCategory.Security,
        long vehicleId = 42,
        int count = 5,
        bool defaultOpen = false) =>
        new(category, vehicleId, count, defaultOpen);

    // ── Category metadata: the web CATEGORY_META map, row-for-row ────────────────────────────────────────

    [Theory]
    [InlineData(CommandCategory.Security, "security", "commands.cat.security", "Security & Access")]
    [InlineData(CommandCategory.Climate, "climate", "commands.cat.climate", "Climate & Comfort")]
    [InlineData(CommandCategory.ClimateProtection, "climate_protection", "commands.cat.climateProtect", "Climate Protection")]
    [InlineData(CommandCategory.Charging, "charging", "commands.cat.charging", "Charging")]
    [InlineData(CommandCategory.Doors, "doors", "commands.cat.doors", "Doors & Trunk")]
    [InlineData(CommandCategory.Drive, "drive", "commands.cat.drive", "Drive")]
    [InlineData(CommandCategory.Windows, "windows", "commands.cat.windows", "Windows")]
    [InlineData(CommandCategory.Sunroof, "sunroof", "commands.cat.sunroof", "Sunroof")]
    [InlineData(CommandCategory.Schedules, "schedules", "commands.cat.schedules", "Schedules")]
    [InlineData(CommandCategory.Alerts, "alerts", "commands.cat.alerts", "Alerts & Location")]
    [InlineData(CommandCategory.Navigation, "navigation", "commands.cat.navigation", "Navigation")]
    [InlineData(CommandCategory.Software, "software", "commands.cat.software", "Software")]
    [InlineData(CommandCategory.Vehicle, "vehicle", "commands.cat.vehicle", "Vehicle")]
    [InlineData(CommandCategory.Media, "media", "commands.cat.media", "Media")]
    public void Metadata_matches_the_web_category_map(
        CommandCategory category, string slug, string labelKey, string fallback)
    {
        CommandCategoryInfo info = CommandCategoryMetadata.For(category);

        Assert.Equal(category, info.Category);
        Assert.Equal(slug, info.Slug);
        Assert.Equal(slug, CommandCategoryMetadata.SlugOf(category));
        Assert.Equal(labelKey, info.LabelKey);
        Assert.Equal(fallback, info.Fallback);
        Assert.False(string.IsNullOrEmpty(info.Glyph));
    }

    [Fact]
    public void Order_matches_the_web_category_order()
    {
        Assert.Equal(
            new[]
            {
                CommandCategory.Security, CommandCategory.Climate, CommandCategory.ClimateProtection,
                CommandCategory.Charging, CommandCategory.Doors, CommandCategory.Drive, CommandCategory.Windows,
                CommandCategory.Sunroof, CommandCategory.Schedules, CommandCategory.Alerts,
                CommandCategory.Navigation, CommandCategory.Software, CommandCategory.Vehicle, CommandCategory.Media,
            },
            CommandCategoryMetadata.Order);
    }

    [Fact]
    public void Order_covers_every_category_exactly_once()
    {
        CommandCategory[] all = Enum.GetValues<CommandCategory>();

        Assert.Equal(all.Length, CommandCategoryMetadata.Order.Count);
        Assert.Equal(all.Length, CommandCategoryMetadata.Order.Distinct().Count());
        Assert.All(all, c => Assert.Contains(c, CommandCategoryMetadata.Order));
    }

    [Fact]
    public void Slugs_are_unique_across_categories()
    {
        IEnumerable<string> slugs = Enum.GetValues<CommandCategory>().Select(CommandCategoryMetadata.SlugOf);

        Assert.Equal(14, slugs.Distinct(StringComparer.Ordinal).Count());
    }

    // ── Projection: label, glyph, count, key, accessible name ────────────────────────────────────────────

    [Fact]
    public void Label_resolves_through_the_i18n_facade_fallback()
    {
        CollapsibleCommandGroupDisplay display = Project(Model(CommandCategory.ClimateProtection));

        Assert.Equal("Climate Protection", display.Label);
    }

    [Fact]
    public void DisplayLabel_is_the_uppercased_label()
    {
        CollapsibleCommandGroupDisplay display = Project(Model(CommandCategory.Security));

        Assert.Equal(display.Label.ToUpper(CultureInfo.CurrentCulture), display.DisplayLabel);
        Assert.Equal("Security & Access", display.Label);
    }

    [Fact]
    public void Glyph_comes_from_the_category_metadata()
    {
        CollapsibleCommandGroupDisplay display = Project(Model(CommandCategory.Charging));

        Assert.Equal(CommandCategoryMetadata.For(CommandCategory.Charging).Glyph, display.Glyph);
    }

    [Fact]
    public void Count_text_is_parenthesised()
    {
        Assert.Equal("(5)", Project(Model(count: 5)).CountText);
        Assert.Equal("(0)", Project(Model(count: 0)).CountText);
    }

    [Fact]
    public void Count_is_clamped_to_zero_when_negative()
    {
        CollapsibleCommandGroupDisplay display = Project(Model(count: -3));

        Assert.Equal(0, display.Count);
        Assert.Equal("(0)", display.CountText);
    }

    [Fact]
    public void Count_is_passed_through_when_present()
    {
        Assert.Equal(12, Project(Model(count: 12)).Count);
    }

    // ── Persisted expansion key: the web teslasync-cat-{vehicleId}-{category} ─────────────────────────────

    [Fact]
    public void Storage_key_matches_the_web_session_storage_key()
    {
        Assert.Equal(
            "teslasync-cat-42-climate_protection",
            Project(Model(CommandCategory.ClimateProtection, vehicleId: 42)).StorageKey);
    }

    [Theory]
    [InlineData(CommandCategory.Security, 1, "teslasync-cat-1-security")]
    [InlineData(CommandCategory.Media, 7, "teslasync-cat-7-media")]
    [InlineData(CommandCategory.Charging, 1234567890, "teslasync-cat-1234567890-charging")]
    public void Storage_key_is_built_for_each_vehicle_and_category(
        CommandCategory category, long vehicleId, string expected)
    {
        Assert.Equal(expected, CollapsibleCommandGroupProjection.StorageKey(vehicleId, category));
        Assert.Equal(expected, Project(Model(category, vehicleId)).StorageKey);
    }

    [Fact]
    public void Storage_key_uses_the_web_prefix()
    {
        Assert.Equal("teslasync-cat-", CollapsibleCommandGroupProjection.StorageKeyPrefix);
        Assert.StartsWith(
            CollapsibleCommandGroupProjection.StorageKeyPrefix,
            CollapsibleCommandGroupProjection.StorageKey(1, CommandCategory.Security),
            StringComparison.Ordinal);
    }

    // ── Adapter: cached expansion state → resolved initial state ──────────────────────────────────────────

    [Fact]
    public void Initial_expansion_falls_back_to_default_open_when_uncached()
    {
        var store = new SessionCommandGroupExpansionStore();

        Assert.True(CollapsibleCommandGroupProjection.ResolveInitialExpanded(Model(defaultOpen: true), store));
        Assert.False(CollapsibleCommandGroupProjection.ResolveInitialExpanded(Model(defaultOpen: false), store));
    }

    [Fact]
    public void Initial_expansion_uses_the_cached_value_over_default_open()
    {
        var store = new SessionCommandGroupExpansionStore();
        CollapsibleCommandGroupModel model = Model(CommandCategory.Doors, vehicleId: 9, defaultOpen: true);
        string key = CollapsibleCommandGroupProjection.StorageKey(model.VehicleId, model.Category);

        store.SetExpanded(key, false);

        Assert.False(CollapsibleCommandGroupProjection.ResolveInitialExpanded(model, store));
    }

    [Fact]
    public void Initial_expansion_uses_a_cached_open_state_over_a_closed_default()
    {
        var store = new SessionCommandGroupExpansionStore();
        CollapsibleCommandGroupModel model = Model(CommandCategory.Doors, vehicleId: 9, defaultOpen: false);

        store.SetExpanded(CollapsibleCommandGroupProjection.StorageKey(model.VehicleId, model.Category), true);

        Assert.True(CollapsibleCommandGroupProjection.ResolveInitialExpanded(model, store));
    }

    [Fact]
    public void Cached_state_is_scoped_per_vehicle_and_category()
    {
        var store = new SessionCommandGroupExpansionStore();
        store.SetExpanded(CollapsibleCommandGroupProjection.StorageKey(1, CommandCategory.Security), true);

        // A different vehicle, or a different category on the same vehicle, is unaffected.
        Assert.False(CollapsibleCommandGroupProjection.ResolveInitialExpanded(Model(CommandCategory.Security, vehicleId: 2), store));
        Assert.False(CollapsibleCommandGroupProjection.ResolveInitialExpanded(Model(CommandCategory.Climate, vehicleId: 1), store));
        Assert.True(CollapsibleCommandGroupProjection.ResolveInitialExpanded(Model(CommandCategory.Security, vehicleId: 1), store));
    }

    // ── Session expansion store ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Store_returns_null_when_nothing_saved() =>
        Assert.Null(new SessionCommandGroupExpansionStore().GetExpanded("teslasync-cat-1-security"));

    [Fact]
    public void Store_round_trips_a_saved_value()
    {
        var store = new SessionCommandGroupExpansionStore();

        store.SetExpanded("k", true);
        Assert.True(store.GetExpanded("k"));

        store.SetExpanded("k", false);
        Assert.False(store.GetExpanded("k"));
    }

    [Fact]
    public void Store_keys_are_case_sensitive()
    {
        var store = new SessionCommandGroupExpansionStore();
        store.SetExpanded("Key", true);

        Assert.Null(store.GetExpanded("key"));
        Assert.True(store.GetExpanded("Key"));
    }

    [Fact]
    public void Store_rejects_null_or_empty_keys()
    {
        var store = new SessionCommandGroupExpansionStore();

        Assert.Throws<ArgumentNullException>(() => store.GetExpanded(null!));
        Assert.Throws<ArgumentException>(() => store.GetExpanded(string.Empty));
        Assert.Throws<ArgumentNullException>(() => store.SetExpanded(null!, true));
        Assert.Throws<ArgumentException>(() => store.SetExpanded(string.Empty, true));
    }

    [Fact]
    public void Shared_store_is_a_singleton() =>
        Assert.Same(SessionCommandGroupExpansionStore.Shared, SessionCommandGroupExpansionStore.Shared);

    // ── Accessibility: the disclosure header exposes a meaningful Narrator name ───────────────────────────

    [Fact]
    public void Automation_name_carries_the_label_and_count()
    {
        CollapsibleCommandGroupDisplay display = Project(Model(CommandCategory.Security, count: 5));

        Assert.Equal("Security & Access (5)", display.AutomationName);
    }

    [Fact]
    public void Automation_name_is_never_blank_for_any_category()
    {
        Assert.All(
            Enum.GetValues<CommandCategory>(),
            category => Assert.False(string.IsNullOrWhiteSpace(Project(Model(category)).AutomationName)));
    }

    // ── Diagnostics (P1/S11): view.opened slug=CollapsibleCommandGroup, PII-safe ─────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new CollapsibleCommandGroupDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CollapsibleCommandGroup", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_vehicle_or_category()
    {
        var captured = new List<string>();
        var diagnostics = new CollapsibleCommandGroupDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=CollapsibleCommandGroup", line);
        Assert.DoesNotContain("teslasync-cat-", line, StringComparison.Ordinal);
        Assert.DoesNotContain("vehicle", line, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Diagnostics_counts_every_open()
    {
        var diagnostics = new CollapsibleCommandGroupDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("CollapsibleCommandGroup", CollapsibleCommandGroupRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => CollapsibleCommandGroupProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => CollapsibleCommandGroupProjection.Project(Model(), null!));

    [Fact]
    public void Resolve_initial_expanded_rejects_null_arguments()
    {
        var store = new SessionCommandGroupExpansionStore();

        Assert.Throws<ArgumentNullException>(() => CollapsibleCommandGroupProjection.ResolveInitialExpanded(null!, store));
        Assert.Throws<ArgumentNullException>(() => CollapsibleCommandGroupProjection.ResolveInitialExpanded(Model(), null!));
    }
}
