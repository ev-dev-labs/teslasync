using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ChartExportMenu surface's UI-thread-free logic — the registration slug + i18n
/// keys (<see cref="ChartExportMenuRegistration"/>), the clipboard-outcome → toast projection and per-state
/// menu logic (<see cref="ChartExportMenuViewModel"/>), the optional toast + export-action seams
/// (<see cref="IChartExportToast"/> / <see cref="IChartExportActions"/> with their canonical, delegate-backed
/// and inert implementations) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/charts/ChartExportMenu.tsx, web/src/components/feedback/Toast.tsx,
/// web/src/hooks/useChartExport.ts). The WinUI view (ChartExportMenu.cs, which composes a TsButton + MenuFlyout)
/// is exercised by the app build.
/// </summary>
public sealed class ChartExportMenuTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingToast : IChartExportToast
    {
        public List<(ChartExportToastSeverity Severity, string Title, string? Message)> Calls { get; } = new();

        public void Show(ChartExportToastSeverity severity, string title, string? message = null) =>
            Calls.Add((severity, title, message));
    }

    private sealed class RecordingActions : IChartExportActions
    {
        private readonly ChartExportClipboardOutcome _outcome;

        public RecordingActions(bool canExportCsv = true, ChartExportClipboardOutcome outcome = ChartExportClipboardOutcome.Copied)
        {
            CanExportCsv = canExportCsv;
            _outcome = outcome;
        }

        public bool CanExportCsv { get; }

        public int PngCalls { get; private set; }

        public int SvgCalls { get; private set; }

        public int CsvCalls { get; private set; }

        public int CopyCalls { get; private set; }

        public Task ExportPngAsync()
        {
            PngCalls++;
            return Task.CompletedTask;
        }

        public Task ExportSvgAsync()
        {
            SvgCalls++;
            return Task.CompletedTask;
        }

        public Task<ChartExportClipboardOutcome> CopyImageAsync()
        {
            CopyCalls++;
            return Task.FromResult(_outcome);
        }

        public Task ExportCsvAsync()
        {
            CsvCalls++;
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

    private static ChartExportMenuViewModel NewViewModel(
        RecordingActions? actions = null,
        IChartExportToast? toast = null,
        ILocalizer? localizer = null,
        bool disabled = false,
        bool busy = false) =>
        new(
            actions ?? new RecordingActions(),
            toast ?? NoOpChartExportToast.Instance,
            localizer ?? PassthroughLocalizer.Instance,
            disabled,
            busy);

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ChartExportMenu", ChartExportMenuRegistration.Slug);

    [Theory]
    [InlineData(ChartExportMenuRegistration.DisabledTooltipKey, "translation.chart.export.disabledTooltip")]
    [InlineData(ChartExportMenuRegistration.MenuLabelKey, "translation.chart.export.menuLabel")]
    [InlineData(ChartExportMenuRegistration.CsvKey, "translation.chart.export.csv")]
    [InlineData(ChartExportMenuRegistration.PngKey, "translation.chart.export.png")]
    [InlineData(ChartExportMenuRegistration.SvgKey, "translation.chart.export.svg")]
    [InlineData(ChartExportMenuRegistration.CopyKey, "translation.chart.export.copy")]
    [InlineData(ChartExportMenuRegistration.CopySuccessKey, "translation.chart.export.copySuccess")]
    [InlineData(ChartExportMenuRegistration.CopyUnavailableKey, "translation.chart.export.copyFallback")]
    [InlineData(ChartExportMenuRegistration.CopyFailedKey, "translation.chart.export.copyFailed")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(ChartExportMenuRegistration.DisabledTooltipFallback, "Chart not ready to export")]
    [InlineData(ChartExportMenuRegistration.MenuLabelFallback, "Export chart")]
    [InlineData(ChartExportMenuRegistration.CsvFallback, "Download data as CSV")]
    [InlineData(ChartExportMenuRegistration.PngFallback, "Save as PNG")]
    [InlineData(ChartExportMenuRegistration.SvgFallback, "Save as SVG")]
    [InlineData(ChartExportMenuRegistration.CopyFallback, "Copy image to clipboard")]
    [InlineData(ChartExportMenuRegistration.CopySuccessFallback, "Chart image copied to clipboard")]
    [InlineData(ChartExportMenuRegistration.CopyFailedFallback, "Failed to copy chart image")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void Clipboard_unavailable_fallback_uses_the_web_em_dash() =>
        // web 'Clipboard not available — image downloaded instead' (U+2014 em dash).
        Assert.Equal(
            "Clipboard not available \u2014 image downloaded instead",
            ChartExportMenuRegistration.CopyUnavailableFallback);

    // ── adapter: clipboard outcome → toast intent (web handleCopy branch) ────────────────────────────────

    [Fact]
    public void Outcome_copied_projects_a_success_toast()
    {
        ChartExportMenuViewModel vm = NewViewModel();

        ChartExportToastIntent intent = vm.ToastIntentFor(ChartExportClipboardOutcome.Copied);

        Assert.Equal(ChartExportToastSeverity.Success, intent.Severity);
        Assert.Equal("Chart image copied to clipboard", intent.Message);
    }

    [Fact]
    public void Outcome_fallback_projects_an_info_toast()
    {
        ChartExportMenuViewModel vm = NewViewModel();

        ChartExportToastIntent intent = vm.ToastIntentFor(ChartExportClipboardOutcome.Fallback);

        Assert.Equal(ChartExportToastSeverity.Info, intent.Severity);
        Assert.Equal("Clipboard not available \u2014 image downloaded instead", intent.Message);
    }

    [Fact]
    public void Outcome_failed_projects_an_error_toast()
    {
        ChartExportMenuViewModel vm = NewViewModel();

        ChartExportToastIntent intent = vm.ToastIntentFor(ChartExportClipboardOutcome.Failed);

        Assert.Equal(ChartExportToastSeverity.Error, intent.Severity);
        Assert.Equal("Failed to copy chart image", intent.Message);
    }

    // ── state: closed / open / toggle (web controlled open state) ────────────────────────────────────────

    [Fact]
    public void Menu_starts_closed()
    {
        ChartExportMenuViewModel vm = NewViewModel();

        Assert.False(vm.IsOpen);
        Assert.False(vm.IsMenuVisible);
    }

    [Fact]
    public void Open_then_close_toggles_visibility()
    {
        ChartExportMenuViewModel vm = NewViewModel();

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
        ChartExportMenuViewModel vm = NewViewModel();

        vm.ToggleMenu();
        Assert.True(vm.IsOpen);

        vm.ToggleMenu();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Opening_raises_change_for_open_and_visibility()
    {
        ChartExportMenuViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.OpenMenu();

        Assert.Contains(nameof(ChartExportMenuViewModel.IsOpen), changed);
        Assert.Contains(nameof(ChartExportMenuViewModel.IsMenuVisible), changed);
    }

    // ── state: disabled (web disabled prop — cannot open, "not ready" label) ─────────────────────────────

    [Fact]
    public void Disabled_menu_cannot_open()
    {
        ChartExportMenuViewModel vm = NewViewModel(disabled: true);

        vm.OpenMenu();
        Assert.False(vm.IsOpen);
        Assert.False(vm.IsMenuVisible);

        vm.ToggleMenu();
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void Disabling_an_open_menu_hides_it()
    {
        ChartExportMenuViewModel vm = NewViewModel();
        vm.OpenMenu();
        Assert.True(vm.IsMenuVisible);

        vm.IsDisabled = true;

        // web: {open && !disabled && (...menu)} — the menu is hidden once disabled even though open stays true.
        Assert.False(vm.IsMenuVisible);
    }

    [Fact]
    public void Trigger_label_is_the_not_ready_copy_while_disabled()
    {
        ChartExportMenuViewModel vm = NewViewModel(disabled: true);

        Assert.Equal("Chart not ready to export", vm.TriggerLabel);
    }

    [Fact]
    public void Trigger_label_is_the_menu_label_while_enabled()
    {
        ChartExportMenuViewModel vm = NewViewModel();

        Assert.Equal("Export chart", vm.TriggerLabel);
    }

    [Fact]
    public void Toggling_disabled_raises_trigger_label_change()
    {
        ChartExportMenuViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IsDisabled = true;

        Assert.Contains(nameof(ChartExportMenuViewModel.TriggerLabel), changed);
        Assert.Contains(nameof(ChartExportMenuViewModel.IsMenuVisible), changed);
    }

    // ── state: busy (web disabled={busy} on image items only) ────────────────────────────────────────────

    [Fact]
    public void Busy_disables_image_items_but_not_csv()
    {
        ChartExportMenuViewModel vm = NewViewModel(actions: new RecordingActions(canExportCsv: true), busy: true);

        Assert.False(vm.IsImageItemEnabled);
        Assert.True(vm.IsCsvItemEnabled);
    }

    [Fact]
    public void Not_busy_enables_image_items()
    {
        ChartExportMenuViewModel vm = NewViewModel(busy: false);

        Assert.True(vm.IsImageItemEnabled);
    }

    [Fact]
    public void Setting_busy_raises_image_item_change()
    {
        ChartExportMenuViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IsBusy = true;

        Assert.Contains(nameof(ChartExportMenuViewModel.IsImageItemEnabled), changed);
    }

    // ── state: conditional CSV item (web onExportCsv presence) ───────────────────────────────────────────

    [Fact]
    public void Csv_item_present_when_csv_export_is_wired()
    {
        ChartExportMenuViewModel vm = NewViewModel(actions: new RecordingActions(canExportCsv: true));

        Assert.True(vm.HasCsv);
    }

    [Fact]
    public void Csv_item_absent_when_no_csv_export_is_wired()
    {
        ChartExportMenuViewModel vm = NewViewModel(actions: new RecordingActions(canExportCsv: false));

        Assert.False(vm.HasCsv);
    }

    // ── invoking items: close then fire the action (web handlePng/handleSvg/handleCsv) ───────────────────

    [Fact]
    public void Invoke_png_closes_the_menu_and_fires_the_export()
    {
        var actions = new RecordingActions();
        ChartExportMenuViewModel vm = NewViewModel(actions: actions);
        vm.OpenMenu();

        vm.InvokePng();

        Assert.False(vm.IsOpen);
        Assert.Equal(1, actions.PngCalls);
    }

    [Fact]
    public void Invoke_svg_closes_the_menu_and_fires_the_export()
    {
        var actions = new RecordingActions();
        ChartExportMenuViewModel vm = NewViewModel(actions: actions);
        vm.OpenMenu();

        vm.InvokeSvg();

        Assert.False(vm.IsOpen);
        Assert.Equal(1, actions.SvgCalls);
    }

    [Fact]
    public void Invoke_csv_closes_the_menu_and_fires_the_export_when_wired()
    {
        var actions = new RecordingActions(canExportCsv: true);
        ChartExportMenuViewModel vm = NewViewModel(actions: actions);
        vm.OpenMenu();

        vm.InvokeCsv();

        Assert.False(vm.IsOpen);
        Assert.Equal(1, actions.CsvCalls);
    }

    [Fact]
    public void Invoke_csv_is_a_no_op_when_not_wired()
    {
        var actions = new RecordingActions(canExportCsv: false);
        ChartExportMenuViewModel vm = NewViewModel(actions: actions);
        vm.OpenMenu();

        vm.InvokeCsv();

        // web handleCsv: `if (!onExportCsv) return;` before close() — nothing fires and the menu stays as-is.
        Assert.True(vm.IsOpen);
        Assert.Equal(0, actions.CsvCalls);
    }

    // ── invoking copy: outcome → toast routing (web handleCopy) ──────────────────────────────────────────

    [Fact]
    public async Task Invoke_copy_copied_announces_success()
    {
        var actions = new RecordingActions(outcome: ChartExportClipboardOutcome.Copied);
        var toast = new RecordingToast();
        ChartExportMenuViewModel vm = NewViewModel(actions: actions, toast: toast);
        vm.OpenMenu();

        await vm.InvokeCopyAsync();

        Assert.False(vm.IsOpen);
        Assert.Equal(1, actions.CopyCalls);
        (ChartExportToastSeverity Severity, string Title, string? Message) call = Assert.Single(toast.Calls);
        Assert.Equal(ChartExportToastSeverity.Success, call.Severity);
        Assert.Equal("Chart image copied to clipboard", call.Title);
    }

    [Fact]
    public async Task Invoke_copy_fallback_announces_info()
    {
        var actions = new RecordingActions(outcome: ChartExportClipboardOutcome.Fallback);
        var toast = new RecordingToast();
        ChartExportMenuViewModel vm = NewViewModel(actions: actions, toast: toast);

        await vm.InvokeCopyAsync();

        (ChartExportToastSeverity Severity, string Title, string? Message) call = Assert.Single(toast.Calls);
        Assert.Equal(ChartExportToastSeverity.Info, call.Severity);
        Assert.Equal("Clipboard not available \u2014 image downloaded instead", call.Title);
    }

    [Fact]
    public async Task Invoke_copy_failed_announces_error()
    {
        var actions = new RecordingActions(outcome: ChartExportClipboardOutcome.Failed);
        var toast = new RecordingToast();
        ChartExportMenuViewModel vm = NewViewModel(actions: actions, toast: toast);

        await vm.InvokeCopyAsync();

        (ChartExportToastSeverity Severity, string Title, string? Message) call = Assert.Single(toast.Calls);
        Assert.Equal(ChartExportToastSeverity.Error, call.Severity);
        Assert.Equal("Failed to copy chart image", call.Title);
    }

    [Fact]
    public async Task Invoke_copy_without_a_toast_host_does_not_throw()
    {
        var actions = new RecordingActions(outcome: ChartExportClipboardOutcome.Copied);
        ChartExportMenuViewModel vm = NewViewModel(actions: actions, toast: NoOpChartExportToast.Instance);

        Exception? error = await Record.ExceptionAsync(() => vm.InvokeCopyAsync());

        // web: `if (!toast) return;` — the outcome is simply unannounced when no provider is mounted.
        Assert.Null(error);
        Assert.Equal(1, actions.CopyCalls);
    }

    // ── accessibility: every interactive element exposes a localized name ────────────────────────────────

    [Fact]
    public void All_labels_are_present_and_match_the_web_copy()
    {
        ChartExportMenuViewModel vm = NewViewModel(actions: new RecordingActions(canExportCsv: true));

        Assert.Equal("Export chart", vm.MenuLabel);
        Assert.Equal("Download data as CSV", vm.CsvLabel);
        Assert.Equal("Save as PNG", vm.PngLabel);
        Assert.Equal("Save as SVG", vm.SvgLabel);
        Assert.Equal("Copy image to clipboard", vm.CopyLabel);
        Assert.All(
            new[] { vm.TriggerLabel, vm.MenuLabel, vm.CsvLabel, vm.PngLabel, vm.SvgLabel, vm.CopyLabel },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    [Fact]
    public void Every_label_and_message_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        ChartExportMenuViewModel vm = NewViewModel(localizer: localizer);

        // Read every projected string so each key flows through the i18n facade.
        _ = vm.TriggerLabel;
        _ = vm.MenuLabel;
        _ = vm.CsvLabel;
        _ = vm.PngLabel;
        _ = vm.SvgLabel;
        _ = vm.CopyLabel;
        _ = vm.CopySuccessMessage;
        _ = vm.CopyUnavailableMessage;
        _ = vm.CopyFailedMessage;

        Assert.Contains(ChartExportMenuRegistration.MenuLabelKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.CsvKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.PngKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.SvgKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.CopyKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.CopySuccessKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.CopyUnavailableKey, localizer.RequestedKeys);
        Assert.Contains(ChartExportMenuRegistration.CopyFailedKey, localizer.RequestedKeys);
    }

    // ── seams: canonical / inert implementations ─────────────────────────────────────────────────────────

    [Fact]
    public void NoOp_actions_offer_no_csv_and_fail_copy()
    {
        Assert.False(NoOpChartExportActions.Instance.CanExportCsv);
        Assert.Same(NoOpChartExportActions.Instance, NoOpChartExportActions.Instance);
    }

    [Fact]
    public async Task NoOp_actions_copy_resolves_to_failed()
    {
        ChartExportClipboardOutcome outcome = await NoOpChartExportActions.Instance.CopyImageAsync();

        Assert.Equal(ChartExportClipboardOutcome.Failed, outcome);
    }

    [Fact]
    public void NoOp_toast_is_a_shared_singleton() =>
        Assert.Same(NoOpChartExportToast.Instance, NoOpChartExportToast.Instance);

    [Fact]
    public void Delegate_actions_report_csv_only_when_a_csv_delegate_is_supplied()
    {
        var withCsv = new ChartExportActions(
            () => Task.CompletedTask,
            () => Task.CompletedTask,
            () => Task.FromResult(ChartExportClipboardOutcome.Copied),
            () => Task.CompletedTask);
        var withoutCsv = new ChartExportActions(
            () => Task.CompletedTask,
            () => Task.CompletedTask,
            () => Task.FromResult(ChartExportClipboardOutcome.Copied));

        Assert.True(withCsv.CanExportCsv);
        Assert.False(withoutCsv.CanExportCsv);
    }

    [Fact]
    public async Task Delegate_actions_invoke_their_delegates()
    {
        int png = 0, svg = 0, csv = 0, copy = 0;
        var actions = new ChartExportActions(
            () => { png++; return Task.CompletedTask; },
            () => { svg++; return Task.CompletedTask; },
            () => { copy++; return Task.FromResult(ChartExportClipboardOutcome.Copied); },
            () => { csv++; return Task.CompletedTask; });

        await actions.ExportPngAsync();
        await actions.ExportSvgAsync();
        await actions.ExportCsvAsync();
        ChartExportClipboardOutcome outcome = await actions.CopyImageAsync();

        Assert.Equal(1, png);
        Assert.Equal(1, svg);
        Assert.Equal(1, csv);
        Assert.Equal(1, copy);
        Assert.Equal(ChartExportClipboardOutcome.Copied, outcome);
    }

    [Fact]
    public async Task Delegate_actions_degrade_gracefully_for_null_delegates()
    {
        var actions = new ChartExportActions(null, null, null);

        Exception? error = await Record.ExceptionAsync(async () =>
        {
            await actions.ExportPngAsync();
            await actions.ExportSvgAsync();
            await actions.ExportCsvAsync();
        });
        ChartExportClipboardOutcome outcome = await actions.CopyImageAsync();

        Assert.Null(error);
        Assert.Equal(ChartExportClipboardOutcome.Failed, outcome);
    }

    // ── construction guards ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Constructor_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new ChartExportMenuViewModel(null!, NoOpChartExportToast.Instance, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            new ChartExportMenuViewModel(NoOpChartExportActions.Instance, null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            new ChartExportMenuViewModel(NoOpChartExportActions.Instance, NoOpChartExportToast.Instance, null!));
    }

    // ── diagnostics (view.opened, PII-safe — never a file path or image bytes) ───────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChartExportMenuDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChartExportMenu", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ChartExportMenuDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
