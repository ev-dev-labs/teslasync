using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PrintButton surface's UI-thread-free logic — the registration slug + i18n
/// key / fallback (<see cref="PrintButtonRegistration"/>), the click → outcome control flow, the re-entrancy
/// guard, the <c>beforePrint</c> hook (success / throw / ordering), the per-state label + accessible-name
/// projections (<see cref="PrintButtonViewModel"/>), the print seam (<see cref="IPrintInvoker"/> with its
/// delegate-backed and inert implementations) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/ui/PrintButton.tsx). The WinUI view (PrintButton.cs, which composes a TsButton + the
/// platform PrintManager writer) is exercised by the app build.
/// </summary>
public sealed class PrintButtonTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingPrintInvoker : IPrintInvoker
    {
        private readonly bool _result;
        private readonly Action? _onInvoke;

        public RecordingPrintInvoker(bool result, Action? onInvoke = null)
        {
            _result = result;
            _onInvoke = onInvoke;
        }

        public int Invocations { get; private set; }

        public Task<bool> PrintAsync()
        {
            Invocations++;
            _onInvoke?.Invoke();
            return Task.FromResult(_result);
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

    private static PrintButtonViewModel NewViewModel(
        IPrintInvoker? printer = null,
        ILocalizer? localizer = null,
        PrintButtonDiagnostics? diagnostics = null) =>
        new(
            printer ?? new RecordingPrintInvoker(true),
            localizer ?? PassthroughLocalizer.Instance,
            diagnostics);

    // ── registration (diagnostics slug + i18n key/fallback, web verbatim) ─────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("PrintButton", PrintButtonRegistration.Slug);

    [Fact]
    public void I18n_key_carries_the_translation_prefixed_web_key() =>
        Assert.Equal("translation.common.printButton.print", PrintButtonRegistration.PrintKey);

    [Fact]
    public void I18n_fallback_matches_the_web_english_copy() =>
        Assert.Equal("Print", PrintButtonRegistration.PrintFallback);

    // ── state: idle (initial render, web printing === false) ──────────────────────────────────────────────

    [Fact]
    public void Idle_shows_the_print_label_and_is_not_printing()
    {
        PrintButtonViewModel vm = NewViewModel();

        Assert.False(vm.IsPrinting);
        Assert.Equal("Print", vm.VisibleLabel);
    }

    // ── state: printed (web happy path — beforePrint resolved + window.print()) ───────────────────────────

    [Fact]
    public async Task Click_opens_the_print_experience_through_the_seam()
    {
        var invoker = new RecordingPrintInvoker(result: true);
        PrintButtonViewModel vm = NewViewModel(invoker);

        PrintButtonOutcome outcome = await vm.PrintAsync();

        Assert.Equal(PrintButtonOutcome.Printed, outcome);
        Assert.Equal(1, invoker.Invocations);
    }

    [Fact]
    public async Task Successful_print_returns_to_idle()
    {
        PrintButtonViewModel vm = NewViewModel(new RecordingPrintInvoker(true));

        await vm.PrintAsync();

        Assert.False(vm.IsPrinting);
    }

    [Fact]
    public async Task Successful_print_records_no_failed_print_diagnostic()
    {
        var diagnostics = new PrintButtonDiagnostics();
        PrintButtonViewModel vm = NewViewModel(new RecordingPrintInvoker(true), diagnostics: diagnostics);

        await vm.PrintAsync();

        Assert.Equal(0, diagnostics.PrintFailures);
    }

    [Fact]
    public async Task Printing_sets_then_clears_the_busy_flag()
    {
        var gate = new TaskCompletionSource();
        PrintButtonViewModel vm = NewViewModel();
        vm.BeforePrint = () => gate.Task;
        var busyChanges = new List<bool>();
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PrintButtonViewModel.IsPrinting))
            {
                busyChanges.Add(vm.IsPrinting);
            }
        };

        Task<PrintButtonOutcome> inFlight = vm.PrintAsync();
        Assert.True(vm.IsPrinting);

        gate.SetResult();
        await inFlight;

        Assert.False(vm.IsPrinting);
        Assert.Equal(new[] { true, false }, busyChanges);
    }

    // ── beforePrint hook (web `if (beforePrint) await beforePrint()`) ─────────────────────────────────────

    [Fact]
    public async Task Before_print_runs_before_the_print_experience_opens()
    {
        var order = new List<string>();
        var invoker = new RecordingPrintInvoker(result: true, onInvoke: () => order.Add("print"));
        PrintButtonViewModel vm = NewViewModel(invoker);
        vm.BeforePrint = () =>
        {
            order.Add("before");
            return Task.CompletedTask;
        };

        await vm.PrintAsync();

        Assert.Equal(new[] { "before", "print" }, order);
    }

    [Fact]
    public async Task Async_before_print_is_fully_awaited_before_the_print_experience_opens()
    {
        var order = new List<string>();
        var invoker = new RecordingPrintInvoker(result: true, onInvoke: () => order.Add("print"));
        PrintButtonViewModel vm = NewViewModel(invoker);
        vm.BeforePrint = async () =>
        {
            await Task.Yield();
            order.Add("before");
        };

        PrintButtonOutcome outcome = await vm.PrintAsync();

        Assert.Equal(PrintButtonOutcome.Printed, outcome);
        Assert.Equal(new[] { "before", "print" }, order);
    }

    // ── state: beforePrint failed (web catch — console.error + setPrinting(false), dialog NOT opened) ──────

    [Fact]
    public async Task Before_print_throwing_skips_the_print_experience_and_returns_to_idle()
    {
        var invoker = new RecordingPrintInvoker(result: true);
        PrintButtonViewModel vm = NewViewModel(invoker);
        vm.BeforePrint = () => throw new InvalidOperationException("boom");

        PrintButtonOutcome outcome = await vm.PrintAsync();

        Assert.Equal(PrintButtonOutcome.BeforePrintFailed, outcome);
        Assert.Equal(0, invoker.Invocations);
        Assert.False(vm.IsPrinting);
    }

    [Fact]
    public async Task Before_print_throwing_records_the_failed_print_diagnostic()
    {
        var lines = new List<string>();
        var diagnostics = new PrintButtonDiagnostics(lines.Add);
        PrintButtonViewModel vm = NewViewModel(diagnostics: diagnostics);
        vm.BeforePrint = () => Task.FromException(new InvalidOperationException("boom"));

        await vm.PrintAsync();

        Assert.Equal(1, diagnostics.PrintFailures);
        Assert.Equal("print.failed slug=PrintButton", Assert.Single(lines));
    }

    // ── state: print failed (seam reports the dialog could not open) ──────────────────────────────────────

    [Fact]
    public async Task Failed_print_open_returns_print_failed_and_records_the_diagnostic()
    {
        var lines = new List<string>();
        var diagnostics = new PrintButtonDiagnostics(lines.Add);
        PrintButtonViewModel vm = NewViewModel(new RecordingPrintInvoker(result: false), diagnostics: diagnostics);

        PrintButtonOutcome outcome = await vm.PrintAsync();

        Assert.Equal(PrintButtonOutcome.PrintFailed, outcome);
        Assert.False(vm.IsPrinting);
        Assert.Equal(1, diagnostics.PrintFailures);
        Assert.Equal("print.failed slug=PrintButton", Assert.Single(lines));
    }

    // ── re-entrancy guard (web `if (printing) return`) ────────────────────────────────────────────────────

    [Fact]
    public async Task Re_entrant_click_while_printing_is_ignored()
    {
        var gate = new TaskCompletionSource();
        var invoker = new RecordingPrintInvoker(result: true);
        PrintButtonViewModel vm = NewViewModel(invoker);
        vm.BeforePrint = () => gate.Task;

        Task<PrintButtonOutcome> inFlight = vm.PrintAsync();
        Assert.True(vm.IsPrinting);

        PrintButtonOutcome reentrant = await vm.PrintAsync();
        Assert.Equal(PrintButtonOutcome.AlreadyPrinting, reentrant);

        gate.SetResult();
        Assert.Equal(PrintButtonOutcome.Printed, await inFlight);
        Assert.Equal(1, invoker.Invocations);
        Assert.False(vm.IsPrinting);
    }

    // ── state: icon-only (web iconOnly — no visible text, accessible name retained) ───────────────────────

    [Fact]
    public void IconOnly_hides_the_visible_label_but_keeps_an_accessible_name()
    {
        PrintButtonViewModel vm = NewViewModel();
        vm.IconOnly = true;

        Assert.Null(vm.VisibleLabel);
        Assert.Equal("Print", vm.ResolvedAriaLabel);
    }

    // ── label override (web label — replaces the localized default) ───────────────────────────────────────

    [Fact]
    public void Label_override_replaces_the_visible_text()
    {
        PrintButtonViewModel vm = NewViewModel();
        vm.LabelOverride = "Print report";

        Assert.Equal("Print report", vm.VisibleLabel);

        // web: resolvedAriaLabel = ariaLabel ?? (iconOnly ? printLabel : undefined) — null lets the text be the name.
        Assert.Null(vm.ResolvedAriaLabel);
    }

    [Fact]
    public void Label_override_drives_the_icon_only_accessible_name()
    {
        PrintButtonViewModel vm = NewViewModel();
        vm.LabelOverride = "Print report";
        vm.IconOnly = true;

        Assert.Null(vm.VisibleLabel);
        Assert.Equal("Print report", vm.ResolvedAriaLabel);
    }

    // ── accessibility: the resolved aria-label (web resolvedAriaLabel) ────────────────────────────────────

    [Fact]
    public void Visible_label_serves_as_the_name_when_not_icon_only_and_no_override()
    {
        PrintButtonViewModel vm = NewViewModel();

        Assert.Null(vm.ResolvedAriaLabel);
        Assert.Equal("Print", vm.VisibleLabel);
    }

    [Fact]
    public void Aria_label_override_wins_over_the_auto_generated_name()
    {
        PrintButtonViewModel vm = NewViewModel();
        vm.AriaLabelOverride = "Print this page";

        // Wins whether icon-only or not.
        Assert.Equal("Print this page", vm.ResolvedAriaLabel);

        vm.IconOnly = true;
        Assert.Equal("Print this page", vm.ResolvedAriaLabel);
    }

    // ── change notification (the view re-renders label + name from these) ─────────────────────────────────

    [Fact]
    public void Setting_icon_only_raises_change_for_label_and_name()
    {
        PrintButtonViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IconOnly = true;

        Assert.Contains(nameof(PrintButtonViewModel.IconOnly), changed);
        Assert.Contains(nameof(PrintButtonViewModel.VisibleLabel), changed);
        Assert.Contains(nameof(PrintButtonViewModel.ResolvedAriaLabel), changed);
    }

    // ── i18n: every string flows through the localizer (no hardcoded English in the view-model) ───────────

    [Fact]
    public void Every_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        PrintButtonViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.PrintLabel;
        _ = vm.VisibleLabel;
        vm.IconOnly = true;
        _ = vm.ResolvedAriaLabel;

        Assert.Contains(PrintButtonRegistration.PrintKey, localizer.RequestedKeys);
    }

    // ── constructor guards (printer + localizer required) ─────────────────────────────────────────────────

    [Fact]
    public void Constructor_rejects_null_required_seams()
    {
        IPrintInvoker printer = NoOpPrintInvoker.Instance;
        ILocalizer localizer = PassthroughLocalizer.Instance;

        Assert.Throws<ArgumentNullException>(() => new PrintButtonViewModel(null!, localizer));
        Assert.Throws<ArgumentNullException>(() => new PrintButtonViewModel(printer, null!));
    }

    // ── seams: delegate-backed + inert implementations ────────────────────────────────────────────────────

    [Fact]
    public async Task Delegate_print_invoker_forwards_to_the_delegate()
    {
        var invoked = false;
        var invoker = new DelegatePrintInvoker(() =>
        {
            invoked = true;
            return Task.FromResult(true);
        });

        bool ok = await invoker.PrintAsync();

        Assert.True(ok);
        Assert.True(invoked);
    }

    [Fact]
    public async Task Delegate_print_invoker_degrades_a_null_delegate_to_failure()
    {
        var invoker = new DelegatePrintInvoker(null);

        Assert.False(await invoker.PrintAsync());
    }

    [Fact]
    public async Task NoOp_print_invoker_reports_failure() =>
        Assert.False(await NoOpPrintInvoker.Instance.PrintAsync());

    // ── diagnostics (view.opened + print.failed, PII-safe — no view content) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PrintButtonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PrintButton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_record_emits_print_failed_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PrintButtonDiagnostics(lines.Add);

        diagnostics.RecordPrintFailed();

        Assert.Equal(1, diagnostics.PrintFailures);
        Assert.Equal("print.failed slug=PrintButton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new PrintButtonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
