using System.ComponentModel;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>DateGroupedList</c> shared surface's UI-thread-free logic — the divider
/// header projection (the data adapter: date label, "· {relativeLabel}" separator composition, summary,
/// section id and the <c>aria-labelledby</c> accessible name), the bucket source/store (seed / replace +
/// change notification), the view-model's empty (web empty-container) vs populated states, the projected
/// headers, the PII-safe diagnostics and the argument validation. Mirrors the web spec one-for-one
/// (web/src/components/data-display/DateGroupedList.tsx + its __tests__). The WinUI view itself (the
/// per-section divider row, hairline rule and rendered items) is exercised by the app build.
/// </summary>
public sealed class DateGroupedListTests
{
    private static readonly string Sep = DateGroupedListLayout.RelativeSeparator;

    // ── Projection (the data adapter): label, relative separator, summary, section id, accessible name ───

    [Fact]
    public void Header_carries_the_bucket_metadata()
    {
        var header = DateGroupedListProjection.Header(
            Group("2026-05-09", "May 9, 2026", relativeLabel: "3 days ago", summary: "2 drives " + Sep + " 6.2 mi"));

        Assert.Equal("2026-05-09", header.DateKey);
        Assert.Equal("May 9, 2026", header.DateLabel);
        Assert.Equal("3 days ago", header.RelativeLabel);
        Assert.Equal("2 drives " + Sep + " 6.2 mi", header.Summary);
        Assert.True(header.HasRelativeLabel);
        Assert.True(header.HasSummary);
    }

    [Fact]
    public void Header_composes_the_relative_display_with_the_web_separator()
    {
        var header = DateGroupedListProjection.Header(
            Group("2026-05-09", "May 9, 2026", relativeLabel: "3 days ago"));

        // web: <span>· {group.relativeLabel}</span>
        Assert.Equal(Sep + " 3 days ago", header.RelativeDisplay);
    }

    [Fact]
    public void Header_section_id_uses_the_web_prefix()
    {
        var header = DateGroupedListProjection.Header(Group("2026-04-24", "Apr 24, 2026"));

        // web: id={`date-group-${group.dateKey}`}
        Assert.Equal("date-group-2026-04-24", header.SectionId);
    }

