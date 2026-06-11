using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>AnnotationList</c> shared surface's UI-thread-free logic — the pure row
/// projection (the data adapter: category → web colour, description presence, order), the annotation source/store
/// (seed / remove / replace + change notification), the view-model's empty (web null-render) vs populated states,
/// the localized title and remove accessible name, the PII-safe diagnostics and the argument validation. Mirrors
/// the web spec one-for-one (web/src/components/charts/AnnotationList.tsx + web/src/types/annotations.ts). The
/// WinUI view itself (the title + rows, colour dot, ghost remove button) is exercised by the app build.
/// </summary>
public sealed class AnnotationListTests
{
    // ── Projection (the data adapter): category → colour, description presence, order ────────────────────

    [Fact]
    public void ToRow_carries_id_label_description_and_timestamp()
    {
        var row = AnnotationListProjection.ToRow(
            Annotation("ann-7", "Battery replaced", description: "12V swap", timestamp: "Jan 3, 2024"));

        Assert.Equal("ann-7", row.Id);
        Assert.Equal("Battery replaced", row.Label);
        Assert.Equal("12V swap", row.Description);
        Assert.Equal("Jan 3, 2024", row.Timestamp);
        Assert.True(row.HasDescription);
    }

    [Theory]
    [InlineData(AnnotationCategory.Milestone, "#3b82f6")]
    [InlineData(AnnotationCategory.Maintenance, "#f59e0b")]
    [InlineData(AnnotationCategory.Trip, "#22c55e")]
    [InlineData(AnnotationCategory.Issue, "#ef4444")]
    [InlineData(AnnotationCategory.Upgrade, "#a855f7")]
    [InlineData(AnnotationCategory.Custom, "#94a3b8")]
    public void ToRow_pins_the_web_annotation_color_for_each_category(AnnotationCategory category, string expected)
    {
        var row = AnnotationListProjection.ToRow(Annotation("1", "x", category: category));

        // web ANNOTATION_COLORS[category] — and the same shared native palette the modal uses.
        Assert.Equal(expected, row.ColorHex);
        Assert.Equal(AddAnnotationRegistration.ColorFor(category), row.ColorHex);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void ToRow_marks_a_missing_description(string? description)
    {
        var row = AnnotationListProjection.ToRow(Annotation("1", "x", description: description));

        Assert.False(row.HasDescription);
    }

    [Fact]
    public void Project_maps_every_annotation_preserving_order()
    {
        var rows = AnnotationListProjection.Project(
        [
            Annotation("a", "First"),
            Annotation("b", "Second"),
            Annotation("c", "Third"),
        ]);

        Assert.Equal(new[] { "a", "b", "c" }, rows.Select(r => r.Id));
        Assert.Equal(new[] { "First", "Second", "Third" }, rows.Select(r => r.Label));
    }

    [Fact]
    public void Project_of_an_empty_collection_yields_no_rows() =>
        Assert.Empty(AnnotationListProjection.Project([]));

    [Fact]
    public void Projection_rejects_null_input()
    {
        Assert.Throws<ArgumentNullException>(() => AnnotationListProjection.ToRow(null!));
        Assert.Throws<ArgumentNullException>(() => AnnotationListProjection.Project(null!));
    }

    // ── Source / store (the P1/S8 seam): seed, remove, replace, change notification ──────────────────────

    [Fact]
    public void Store_exposes_seeded_annotations_in_order()
    {
        var store = new AnnotationListStore([Annotation("a", "A"), Annotation("b", "B")]);

        Assert.Equal(new[] { "a", "b" }, store.Annotations.Select(a => a.Id));
    }

    [Fact]
    public void A_default_store_starts_empty()
    {
        var store = new AnnotationListStore();

        Assert.Empty(store.Annotations);
    }

    [Fact]
    public void Remove_drops_the_matching_annotation_and_raises_changed()
    {
        var store = new AnnotationListStore([Annotation("a", "A"), Annotation("b", "B")]);
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Remove("a");

        Assert.Equal(new[] { "b" }, store.Annotations.Select(a => a.Id));
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Remove_of_an_unknown_id_is_a_silent_no_op()
    {
        var store = new AnnotationListStore([Annotation("a", "A")]);
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Remove("missing");

        Assert.Single(store.Annotations);
        Assert.Equal(0, changes);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Remove_of_an_empty_id_is_a_no_op(string? id)
    {
        var store = new AnnotationListStore([Annotation("a", "A")]);

        store.Remove(id!);

        Assert.Single(store.Annotations);
    }

    [Fact]
    public void Replace_swaps_the_set_and_raises_changed()
    {
        var store = new AnnotationListStore([Annotation("a", "A")]);
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Replace([Annotation("x", "X"), Annotation("y", "Y")]);

        Assert.Equal(new[] { "x", "y" }, store.Annotations.Select(a => a.Id));
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Replace_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => new AnnotationListStore().Replace(null!));

    // ── View-model state: empty (web `return null`) vs populated ─────────────────────────────────────────

    [Fact]
    public void View_model_is_empty_with_no_annotations()
    {
        using var vm = new AnnotationListViewModel(new AnnotationListStore(), PassthroughLocalizer.Instance);

        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasAnnotations);
        Assert.Empty(vm.Rows);
    }

    [Fact]
    public void View_model_projects_rows_when_populated()
    {
        var store = new AnnotationListStore([Annotation("a", "A"), Annotation("b", "B")]);
        using var vm = new AnnotationListViewModel(store, PassthroughLocalizer.Instance);

        Assert.False(vm.IsEmpty);
        Assert.True(vm.HasAnnotations);
        Assert.Equal(new[] { "a", "b" }, vm.Rows.Select(r => r.Id));
    }

    [Fact]
    public void Removing_the_last_annotation_returns_to_the_empty_state()
    {
        var store = new AnnotationListStore([Annotation("a", "A")]);
        using var vm = new AnnotationListViewModel(store, PassthroughLocalizer.Instance);

        vm.Remove("a");

        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.Rows);
    }

    [Fact]
    public void View_model_reprojects_when_the_source_changes()
    {
        var store = new AnnotationListStore([Annotation("a", "A"), Annotation("b", "B")]);
        using var vm = new AnnotationListViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Remove("a");

        Assert.Equal(new[] { "b" }, vm.Rows.Select(r => r.Id));
        Assert.Contains(nameof(AnnotationListViewModel.IsEmpty), changed);
        Assert.Contains(nameof(AnnotationListViewModel.HasAnnotations), changed);
        Assert.Contains(nameof(AnnotationListViewModel.Rows), changed);
    }

    // ── i18n / accessibility: title + remove accessible name resolve through the localizer ───────────────

    [Fact]
    public void Title_resolves_through_the_localizer_with_the_web_key()
    {
        var localizer = new RecordingLocalizer();
        using var vm = new AnnotationListViewModel(new AnnotationListStore(), localizer);

        Assert.Equal("Annotations", vm.Title);
        Assert.Contains(("annotation.listTitle", "Annotations"), localizer.Requests);
    }

    [Fact]
    public void Remove_accessible_name_resolves_through_the_localizer_with_the_web_key()
    {
        var localizer = new RecordingLocalizer();
        using var vm = new AnnotationListViewModel(
            new AnnotationListStore([Annotation("a", "A")]), localizer);

        Assert.Equal("Remove annotation", vm.RemoveLabel);
        Assert.Contains(("annotation.remove", "Remove annotation"), localizer.Requests);
    }

    // ── Diagnostics (P1/S11): slug-only view.opened, never the annotation content ────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AnnotationListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AnnotationList", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AnnotationListDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Notify_opened_emits_the_view_opened_event_once()
    {
        var lines = new List<string>();
        using var vm = new AnnotationListViewModel(
            new AnnotationListStore(), PassthroughLocalizer.Instance, new AnnotationListDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.NotifyOpened();

        Assert.Equal("view.opened slug=AnnotationList", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_the_annotation_content()
    {
        var lines = new List<string>();
        var store = new AnnotationListStore([Annotation("1", "VIN 5YJ-secret", description: "private note")]);
        using var vm = new AnnotationListViewModel(
            store, PassthroughLocalizer.Instance, new AnnotationListDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.Remove("1");

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("VIN 5YJ-secret", line, StringComparison.Ordinal);
            Assert.DoesNotContain("private note", line, StringComparison.Ordinal);
        });
    }

    // ── Lifecycle + argument validation ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Disposed_view_model_unsubscribes_and_ignores_further_removes()
    {
        var store = new AnnotationListStore([Annotation("a", "A")]);
        var vm = new AnnotationListViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Dispose();
        vm.Remove("a");

        Assert.Single(store.Annotations);
        Assert.Empty(changed);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new AnnotationListViewModel(new AnnotationListStore(), PassthroughLocalizer.Instance);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        var store = new AnnotationListStore();

        Assert.Throws<ArgumentNullException>(() => new AnnotationListViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new AnnotationListViewModel(store, null!));
    }

    // ── Registration metadata is stable and matches the web catalogue ────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("AnnotationList", AnnotationListRegistration.Slug);
        Assert.Equal("AnnotationList", AnnotationListViewModel.Slug);
    }

    [Fact]
    public void Registration_keys_match_the_web_catalogue()
    {
        Assert.Equal("annotation.listTitle", AnnotationListRegistration.ListTitleKey);
        Assert.Equal("Annotations", AnnotationListRegistration.ListTitleFallback);
        Assert.Equal("annotation.remove", AnnotationListRegistration.RemoveKey);
        Assert.Equal("Remove annotation", AnnotationListRegistration.RemoveFallback);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static DataAnnotation Annotation(
        string id,
        string label,
        string? description = null,
        string timestamp = "2024-01-01",
        AnnotationCategory category = AnnotationCategory.Milestone) =>
        new()
        {
            Id = id,
            Label = label,
            Description = description,
            Timestamp = timestamp,
            Category = category,
            Context = "battery",
            CreatedAt = "2024-01-01T00:00:00Z",
        };

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<(string Key, string Fallback)> Requests { get; } = [];

        public string GetString(string key, string fallback)
        {
            Requests.Add((key, fallback));
            return fallback;
        }
    }
}
