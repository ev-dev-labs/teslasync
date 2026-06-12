using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DataTableColumnsMenu surface's UI-thread-free logic — the registration slug +
/// i18n keys (<see cref="DataTableColumnsMenuRegistration"/>), the projection + visibility math
/// (<see cref="DataTableColumnsMenuProjection"/>), the controlled open / toggle / show-all behaviour over the
/// <see cref="IDataTableColumnsSource"/> seam (<see cref="DataTableColumnsMenuViewModel"/> /
/// <see cref="DataTableColumnsSource"/>) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/ui/DataTableColumnsMenu.tsx). The WinUI view (DataTableColumnsMenu.cs, which composes a
/// TsButton + Flyout + a TsCheckbox list) is exercised by the app build.
/// </summary>
public sealed class DataTableColumnsMenuTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static DataTableColumnDescriptor Col(string key, string? header = null, bool required = false) =>
        new(key, header, required);

    private static List<DataTableColumnDescriptor> Cols(params DataTableColumnDescriptor[] columns) => new(columns);

    private static DataTableColumnsMenuViewModel NewViewModel(DataTableColumnsSource source, ILocalizer? localizer = null) =>
        new(source, localizer ?? PassthroughLocalizer.Instance);

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DataTableColumnsMenu", DataTableColumnsMenuRegistration.Slug);

    [Theory]
    [InlineData(DataTableColumnsMenuRegistration.MenuKey, "translation.table.columns.menu")]
    [InlineData(DataTableColumnsMenuRegistration.ButtonKey, "translation.table.columns.button")]
    [InlineData(DataTableColumnsMenuRegistration.HeadingKey, "translation.table.columns.heading")]
    [InlineData(DataTableColumnsMenuRegistration.ShowAllKey, "translation.table.columns.showAll")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(DataTableColumnsMenuRegistration.MenuFallback, "Show or hide columns")]
    [InlineData(DataTableColumnsMenuRegistration.ButtonFallback, "Columns")]
    [InlineData(DataTableColumnsMenuRegistration.HeadingFallback, "Visible columns")]
    [InlineData(DataTableColumnsMenuRegistration.ShowAllFallback, "Show all")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── a11y labels: every interactive element resolves its name through the localizer ───────────────────

    [Fact]
    public void Projection_resolves_every_label_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();

        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(
            Cols(Col("a", "Alpha")), new[] { "a" }, localizer);

        Assert.Equal("Show or hide columns", display.MenuLabel);
        Assert.Equal("Columns", display.ButtonLabel);
        Assert.Equal("Visible columns", display.HeadingLabel);
        Assert.Equal("Show all", display.ShowAllLabel);
        Assert.Contains(DataTableColumnsMenuRegistration.MenuKey, localizer.RequestedKeys);
        Assert.Contains(DataTableColumnsMenuRegistration.ButtonKey, localizer.RequestedKeys);
        Assert.Contains(DataTableColumnsMenuRegistration.HeadingKey, localizer.RequestedKeys);
        Assert.Contains(DataTableColumnsMenuRegistration.ShowAllKey, localizer.RequestedKeys);
    }

    // ── projection: row checked / disabled / label (web L116-L141) ───────────────────────────────────────

    [Fact]
    public void Project_marks_visible_columns_checked_and_hidden_columns_unchecked()
    {
        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(
            Cols(Col("a", "Alpha"), Col("b", "Bravo"), Col("c", "Charlie")),
            new[] { "a", "c" },
            PassthroughLocalizer.Instance);

        Assert.Collection(
            display.Rows,
            r => Assert.True(r.IsChecked && r.Key == "a"),
            r => Assert.False(r.IsChecked),
            r => Assert.True(r.IsChecked && r.Key == "c"));
        Assert.False(display.IsEmpty);
    }

    [Fact]
    public void Project_falls_back_to_the_key_when_the_header_is_blank()
    {
        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(
            Cols(Col("createdAt"), Col("device", "Device")),
            new[] { "createdAt", "device" },
            PassthroughLocalizer.Instance);

        Assert.Equal("createdAt", display.Rows[0].Label);
        Assert.Equal("Device", display.Rows[1].Label);
    }

    [Fact]
    public void Project_disables_required_columns()
    {
        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(
            Cols(Col("select", "Select", required: true), Col("name", "Name")),
            new[] { "select", "name" },
            PassthroughLocalizer.Instance);

        Assert.True(display.Rows[0].IsDisabled);  // required → never toggleable
        Assert.False(display.Rows[1].IsDisabled);
    }

    [Fact]
    public void Project_disables_the_last_visible_column_so_at_least_one_stays()
    {
        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(
            Cols(Col("a", "Alpha"), Col("b", "Bravo")),
            new[] { "a" },
            PassthroughLocalizer.Instance);

        Assert.True(display.Rows[0].IsChecked);
        Assert.True(display.Rows[0].IsDisabled);   // last visible column cannot be hidden
        Assert.False(display.Rows[1].IsDisabled);  // a hidden column can always be shown
    }

    [Fact]
    public void Project_with_no_columns_is_empty_and_has_no_rows()
    {
        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(
            Cols(), System.Array.Empty<string>(), PassthroughLocalizer.Instance);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Rows);
        Assert.Equal("Visible columns", display.HeadingLabel); // heading chrome still resolves — never a blank box
    }

    [Fact]
    public void Project_tolerates_null_inputs()
    {
        DataTableColumnsMenuDisplay display = DataTableColumnsMenuProjection.Project(null, null, PassthroughLocalizer.Instance);

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Rows);
    }

    // ── adapter: ComputeToggle (web toggle handler L57-L67) ──────────────────────────────────────────────

    [Fact]
    public void ComputeToggle_hides_a_visible_column_preserving_visible_order()
    {
        IReadOnlyList<string>? next = DataTableColumnsMenuProjection.ComputeToggle(
            Cols(Col("a"), Col("b"), Col("c")),
            new[] { "c", "a", "b" },
            "a");

        Assert.Equal(new[] { "c", "b" }, next);
    }

    [Fact]
    public void ComputeToggle_shows_a_hidden_column_rebuilding_in_column_order()
    {
        IReadOnlyList<string>? next = DataTableColumnsMenuProjection.ComputeToggle(
            Cols(Col("a"), Col("b"), Col("c")),
            new[] { "c" },
            "a");

        // Column order is restored for the persisted list, not the click order.
        Assert.Equal(new[] { "a", "c" }, next);
    }

    [Fact]
    public void ComputeToggle_showing_drops_stale_keys_not_in_the_column_set()
    {
        IReadOnlyList<string>? next = DataTableColumnsMenuProjection.ComputeToggle(
            Cols(Col("a"), Col("b")),
            new[] { "ghost" },
            "a");

        Assert.Equal(new[] { "a" }, next);
    }

    [Fact]
    public void ComputeToggle_refuses_to_hide_the_last_visible_column()
    {
        IReadOnlyList<string>? next = DataTableColumnsMenuProjection.ComputeToggle(
            Cols(Col("a"), Col("b")),
            new[] { "a" },
            "a");

        Assert.Null(next); // web early return — at least one column must stay visible
    }

    [Fact]
    public void ComputeShowAll_returns_every_key_in_column_order()
    {
        IReadOnlyList<string> all = DataTableColumnsMenuProjection.ComputeShowAll(
            Cols(Col("a"), Col("b"), Col("c")));

        Assert.Equal(new[] { "a", "b", "c" }, all);
    }

    // ── view-model: open / toggle / show-all over the seam (web controlled state + onChange) ──────────────

    [Fact]
    public void Menu_starts_closed()
    {
        using DataTableColumnsMenuViewModel vm = NewViewModel(new DataTableColumnsSource());

        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Open_close_and_toggle_drive_the_open_state()
    {
        using DataTableColumnsMenuViewModel vm = NewViewModel(new DataTableColumnsSource());

        vm.OpenMenu();
        Assert.True(vm.IsOpen);

        vm.CloseMenu();
        Assert.False(vm.IsOpen);

        vm.ToggleMenu();
        Assert.True(vm.IsOpen);

        vm.ToggleMenu();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Opening_raises_change_for_is_open()
    {
        using DataTableColumnsMenuViewModel vm = NewViewModel(new DataTableColumnsSource());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.OpenMenu();

        Assert.Contains(nameof(DataTableColumnsMenuViewModel.IsOpen), changed);
    }

    [Fact]
    public void Toggle_hides_a_visible_column_and_reports_the_new_set_through_the_seam()
    {
        var source = new DataTableColumnsSource(Cols(Col("a"), Col("b"), Col("c")), new[] { "a", "b", "c" });
        IReadOnlyList<string>? reported = null;
        source.VisibleKeysChanged += (_, keys) => reported = keys;
        using DataTableColumnsMenuViewModel vm = NewViewModel(source);

        vm.Toggle("b");

        Assert.Equal(new[] { "a", "c" }, source.VisibleKeys);
        Assert.Equal(new[] { "a", "c" }, reported); // web onChange(next)
    }

    [Fact]
    public void Toggle_on_the_last_visible_column_is_a_no_op()
    {
        var source = new DataTableColumnsSource(Cols(Col("a"), Col("b")), new[] { "a" });
        int reportCount = 0;
        source.VisibleKeysChanged += (_, _) => reportCount++;
        using DataTableColumnsMenuViewModel vm = NewViewModel(source);

        vm.Toggle("a");

        Assert.Equal(new[] { "a" }, source.VisibleKeys);
        Assert.Equal(0, reportCount); // never applied — at least one column must stay visible
    }

    [Fact]
    public void Toggle_ignores_a_null_or_empty_key()
    {
        var source = new DataTableColumnsSource(Cols(Col("a"), Col("b")), new[] { "a", "b" });
        int reportCount = 0;
        source.VisibleKeysChanged += (_, _) => reportCount++;
        using DataTableColumnsMenuViewModel vm = NewViewModel(source);

        vm.Toggle(string.Empty);

        Assert.Equal(0, reportCount);
        Assert.Equal(new[] { "a", "b" }, source.VisibleKeys);
    }

    [Fact]
    public void ShowAll_reveals_every_column()
    {
        var source = new DataTableColumnsSource(Cols(Col("a"), Col("b"), Col("c")), new[] { "a" });
        using DataTableColumnsMenuViewModel vm = NewViewModel(source);

        vm.ShowAll();

        Assert.Equal(new[] { "a", "b", "c" }, source.VisibleKeys);
    }

    [Fact]
    public void Source_change_re_projects_the_display_and_notifies()
    {
        var source = new DataTableColumnsSource(Cols(Col("a", "Alpha"), Col("b", "Bravo")), new[] { "a" });
        using DataTableColumnsMenuViewModel vm = NewViewModel(source);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetVisibleKeys(new[] { "a", "b" });

        Assert.Contains(nameof(DataTableColumnsMenuViewModel.Display), changed);
        Assert.Contains(nameof(DataTableColumnsMenuViewModel.Rows), changed);
        DataTableColumnRow bravo = Assert.Single(vm.Display.Rows, r => r.Key == "b");
        Assert.True(bravo.IsChecked);
    }

    [Fact]
    public void Disposed_view_model_stops_observing_the_seam()
    {
        var source = new DataTableColumnsSource(Cols(Col("a"), Col("b")), new[] { "a" });
        DataTableColumnsMenuViewModel vm = NewViewModel(source);
        vm.Dispose();

        source.SetVisibleKeys(new[] { "a", "b" });

        // The projection captured before Dispose is unchanged: "b" is still hidden.
        DataTableColumnRow bravo = Assert.Single(vm.Display.Rows, r => r.Key == "b");
        Assert.False(bravo.IsChecked);
    }

    // ── diagnostics (P1/S11 view.opened, PII-safe) ───────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_and_emits_the_view_opened_signal()
    {
        var emitted = new List<string>();
        var diagnostics = new DataTableColumnsMenuDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DataTableColumnsMenu", Assert.Single(emitted));
    }
}