    [Fact]
    public void Header_accessible_name_concatenates_the_visible_header_text()
    {
        var header = DateGroupedListProjection.Header(
            Group("2026-05-09", "May 9, 2026", relativeLabel: "3 days ago", summary: "2 drives " + Sep + " 6.2 mi"));

        // web aria-labelledby points at the header; its accessible name is the header's text content.
        Assert.Equal("May 9, 2026 " + Sep + " 3 days ago 2 drives " + Sep + " 6.2 mi", header.AccessibleName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Header_without_a_relative_label_hides_the_span(string? relativeLabel)
    {
        var header = DateGroupedListProjection.Header(
            Group("2026-05-09", "May 9, 2026", relativeLabel: relativeLabel, summary: "2 drives"));

        Assert.False(header.HasRelativeLabel);
        Assert.Null(header.RelativeDisplay);
        Assert.Equal("May 9, 2026 2 drives", header.AccessibleName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Header_without_a_summary_hides_the_span(string? summary)
    {
        var header = DateGroupedListProjection.Header(
            Group("2026-05-09", "May 9, 2026", relativeLabel: "3 days ago", summary: summary));

        Assert.False(header.HasSummary);
        Assert.Equal("May 9, 2026 " + Sep + " 3 days ago", header.AccessibleName);
    }

    [Fact]
    public void Header_accessible_name_is_just_the_label_when_there_are_no_extras()
    {
        var header = DateGroupedListProjection.Header(Group("2026-05-09", "May 9, 2026"));

        Assert.False(header.HasRelativeLabel);
        Assert.False(header.HasSummary);
        Assert.Equal("May 9, 2026", header.AccessibleName);
    }

    [Fact]
    public void Projection_rejects_null_input() =>
        Assert.Throws<ArgumentNullException>(() => DateGroupedListProjection.Header<Item>(null!));

    // ── Source / store (the P1/S8 seam): seed, replace, change notification ──────────────────────────────

    [Fact]
    public void Store_exposes_seeded_groups_in_order()
    {
        var store = new DateGroupedListStore<Item>(
        [
            Group("2026-05-09", "May 9, 2026", items: new Item(1, "Drive 1")),
            Group("2026-04-24", "Apr 24, 2026", items: new Item(2, "Drive 2")),
        ]);

        Assert.Equal(new[] { "2026-05-09", "2026-04-24" }, store.Groups.Select(g => g.DateKey));
    }

    [Fact]
    public void A_default_store_starts_empty() =>
        Assert.Empty(new DateGroupedListStore<Item>().Groups);

    [Fact]
    public void Replace_swaps_the_set_and_raises_changed()
    {
        var store = new DateGroupedListStore<Item>([Group("2026-05-09", "May 9, 2026")]);
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Replace([Group("2026-04-24", "Apr 24, 2026"), Group("2026-04-23", "Apr 23, 2026")]);

        Assert.Equal(new[] { "2026-04-24", "2026-04-23" }, store.Groups.Select(g => g.DateKey));
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Replace_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => new DateGroupedListStore<Item>().Replace(null!));

    // ── View-model state: empty (web empty container) vs populated ───────────────────────────────────────

    [Fact]
    public void View_model_is_empty_with_no_groups()
    {
        using var vm = new DateGroupedListViewModel<Item>(new DateGroupedListStore<Item>());

        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasGroups);
        Assert.Empty(vm.Groups);
        Assert.Empty(vm.Headers);
    }

    [Fact]
    public void View_model_projects_groups_and_headers_when_populated()
    {
        var store = new DateGroupedListStore<Item>(
        [
            Group("2026-05-09", "May 9, 2026", relativeLabel: "3 days ago", summary: "2 drives", items: new Item(1, "A")),
            Group("2026-04-24", "Apr 24, 2026", items: new Item(2, "B")),
        ]);
        using var vm = new DateGroupedListViewModel<Item>(store);

        Assert.False(vm.IsEmpty);
        Assert.True(vm.HasGroups);
        Assert.Equal(new[] { "2026-05-09", "2026-04-24" }, vm.Groups.Select(g => g.DateKey));
        Assert.Equal(new[] { "date-group-2026-05-09", "date-group-2026-04-24" }, vm.Headers.Select(h => h.SectionId));
        Assert.Equal(Sep + " 3 days ago", vm.Headers[0].RelativeDisplay);
    }

    [Fact]
    public void Replacing_to_an_empty_set_returns_to_the_empty_container_state()
    {
        var store = new DateGroupedListStore<Item>([Group("2026-05-09", "May 9, 2026")]);
        using var vm = new DateGroupedListViewModel<Item>(store);

        store.Replace([]);

        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.Headers);
    }

    [Fact]
    public void View_model_reprojects_when_the_source_changes()
    {
        var store = new DateGroupedListStore<Item>([Group("2026-05-09", "May 9, 2026")]);
        using var vm = new DateGroupedListViewModel<Item>(store);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        store.Replace([Group("2026-04-24", "Apr 24, 2026"), Group("2026-04-23", "Apr 23, 2026")]);

        Assert.Equal(new[] { "2026-04-24", "2026-04-23" }, vm.Groups.Select(g => g.DateKey));
        Assert.Contains(nameof(DateGroupedListViewModel<Item>.IsEmpty), changed);
        Assert.Contains(nameof(DateGroupedListViewModel<Item>.HasGroups), changed);
        Assert.Contains(nameof(DateGroupedListViewModel<Item>.Groups), changed);
        Assert.Contains(nameof(DateGroupedListViewModel<Item>.Headers), changed);
    }

    // ── Diagnostics (P1/S11): slug-only view.opened, never the bucket content ────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DateGroupedListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DateGroupedList", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new DateGroupedListDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Notify_opened_emits_the_view_opened_event_once()
    {
        var lines = new List<string>();
        using var vm = new DateGroupedListViewModel<Item>(
            new DateGroupedListStore<Item>(), new DateGroupedListDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.NotifyOpened();

        Assert.Equal("view.opened slug=DateGroupedList", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_the_bucket_content()
    {
        var lines = new List<string>();
        var store = new DateGroupedListStore<Item>(
        [
            Group("2026-05-09", "VIN 5YJ-secret", relativeLabel: "private note", summary: "secret 42 mi",
                items: new Item(1, "private drive")),
        ]);
        using var vm = new DateGroupedListViewModel<Item>(store, new DateGroupedListDiagnostics(lines.Add));

        vm.NotifyOpened();
        store.Replace([]);

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("VIN 5YJ-secret", line, StringComparison.Ordinal);
            Assert.DoesNotContain("private note", line, StringComparison.Ordinal);
            Assert.DoesNotContain("secret 42 mi", line, StringComparison.Ordinal);
        });
    }

    // ── Lifecycle + argument validation ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Disposed_view_model_unsubscribes_and_ignores_further_changes()
    {
        var store = new DateGroupedListStore<Item>([Group("2026-05-09", "May 9, 2026")]);
        var vm = new DateGroupedListViewModel<Item>(store);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Dispose();
        store.Replace([Group("2026-04-24", "Apr 24, 2026")]);

        Assert.Empty(changed);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new DateGroupedListViewModel<Item>(new DateGroupedListStore<Item>());

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void View_model_rejects_a_null_source() =>
        Assert.Throws<ArgumentNullException>(() => new DateGroupedListViewModel<Item>(null!));

    // ── Registration / layout metadata is stable and matches the web source ──────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("DateGroupedList", DateGroupedListRegistration.Slug);
        Assert.Equal("date-grouped-list-root", DateGroupedListRegistration.RootAutomationId);
    }

    [Fact]
    public void Layout_constants_match_the_web_rem_to_px_values()
    {
        Assert.Equal(24, DateGroupedListLayout.GroupSpacing);        // space-y-6
        Assert.Equal(12, DateGroupedListLayout.ItemSpacing);         // space-y-3
        Assert.Equal(12, DateGroupedListLayout.HeaderColumnSpacing); // gap-3
        Assert.Equal(8, DateGroupedListLayout.LabelGroupSpacing);    // gap-2
        Assert.Equal(12, DateGroupedListLayout.HeaderBottomMargin);  // mb-3
        Assert.Equal(1, DateGroupedListLayout.DividerThickness);     // h-px
        Assert.Equal(0.5, DateGroupedListLayout.DividerOpacity);     // opacity-50
        Assert.Equal(12, DateGroupedListLayout.HeaderFontSize);      // text-xs
        Assert.Equal("\u00B7", DateGroupedListLayout.RelativeSeparator);
        Assert.Equal("date-group-", DateGroupedListLayout.SectionIdPrefix);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static DateGroupedListGroup<Item> Group(
        string dateKey,
        string dateLabel,
        string? relativeLabel = null,
        string? summary = null,
        params Item[] items) =>
        new()
        {
            DateKey = dateKey,
            DateLabel = dateLabel,
            RelativeLabel = relativeLabel,
            Summary = summary,
            Items = items,
        };

    private sealed record Item(int Id, string Label);
}
