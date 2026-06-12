using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ListExportMenu surface's UI-thread-free logic — the registration slug + i18n
/// keys (<see cref="ListExportMenuRegistration"/>), the <c>{{count}}</c> interpolation adapter, the per-state
/// menu logic + scope routing (<see cref="ListExportMenuViewModel"/>), the export-action seam
/// (<see cref="IListExportActions"/> with its canonical, delegate-backed and inert implementations) and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/forms/ListExportMenu.tsx). The
/// WinUI view (ListExportMenu.cs, which composes a TsButton + Flyout) is exercised by the app build.
/// </summary>
public sealed class ListExportMenuTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingActions : IListExportActions
    {
        public List<ListExportScope> CsvCalls { get; } = new();

        public List<ListExportScope> JsonCalls { get; } = new();

        public Task ExportCsvAsync(ListExportScope scope)
        {
            CsvCalls.Add(scope);
            return Task.CompletedTask;
        }

        public Task ExportJsonAsync(ListExportScope scope)
        {
            JsonCalls.Add(scope);
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static ListExportMenuViewModel NewViewModel(
        RecordingActions? actions = null,
        ILocalizer? localizer = null,
        int selectedCount = 0,
        int? visibleCount = null,
        bool disabled = false) =>
        new(
            actions ?? new RecordingActions(),
            localizer ?? PassthroughLocalizer.Instance,
            selectedCount,
            visibleCount,
            disabled);

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ListExportMenu", ListExportMenuRegistration.Slug);

    [Theory]
    [InlineData(ListExportMenuRegistration.DisabledTooltipKey, "translation.listExport.disabledTooltip")]
    [InlineData(ListExportMenuRegistration.MenuLabelKey, "translation.listExport.menuLabel")]
    [InlineData(ListExportMenuRegistration.VisibleWithCountKey, "translation.listExport.visibleWithCount")]
    [InlineData(ListExportMenuRegistration.VisibleKey, "translation.listExport.visible")]
    [InlineData(ListExportMenuRegistration.SelectedWithCountKey, "translation.listExport.selectedWithCount")]
    [InlineData(ListExportMenuRegistration.ButtonKey, "translation.listExport.button")]
    [InlineData(ListExportMenuRegistration.ScopeLegendKey, "translation.listExport.scopeLegend")]
    [InlineData(ListExportMenuRegistration.CsvKey, "translation.listExport.csv")]
    [InlineData(ListExportMenuRegistration.JsonKey, "translation.listExport.json")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(ListExportMenuRegistration.DisabledTooltipFallback, "No data to export")]
    [InlineData(ListExportMenuRegistration.MenuLabelFallback, "Export list")]
    [InlineData(ListExportMenuRegistration.VisibleWithCountFallback, "Visible ({{count}})")]
    [InlineData(ListExportMenuRegistration.VisibleFallback, "Visible")]
    [InlineData(ListExportMenuRegistration.SelectedWithCountFallback, "Selected ({{count}})")]
    [InlineData(ListExportMenuRegistration.ButtonFallback, "Export")]
    [InlineData(ListExportMenuRegistration.ScopeLegendFallback, "Export scope")]
    [InlineData(ListExportMenuRegistration.CsvFallback, "Download as CSV")]
    [InlineData(ListExportMenuRegistration.JsonFallback, "Download as JSON")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: {{count}} interpolation (web t(key, { count })) ─────────────────────────────────────────

    [Theory]
    [InlineData(0, "Visible (0)")]
    [InlineData(5, "Visible (5)")]
    [InlineData(1234, "Visible (1234)")]
    public void FormatCount_substitutes_the_interpolation_token(int count, string expected) =>
        Assert.Equal(expected, ListExportMenuRegistration.FormatCount("Visible ({{count}})", count));

    [Fact]
    public void FormatCount_leaves_templates_without_the_token_unchanged() =>
        Assert.Equal("Visible", ListExportMenuRegistration.FormatCount("Visible", 9));

    // ── state: closed / open / toggle (web controlled open state) ────────────────────────────────────────

    [Fact]
    public void Menu_starts_closed()
    {
        ListExportMenuViewModel vm = NewViewModel();

        Assert.False(vm.IsOpen);
        Assert.False(vm.IsMenuVisible);
    }

    [Fact]
    public void Open_then_close_toggles_visibility()
    {
        ListExportMenuViewModel vm = NewViewModel();

        vm.OpenMenu();
        Assert.True(vm.IsOpen);
        Assert.True(vm.IsMenuVisible);

        vm.CloseMenu();
        Assert.False(vm.IsOpen);
        Assert.False(vm.IsMenuVisible);
    }

    [Fact]
    public void Toggle_flips_the_open_state()
    {
        ListExportMenuViewModel vm = NewViewModel();

        vm.ToggleMenu();
        Assert.True(vm.IsOpen);

        vm.ToggleMenu();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Opening_raises_change_for_open_and_visibility()
    {
        ListExportMenuViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.OpenMenu();

        Assert.Contains(nameof(ListExportMenuViewModel.IsOpen), changed);
        Assert.Contains(nameof(ListExportMenuViewModel.IsMenuVisible), changed);
    }

    // ── state: disabled / empty (web disabled prop — cannot open, "No data to export" label) ─────────────

    [Fact]
    public void Disabled_menu_cannot_open()
    {
        ListExportMenuViewModel vm = NewViewModel(disabled: true);

        vm.OpenMenu();
        Assert.False(vm.IsOpen);
        Assert.False(vm.IsMenuVisible);

        vm.ToggleMenu();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Disabling_an_open_menu_hides_it()
    {
        ListExportMenuViewModel vm = NewViewModel();
        vm.OpenMenu();
        Assert.True(vm.IsMenuVisible);

        vm.IsDisabled = true;

        // web: {open && !disabled && (...menu)} — the menu is hidden once disabled even though open stays true.
        Assert.False(vm.IsMenuVisible);
    }

    [Fact]
    public void Trigger_label_is_the_no_data_copy_while_disabled()
    {
        ListExportMenuViewModel vm = NewViewModel(disabled: true);

        Assert.Equal("No data to export", vm.TriggerLabel);
    }

    [Fact]
    public void Trigger_label_is_the_menu_label_while_enabled()
    {
        ListExportMenuViewModel vm = NewViewModel();

        Assert.Equal("Export list", vm.TriggerLabel);
    }

    [Fact]
    public void Toggling_disabled_raises_trigger_label_and_visibility_change()
    {
        ListExportMenuViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IsDisabled = true;

        Assert.Contains(nameof(ListExportMenuViewModel.TriggerLabel), changed);
        Assert.Contains(nameof(ListExportMenuViewModel.IsMenuVisible), changed);
    }

    // ── state: scope chooser present-vs-absent (web selectedCount > 0) ───────────────────────────────────

    [Fact]
    public void Scope_chooser_is_hidden_when_nothing_is_selected()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 0);

        Assert.False(vm.ShowScope);
    }

    [Fact]
    public void Scope_chooser_is_shown_when_rows_are_selected()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 3);

        Assert.True(vm.ShowScope);
    }

    [Fact]
    public void Selecting_rows_reveals_the_scope_chooser()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 0);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.SelectedCount = 2;

        Assert.True(vm.ShowScope);
        Assert.Contains(nameof(ListExportMenuViewModel.ShowScope), changed);
    }

    // ── state: initial scope + selection + snap-back (web useState + useEffect) ──────────────────────────

    [Fact]
    public void Initial_scope_is_visible_when_nothing_is_selected()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 0);

        Assert.Equal(ListExportScope.Visible, vm.Scope);
        Assert.True(vm.VisibleChecked);
        Assert.False(vm.SelectedChecked);
    }

    [Fact]
    public void Initial_scope_is_selected_when_rows_are_selected()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 4);

        Assert.Equal(ListExportScope.Selected, vm.Scope);
        Assert.True(vm.SelectedChecked);
        Assert.False(vm.VisibleChecked);
    }

    [Fact]
    public void Selecting_a_scope_updates_the_checked_flags()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 4);

        vm.SelectScope(ListExportScope.Visible);

        Assert.Equal(ListExportScope.Visible, vm.Scope);
        Assert.True(vm.VisibleChecked);
        Assert.False(vm.SelectedChecked);
    }

    [Fact]
    public void Scope_snaps_back_to_visible_when_selection_drops_to_zero()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 4);
        Assert.Equal(ListExportScope.Selected, vm.Scope);

        vm.SelectedCount = 0;

        // web useEffect: if (selectedCount === 0 && scope === 'selected') setScope('visible').
        Assert.Equal(ListExportScope.Visible, vm.Scope);
        Assert.True(vm.VisibleChecked);
    }

    [Fact]
    public void Dropping_selection_keeps_visible_scope_unchanged()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 4);
        vm.SelectScope(ListExportScope.Visible);

        vm.SelectedCount = 0;

        Assert.Equal(ListExportScope.Visible, vm.Scope);
    }

    // ── labels: visible with-vs-without a count (web visibleCount != null) ───────────────────────────────

    [Fact]
    public void Visible_label_omits_the_count_when_visible_count_is_unknown()
    {
        ListExportMenuViewModel vm = NewViewModel(visibleCount: null);

        Assert.Equal("Visible", vm.VisibleLabel);
    }

    [Fact]
    public void Visible_label_carries_the_count_when_known()
    {
        ListExportMenuViewModel vm = NewViewModel(visibleCount: 42);

        Assert.Equal("Visible (42)", vm.VisibleLabel);
    }

    [Fact]
    public void Selected_label_carries_the_selected_count()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 7);

        Assert.Equal("Selected (7)", vm.SelectedLabel);
    }

    [Fact]
    public void Setting_visible_count_raises_the_visible_label_change()
    {
        ListExportMenuViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.VisibleCount = 12;

        Assert.Contains(nameof(ListExportMenuViewModel.VisibleLabel), changed);
        Assert.Equal("Visible (12)", vm.VisibleLabel);
    }

    // ── invoking items: close then fire the export with the chosen scope (web handleCsv/handleJson) ──────

    [Fact]
    public async Task Invoke_csv_closes_the_menu_and_exports_the_chosen_scope()
    {
        var actions = new RecordingActions();
        ListExportMenuViewModel vm = NewViewModel(actions: actions, selectedCount: 3);
        vm.OpenMenu();

        await vm.InvokeCsvAsync();

        Assert.False(vm.IsOpen);
        Assert.Equal(ListExportScope.Selected, Assert.Single(actions.CsvCalls));
        Assert.Empty(actions.JsonCalls);
    }

    [Fact]
    public async Task Invoke_json_closes_the_menu_and_exports_the_chosen_scope()
    {
        var actions = new RecordingActions();
        ListExportMenuViewModel vm = NewViewModel(actions: actions, selectedCount: 0);
        vm.OpenMenu();

        await vm.InvokeJsonAsync();

        Assert.False(vm.IsOpen);
        Assert.Equal(ListExportScope.Visible, Assert.Single(actions.JsonCalls));
        Assert.Empty(actions.CsvCalls);
    }

    [Fact]
    public async Task Invoke_exports_the_scope_chosen_after_a_radio_change()
    {
        var actions = new RecordingActions();
        ListExportMenuViewModel vm = NewViewModel(actions: actions, selectedCount: 5);
        vm.SelectScope(ListExportScope.Visible);

        await vm.InvokeCsvAsync();

        Assert.Equal(ListExportScope.Visible, Assert.Single(actions.CsvCalls));
    }

    // ── accessibility: every interactive element exposes a localized name ────────────────────────────────

    [Fact]
    public void All_labels_are_present_and_match_the_web_copy()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: 2, visibleCount: 9);

        Assert.Equal("Export list", vm.TriggerLabel);
        Assert.Equal("Export", vm.ButtonText);
        Assert.Equal("Export scope", vm.ScopeLegendLabel);
        Assert.Equal("Visible (9)", vm.VisibleLabel);
        Assert.Equal("Selected (2)", vm.SelectedLabel);
        Assert.Equal("Download as CSV", vm.CsvLabel);
        Assert.Equal("Download as JSON", vm.JsonLabel);
        Assert.All(
            new[]
            {
                vm.TriggerLabel, vm.ButtonText, vm.ScopeLegendLabel, vm.VisibleLabel,
                vm.SelectedLabel, vm.CsvLabel, vm.JsonLabel,
            },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    [Fact]
    public void Every_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        ListExportMenuViewModel vm = NewViewModel(localizer: localizer, selectedCount: 1, visibleCount: 1);

        // Read every projected string so each key flows through the i18n facade.
        _ = vm.TriggerLabel;
        _ = vm.ButtonText;
        _ = vm.ScopeLegendLabel;
        _ = vm.VisibleLabel;
        _ = vm.SelectedLabel;
        _ = vm.CsvLabel;
        _ = vm.JsonLabel;

        Assert.Contains(ListExportMenuRegistration.MenuLabelKey, localizer.RequestedKeys);
        Assert.Contains(ListExportMenuRegistration.ButtonKey, localizer.RequestedKeys);
        Assert.Contains(ListExportMenuRegistration.ScopeLegendKey, localizer.RequestedKeys);
        Assert.Contains(ListExportMenuRegistration.VisibleWithCountKey, localizer.RequestedKeys);
        Assert.Contains(ListExportMenuRegistration.SelectedWithCountKey, localizer.RequestedKeys);
        Assert.Contains(ListExportMenuRegistration.CsvKey, localizer.RequestedKeys);
        Assert.Contains(ListExportMenuRegistration.JsonKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Visible_label_resolves_the_no_count_key_when_visible_count_is_unknown()
    {
        var localizer = new RecordingLocalizer();
        ListExportMenuViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.VisibleLabel;

        Assert.Contains(ListExportMenuRegistration.VisibleKey, localizer.RequestedKeys);
        Assert.DoesNotContain(ListExportMenuRegistration.VisibleWithCountKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Disabled_trigger_resolves_the_no_data_key()
    {
        var localizer = new RecordingLocalizer();
        ListExportMenuViewModel vm = NewViewModel(localizer: localizer, disabled: true);

        _ = vm.TriggerLabel;

        Assert.Contains(ListExportMenuRegistration.DisabledTooltipKey, localizer.RequestedKeys);
    }

    // ── seams: canonical / inert implementations ─────────────────────────────────────────────────────────

    [Fact]
    public async Task NoOp_actions_are_a_shared_singleton_and_do_not_throw()
    {
        Assert.Same(NoOpListExportActions.Instance, NoOpListExportActions.Instance);

        Exception? error = await Record.ExceptionAsync(async () =>
        {
            await NoOpListExportActions.Instance.ExportCsvAsync(ListExportScope.Visible);
            await NoOpListExportActions.Instance.ExportJsonAsync(ListExportScope.Selected);
        });

        Assert.Null(error);
    }

    [Fact]
    public async Task Delegate_actions_invoke_their_delegates_with_the_scope()
    {
        ListExportScope? csv = null;
        ListExportScope? json = null;
        var actions = new ListExportActions(
            scope => { csv = scope; return Task.CompletedTask; },
            scope => { json = scope; return Task.CompletedTask; });

        await actions.ExportCsvAsync(ListExportScope.Selected);
        await actions.ExportJsonAsync(ListExportScope.Visible);

        Assert.Equal(ListExportScope.Selected, csv);
        Assert.Equal(ListExportScope.Visible, json);
    }

    [Fact]
    public async Task Delegate_actions_degrade_gracefully_for_null_delegates()
    {
        var actions = new ListExportActions(null, null);

        Exception? error = await Record.ExceptionAsync(async () =>
        {
            await actions.ExportCsvAsync(ListExportScope.Visible);
            await actions.ExportJsonAsync(ListExportScope.Selected);
        });

        Assert.Null(error);
    }

    [Fact]
    public async Task FromSync_wraps_synchronous_callbacks()
    {
        ListExportScope? csv = null;
        ListExportScope? json = null;
        ListExportActions actions = ListExportActions.FromSync(
            scope => csv = scope,
            scope => json = scope);

        await actions.ExportCsvAsync(ListExportScope.Visible);
        await actions.ExportJsonAsync(ListExportScope.Selected);

        Assert.Equal(ListExportScope.Visible, csv);
        Assert.Equal(ListExportScope.Selected, json);
    }

    // ── construction guards ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Constructor_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new ListExportMenuViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            new ListExportMenuViewModel(NoOpListExportActions.Instance, null!));
    }

    [Fact]
    public void Negative_counts_are_clamped_to_zero()
    {
        ListExportMenuViewModel vm = NewViewModel(selectedCount: -5);

        Assert.Equal(0, vm.SelectedCount);
        Assert.False(vm.ShowScope);
    }

    // ── diagnostics (view.opened, PII-safe — never a file path or row data) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ListExportMenuDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ListExportMenu", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ListExportMenuDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
