using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DataTableBulkBar surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="DataTableBulkBarRegistration"/>), the count interpolation adapter, the per-state
/// bar logic + projected labels (<see cref="DataTableBulkBarViewModel"/>), the clear-request event and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/ui/DataTableBulkBar.tsx). The
/// WinUI view (DataTableBulkBar.cs, which composes a TsGlassPanel + a polite count caption + the consumer
/// actions slot + a subtle clear TsButton) is exercised by the app build.
/// </summary>
public sealed class DataTableBulkBarTests
{
    // ── recording / catalog doubles ──────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    /// <summary>
    /// Resolves the bar's keys to their Strings/{en,he,ar}/Resources.resw English catalog values (as production
    /// does — including the positional <c>{0} selected</c> form the catalog stores), and the English fallback
    /// for any other key. Proves the native positional token path end-to-end.
    /// </summary>
    private sealed class CatalogLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            DataTableBulkBarRegistration.RegionKey => "Bulk actions",
            DataTableBulkBarRegistration.SelectedKey => "{0} selected",
            DataTableBulkBarRegistration.ClearKey => "Clear selection",
            _ => fallback,
        };
    }

    private static DataTableBulkBarViewModel NewViewModel(ILocalizer? localizer = null) =>
        new(localizer ?? PassthroughLocalizer.Instance);

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DataTableBulkBar", DataTableBulkBarRegistration.Slug);

    [Theory]
    [InlineData(DataTableBulkBarRegistration.RegionKey, "translation.table.bulkActions.region")]
    [InlineData(DataTableBulkBarRegistration.SelectedKey, "translation.table.bulkActions.selected")]
    [InlineData(DataTableBulkBarRegistration.ClearKey, "translation.table.bulkActions.clear")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(DataTableBulkBarRegistration.RegionFallback, "Bulk actions")]
    [InlineData(DataTableBulkBarRegistration.SelectedFallback, "{{count}} selected")]
    [InlineData(DataTableBulkBarRegistration.ClearFallback, "Clear selection")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: count interpolation (web i18next {{count}} + resw positional {0}) ────────────────────────

    [Fact]
    public void FormatSelected_interpolates_the_i18next_count_token() =>
        Assert.Equal("3 selected", DataTableBulkBarRegistration.FormatSelected("{{count}} selected", 3));

    [Fact]
    public void FormatSelected_interpolates_the_native_positional_token() =>
        Assert.Equal("5 selected", DataTableBulkBarRegistration.FormatSelected("{0} selected", 5));

    [Fact]
    public void FormatSelected_is_safe_when_the_template_has_no_token() =>
        Assert.Equal("selected", DataTableBulkBarRegistration.FormatSelected("selected", 7));

    // ── state: hidden vs visible (web count <= 0 ? null) ──────────────────────────────────────────────────

    [Fact]
    public void Bar_is_hidden_when_nothing_is_selected()
    {
        DataTableBulkBarViewModel vm = NewViewModel();

        Assert.Equal(0, vm.Count);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void Bar_is_hidden_for_a_non_positive_count()
    {
        DataTableBulkBarViewModel vm = NewViewModel();

        vm.SetCount(-2);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void Bar_is_visible_once_something_is_selected()
    {
        DataTableBulkBarViewModel vm = NewViewModel();

        vm.SetCount(2);

        Assert.Equal(2, vm.Count);
        Assert.True(vm.IsVisible);
    }

    [Fact]
    public void Count_label_reads_the_selected_key_with_the_count_via_fallback()
    {
        DataTableBulkBarViewModel vm = NewViewModel();
        vm.SetCount(4);

        Assert.Equal("4 selected", vm.CountLabel);
    }

    [Fact]
    public void Count_label_reads_the_selected_key_with_the_count_via_catalog()
    {
        DataTableBulkBarViewModel vm = NewViewModel(new CatalogLocalizer());
        vm.SetCount(9);

        Assert.Equal("9 selected", vm.CountLabel);
    }

    // ── events: clear, count change ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Request_clear_raises_the_clear_requested_event()
    {
        DataTableBulkBarViewModel vm = NewViewModel();
        bool raised = false;
        vm.ClearRequested += (_, _) => raised = true;

        vm.RequestClear();

        Assert.True(raised);
    }

    [Fact]
    public void Set_count_raises_property_changed_when_the_count_changes()
    {
        DataTableBulkBarViewModel vm = NewViewModel();
        int changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.SetCount(1);

        Assert.Equal(1, changes);
    }

    [Fact]
    public void Set_count_is_a_no_op_when_the_count_is_unchanged()
    {
        DataTableBulkBarViewModel vm = NewViewModel();
        vm.SetCount(3);
        int changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.SetCount(3);

        Assert.Equal(0, changes);
    }

    // ── accessibility: every visible label resolves through the i18n facade (P1/S10) ──────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        DataTableBulkBarViewModel vm = NewViewModel(localizer);
        vm.SetCount(2);

        Assert.Equal("Bulk actions", vm.RegionLabel);
        Assert.Equal("Clear selection", vm.ClearLabel);
        Assert.Equal("2 selected", vm.CountLabel);

        Assert.Contains(DataTableBulkBarRegistration.RegionKey, localizer.RequestedKeys);
        Assert.Contains(DataTableBulkBarRegistration.ClearKey, localizer.RequestedKeys);
        Assert.Contains(DataTableBulkBarRegistration.SelectedKey, localizer.RequestedKeys);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new DataTableBulkBarDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=DataTableBulkBar", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
