using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the <c>WidgetRankedList</c> widget primitive's UI-thread-free logic — the
/// compact-aware row cap, the descending stable sort + slice, the zero-seeded bar scale and clamped bar widths,
/// the <c>error → danger</c> badge mapping, the default bar tint, the always-rendered empty state (with its
/// localized default + caller override + icon passthrough), the composed per-row accessible names, the
/// registration metadata and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx</c>). The WinUI view itself
/// (WidgetRankedList.cs) is exercised by the app build.
/// </summary>
public sealed class WidgetRankedListTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WidgetRankedListDisplay Project(WidgetRankedListModel model) =>
        WidgetRankedListProjection.Project(model, Localizer);

    private static RankedItem Item(string id, double value, string? formatted = null, RankedBadge? badge = null, string? barColorHex = null) =>
        new(id, $"Label {id}", value, formatted ?? value.ToString(System.Globalization.CultureInfo.InvariantCulture), badge, barColorHex);

    private static WidgetRankedListModel ModelOf(IReadOnlyList<RankedItem> items, int? maxItems = null, bool compact = false, bool showBars = true) =>
        new(items, maxItems, compact, showBars);

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("WidgetRankedList", WidgetRankedListRegistration.Slug);

    // ── row cap: maxItems ?? (compact ? 3 : 5) ───────────────────────────────────────────────────────────

    [Fact]
    public void Default_limit_is_five_when_not_compact() =>
        Assert.Equal(5, WidgetRankedListProjection.LimitFor(new WidgetRankedListModel()));

    [Fact]
    public void Compact_limit_is_three() =>
        Assert.Equal(3, WidgetRankedListProjection.LimitFor(new WidgetRankedListModel(compact: true)));

    [Fact]
    public void Explicit_max_items_overrides_the_compact_default()
    {
        Assert.Equal(2, WidgetRankedListProjection.LimitFor(new WidgetRankedListModel(maxItems: 2)));
        Assert.Equal(7, WidgetRankedListProjection.LimitFor(new WidgetRankedListModel(maxItems: 7, compact: true)));
    }

    [Fact]
    public void Non_compact_list_caps_at_five_rows()
    {
        var items = Enumerable.Range(1, 8).Select(i => Item(i.ToString(System.Globalization.CultureInfo.InvariantCulture), i)).ToList();

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.False(d.IsEmpty);
        Assert.Equal(5, d.Rows.Count);
    }

    [Fact]
    public void Compact_list_caps_at_three_rows()
    {
        var items = Enumerable.Range(1, 8).Select(i => Item(i.ToString(System.Globalization.CultureInfo.InvariantCulture), i)).ToList();

        WidgetRankedListDisplay d = Project(ModelOf(items, compact: true));

        Assert.Equal(3, d.Rows.Count);
    }

    [Fact]
    public void Explicit_max_items_caps_the_rows()
    {
        var items = Enumerable.Range(1, 8).Select(i => Item(i.ToString(System.Globalization.CultureInfo.InvariantCulture), i)).ToList();

        Assert.Equal(2, Project(ModelOf(items, maxItems: 2)).Rows.Count);
    }

    [Fact]
    public void Fewer_items_than_the_cap_shows_them_all()
    {
        var items = new[] { Item("a", 10), Item("b", 5) };

        Assert.Equal(2, Project(ModelOf(items, maxItems: 5)).Rows.Count);
    }

    // ── descending stable sort (web sort((a,b)=>b.value-a.value).slice) ──────────────────────────────────

    [Fact]
    public void Rows_are_sorted_descending_by_value_and_ranked()
    {
        var items = new[] { Item("low", 5), Item("high", 50), Item("mid", 20) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.Equal(new[] { "Label high", "Label mid", "Label low" }, d.Rows.Select(r => r.Label));
        Assert.Equal(new[] { 1, 2, 3 }, d.Rows.Select(r => r.Rank));
    }

    [Fact]
    public void Equal_values_keep_input_order_stable_sort()
    {
        // JS Array.prototype.sort is stable; LINQ OrderByDescending is too. Equal values keep input order.
        var items = new[] { Item("first", 10), Item("second", 10), Item("third", 5) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.Equal(new[] { "Label first", "Label second", "Label third" }, d.Rows.Select(r => r.Label));
    }

    // ── bar scale (web reduce(Math.max, 0)) + clamped bar width ──────────────────────────────────────────

    [Fact]
    public void Bar_percent_is_proportional_to_the_max_value()
    {
        var items = new[] { Item("a", 100), Item("b", 50), Item("c", 25) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.Equal(100, d.Rows[0].BarPercent);
        Assert.Equal(50, d.Rows[1].BarPercent);
        Assert.Equal(25, d.Rows[2].BarPercent);
    }

    [Fact]
    public void All_non_positive_values_yield_zero_width_bars()
    {
        // web maxValue is reduce(Math.max, 0): an all-negative set keeps the 0 seed, so barPct = 0 everywhere.
        var items = new[] { Item("a", -10), Item("b", -20) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.All(d.Rows, r => Assert.Equal(0, r.BarPercent));
    }

    [Fact]
    public void Bar_percent_is_clamped_to_the_rendered_range()
    {
        var items = new[] { Item("top", 80), Item("neg", -40) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.Equal(100, d.Rows[0].BarPercent);     // value == maxValue
        Assert.Equal(0, d.Rows[1].BarPercent);        // negative ratio clamps to 0 (never a negative width)
        Assert.All(d.Rows, r => Assert.InRange(r.BarPercent, 0, 100));
    }

    // ── show / hide bars (web hideBars = compact || !showBars) ───────────────────────────────────────────

    [Fact]
    public void Bars_show_by_default()
    {
        var items = new[] { Item("a", 10) };

        Assert.True(Project(ModelOf(items)).Rows[0].ShowBar);
    }

    [Fact]
    public void Compact_hides_the_bars()
    {
        var items = new[] { Item("a", 10) };

        Assert.False(Project(ModelOf(items, compact: true)).Rows[0].ShowBar);
    }

    [Fact]
    public void Show_bars_false_hides_the_bars()
    {
        var items = new[] { Item("a", 10) };

        Assert.False(Project(ModelOf(items, showBars: false)).Rows[0].ShowBar);
    }

    // ── bar colour (web item.barColor ?? 'bg-blue-400') ──────────────────────────────────────────────────

    [Fact]
    public void Missing_bar_color_falls_back_to_the_default_blue()
    {
        var items = new[] { Item("a", 10) };

        Assert.Equal("#60a5fa", Project(ModelOf(items)).Rows[0].BarColorHex);
        Assert.Equal("#60a5fa", WidgetRankedListProjection.DefaultBarColorHex);
    }

    [Fact]
    public void Supplied_bar_color_is_preserved()
    {
        var items = new[] { Item("a", 10, barColorHex: "#10b981") };

        Assert.Equal("#10b981", Project(ModelOf(items)).Rows[0].BarColorHex);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_bar_color_falls_back_to_the_default(string barColor)
    {
        var items = new[] { Item("a", 10, barColorHex: barColor) };

        Assert.Equal("#60a5fa", Project(ModelOf(items)).Rows[0].BarColorHex);
    }

    // ── badge variant mapping (web badgeVariantMap, error → danger) ──────────────────────────────────────

    [Theory]
    [InlineData(RankedBadgeVariant.Success, StatusKind.Success)]
    [InlineData(RankedBadgeVariant.Warning, StatusKind.Warning)]
    [InlineData(RankedBadgeVariant.Error, StatusKind.Danger)]
    [InlineData(RankedBadgeVariant.Neutral, StatusKind.Neutral)]
    public void Badge_variant_maps_to_the_native_status(RankedBadgeVariant variant, StatusKind expected) =>
        Assert.Equal(expected, WidgetRankedListProjection.StatusFor(variant));

    [Fact]
    public void Row_badge_is_projected_with_text_and_status()
    {
        var items = new[] { Item("a", 10, badge: new RankedBadge("Best", RankedBadgeVariant.Error)) };

        RankedBadgeDisplay? badge = Project(ModelOf(items)).Rows[0].Badge;

        Assert.NotNull(badge);
        Assert.Equal("Best", badge!.Text);
        Assert.Equal(StatusKind.Danger, badge.Status);
    }

    [Fact]
    public void Row_without_a_badge_has_none()
    {
        var items = new[] { Item("a", 10) };

        Assert.Null(Project(ModelOf(items)).Rows[0].Badge);
    }

    // ── empty branch (web visible.length === 0 → <EmptyState …>) ─────────────────────────────────────────

    [Fact]
    public void No_items_renders_the_empty_state_with_the_localized_default()
    {
        WidgetRankedListDisplay d = Project(WidgetRankedListModel.Empty);

        Assert.True(d.IsEmpty);
        Assert.Empty(d.Rows);
        Assert.Equal("No data available", d.EmptyMessage);
    }

    [Fact]
    public void Empty_message_override_is_used_when_supplied()
    {
        var model = new WidgetRankedListModel(emptyMessage: "No drives yet");

        WidgetRankedListDisplay d = Project(model);

        Assert.True(d.IsEmpty);
        Assert.Equal("No drives yet", d.EmptyMessage);
    }

    [Fact]
    public void Empty_icon_glyph_passes_through()
    {
        var model = new WidgetRankedListModel(emptyIconGlyph: "\uE9D9");

        Assert.Equal("\uE9D9", Project(model).EmptyIconGlyph);
    }

    [Fact]
    public void Zero_max_items_renders_the_empty_state()
    {
        var items = new[] { Item("a", 10), Item("b", 5) };

        Assert.True(Project(ModelOf(items, maxItems: 0)).IsEmpty);
    }

    [Fact]
    public void Negative_max_items_renders_the_empty_state()
    {
        var items = new[] { Item("a", 10), Item("b", 5) };

        Assert.True(Project(ModelOf(items, maxItems: -3)).IsEmpty);
    }

    [Fact]
    public void Populated_display_carries_no_empty_message()
    {
        var items = new[] { Item("a", 10) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.False(d.IsEmpty);
        Assert.Equal(string.Empty, d.EmptyMessage);
        Assert.Null(d.EmptyIconGlyph);
    }

    // ── accessibility: composed per-row Narrator name ────────────────────────────────────────────────────

    [Fact]
    public void Row_accessible_name_composes_rank_label_and_value()
    {
        var items = new[] { new RankedItem("a", "Model 3", 42, "12,345 km") };

        RankedRow row = Project(ModelOf(items)).Rows[0];

        Assert.Equal("1. Model 3, 12,345 km", row.AccessibleName);
    }

    [Fact]
    public void Row_accessible_name_includes_the_badge_text()
    {
        var items = new[] { new RankedItem("a", "Model Y", 42, "9,001 km", new RankedBadge("Top", RankedBadgeVariant.Success)) };

        RankedRow row = Project(ModelOf(items)).Rows[0];

        Assert.Equal("1. Model Y, 9,001 km (Top)", row.AccessibleName);
    }

    [Fact]
    public void Row_accessible_name_never_leaks_interpolation_tokens()
    {
        var items = new[] { Item("a", 10, badge: new RankedBadge("X", RankedBadgeVariant.Neutral)), Item("b", 5) };

        foreach (RankedRow row in Project(ModelOf(items)).Rows)
        {
            Assert.DoesNotContain("{{", row.AccessibleName, StringComparison.Ordinal);
            Assert.DoesNotContain("}}", row.AccessibleName, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(row.AccessibleName));
        }
    }

    [Fact]
    public void Row_rank_reflects_the_sorted_position_in_the_accessible_name()
    {
        var items = new[] { Item("low", 5), Item("high", 50) };

        WidgetRankedListDisplay d = Project(ModelOf(items));

        Assert.StartsWith("1. ", d.Rows[0].AccessibleName, StringComparison.Ordinal);
        Assert.StartsWith("2. ", d.Rows[1].AccessibleName, StringComparison.Ordinal);
    }

    // ── formatted value is passed through verbatim ───────────────────────────────────────────────────────

    [Fact]
    public void Formatted_value_is_passed_through()
    {
        var items = new[] { new RankedItem("a", "Trip", 1234.5, "1,234.5 kWh") };

        Assert.Equal("1,234.5 kWh", Project(ModelOf(items)).Rows[0].FormattedValue);
    }

    // ── diagnostics (view.opened, PII-safe — never labels or values) ─────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WidgetRankedListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetRankedList", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new WidgetRankedListDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── null safety + argument guards ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_items_are_treated_as_an_empty_list()
    {
        var model = new WidgetRankedListModel(items: null);

        Assert.Empty(model.Items);
        Assert.True(Project(model).IsEmpty);
    }

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => WidgetRankedListProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => WidgetRankedListProjection.Project(WidgetRankedListModel.Empty, null!));

    [Fact]
    public void Limit_for_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => WidgetRankedListProjection.LimitFor(null!));
}
