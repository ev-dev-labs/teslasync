using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChartExportMenu"/> view — the native port of the
/// web component body (web/src/components/charts/ChartExportMenu.tsx). It mirrors the web source's behaviour
/// exactly: the controlled <see cref="IsOpen"/> menu state (web <c>useState(false)</c>) gated by
/// <see cref="IsDisabled"/> so the menu is visible only when <c>open &amp;&amp; !disabled</c>
/// (<see cref="IsMenuVisible"/>); the <see cref="IsBusy"/> flag that disables the image-capture items while a
/// snapshot is in flight but leaves the CSV item enabled (web <c>disabled={busy}</c> on PNG/SVG/Copy, none on
/// CSV); the conditional CSV item (<see cref="HasCsv"/> = an <c>onExportCsv</c> callback was wired); the
/// disabled-vs-enabled trigger label (web <c>chart.export.disabledTooltip</c> vs <c>chart.export.menuLabel</c>);
/// and the <c>handleCopy</c> routing that awaits the copy outcome and announces success / "downloaded instead" /
/// failure on the optional toast. Each action closes the menu first, then fires (web <c>close()</c> then the
/// callback). The view binds the projected labels + flags and never performs I/O. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChartExportMenuViewModel : INotifyPropertyChanged
{
    private readonly IChartExportActions _actions;
    private readonly IChartExportToast _toast;
    private readonly ILocalizer _localizer;

    private bool _isOpen;
    private bool _isDisabled;
    private bool _isBusy;

    /// <summary>
    /// Creates the holder over its export-action seam, the optional toast seam (P1/S8) and the i18n facade.
    /// </summary>
    /// <param name="actions">The export-action seam (web callback props); its <c>CanExportCsv</c> decides whether the CSV item shows.</param>
    /// <param name="toast">The transient-feedback seam (web <c>useOptionalToast()</c>); pass <see cref="NoOpChartExportToast.Instance"/> when none is mounted.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="disabled">The initial disabled state (web <c>disabled</c> prop); the menu cannot open while disabled.</param>
    /// <param name="busy">The initial busy state (web <c>busy</c> prop); disables the image-capture items only.</param>
    public ChartExportMenuViewModel(
        IChartExportActions actions,
        IChartExportToast toast,
        ILocalizer localizer,
        bool disabled = false,
        bool busy = false)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(toast);
        ArgumentNullException.ThrowIfNull(localizer);

        _actions = actions;
        _toast = toast;
        _localizer = localizer;
        _isDisabled = disabled;
        _isBusy = busy;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Whether the menu is open (web <c>open</c> state). Opening is gated by <see cref="IsDisabled"/>; closing
    /// always succeeds. The view keeps this in sync with the native flyout's open/close.
    /// </summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set
        {
            if (_isOpen == value)
            {
                return;
            }

            _isOpen = value;
            Raise(nameof(IsOpen));
            Raise(nameof(IsMenuVisible));
        }
    }

    /// <summary>
    /// Whether the trigger is disabled (web <c>disabled</c> prop). While disabled the menu cannot open, the
    /// menu is not visible even if <see cref="IsOpen"/> is true (web <c>open &amp;&amp; !disabled</c>), and the
    /// trigger announces the "not ready" label.
    /// </summary>
    public bool IsDisabled
    {
        get => _isDisabled;
        set
        {
            if (_isDisabled == value)
            {
                return;
            }

            _isDisabled = value;
            Raise(nameof(IsDisabled));
            Raise(nameof(IsMenuVisible));
            Raise(nameof(TriggerLabel));
        }
    }

    /// <summary>
    /// Whether a snapshot is in flight (web <c>busy</c> prop). Disables the PNG / SVG / Copy items
    /// (<see cref="IsImageItemEnabled"/>) but never the CSV item, exactly as the web source applies
    /// <c>disabled={busy}</c> to the image items only.
    /// </summary>
    public bool IsBusy
    {
        get => _isBusy;
        set
        {
            if (_isBusy == value)
            {
                return;
            }

            _isBusy = value;
            Raise(nameof(IsBusy));
            Raise(nameof(IsImageItemEnabled));
        }
    }

    /// <summary>
    /// True when the CSV item is present — a CSV export callback was wired (web: <c>onExportCsv</c> supplied).
    /// </summary>
    public bool HasCsv => _actions.CanExportCsv;

    /// <summary>
    /// True when the menu surface is actually shown — open and not disabled (web
    /// <c>{open &amp;&amp; !disabled &amp;&amp; (...menu)}</c>).
    /// </summary>
    public bool IsMenuVisible => _isOpen && !_isDisabled;

    /// <summary>
    /// Whether the image-capture items (PNG / SVG / Copy) are interactive — true unless a snapshot is in flight
    /// (web <c>disabled={busy}</c>).
    /// </summary>
    public bool IsImageItemEnabled => !_isBusy;

    /// <summary>
    /// Whether the CSV item is interactive — true whenever it is present; it ignores <see cref="IsBusy"/>
    /// because CSV export does not depend on the chart DOM (web comment + no <c>disabled</c> on the CSV item).
    /// </summary>
    public bool IsCsvItemEnabled => HasCsv;

    /// <summary>
    /// The trigger's accessible name / tooltip — the "not ready" copy while disabled, otherwise the menu label
    /// (web <c>disabled ? t('chart.export.disabledTooltip', ...) : t('chart.export.menuLabel', ...)</c>).
    /// </summary>
    public string TriggerLabel => _isDisabled
        ? _localizer.GetString(ChartExportMenuRegistration.DisabledTooltipKey, ChartExportMenuRegistration.DisabledTooltipFallback)
        : _localizer.GetString(ChartExportMenuRegistration.MenuLabelKey, ChartExportMenuRegistration.MenuLabelFallback);

    /// <summary>The menu's accessible name (web <c>role="menu" aria-label={t('chart.export.menuLabel', ...)}</c>).</summary>
    public string MenuLabel =>
        _localizer.GetString(ChartExportMenuRegistration.MenuLabelKey, ChartExportMenuRegistration.MenuLabelFallback);

    /// <summary>The CSV item label (web <c>chart.export.csv</c>).</summary>
    public string CsvLabel =>
        _localizer.GetString(ChartExportMenuRegistration.CsvKey, ChartExportMenuRegistration.CsvFallback);

    /// <summary>The PNG item label (web <c>chart.export.png</c>).</summary>
    public string PngLabel =>
        _localizer.GetString(ChartExportMenuRegistration.PngKey, ChartExportMenuRegistration.PngFallback);

    /// <summary>The SVG item label (web <c>chart.export.svg</c>).</summary>
    public string SvgLabel =>
        _localizer.GetString(ChartExportMenuRegistration.SvgKey, ChartExportMenuRegistration.SvgFallback);

    /// <summary>The copy-image item label (web <c>chart.export.copy</c>).</summary>
    public string CopyLabel =>
        _localizer.GetString(ChartExportMenuRegistration.CopyKey, ChartExportMenuRegistration.CopyFallback);

    /// <summary>The success-toast message (web <c>chart.export.copySuccess</c>).</summary>
    public string CopySuccessMessage =>
        _localizer.GetString(ChartExportMenuRegistration.CopySuccessKey, ChartExportMenuRegistration.CopySuccessFallback);

    /// <summary>The clipboard-unavailable toast message (web <c>chart.export.copyFallback</c>).</summary>
    public string CopyUnavailableMessage =>
        _localizer.GetString(ChartExportMenuRegistration.CopyUnavailableKey, ChartExportMenuRegistration.CopyUnavailableFallback);

    /// <summary>The copy-failed toast message (web <c>chart.export.copyFailed</c>).</summary>
    public string CopyFailedMessage =>
        _localizer.GetString(ChartExportMenuRegistration.CopyFailedKey, ChartExportMenuRegistration.CopyFailedFallback);

    /// <summary>
    /// Map a clipboard outcome to the toast it should raise — the pure projection of the web <c>handleCopy</c>
    /// branch (success / info-"downloaded instead" / error). Exposed for headless tests of the mapping.
    /// </summary>
    public ChartExportToastIntent ToastIntentFor(ChartExportClipboardOutcome outcome) => outcome switch
    {
        ChartExportClipboardOutcome.Copied => new ChartExportToastIntent(ChartExportToastSeverity.Success, CopySuccessMessage),
        ChartExportClipboardOutcome.Fallback => new ChartExportToastIntent(ChartExportToastSeverity.Info, CopyUnavailableMessage),
        _ => new ChartExportToastIntent(ChartExportToastSeverity.Error, CopyFailedMessage),
    };

    /// <summary>Open the menu (web <c>setOpen(true)</c>); a no-op while disabled, as the web trigger cannot fire.</summary>
    public void OpenMenu()
    {
        if (_isDisabled)
        {
            return;
        }

        IsOpen = true;
    }

    /// <summary>Close the menu (web <c>close()</c>).</summary>
    public void CloseMenu() => IsOpen = false;

    /// <summary>Toggle the menu (web trigger <c>onClick={() =&gt; setOpen(v =&gt; !v)}</c>).</summary>
    public void ToggleMenu()
    {
        if (_isOpen)
        {
            CloseMenu();
        }
        else
        {
            OpenMenu();
        }
    }

    /// <summary>Fire the PNG export (web <c>handlePng</c>): close the menu, then run the export.</summary>
    public void InvokePng()
    {
        CloseMenu();
        _ = _actions.ExportPngAsync();
    }

    /// <summary>Fire the SVG export (web <c>handleSvg</c>): close the menu, then run the export.</summary>
    public void InvokeSvg()
    {
        CloseMenu();
        _ = _actions.ExportSvgAsync();
    }

    /// <summary>
    /// Fire the CSV export (web <c>handleCsv</c>): a no-op when no CSV callback is wired, otherwise close the
    /// menu and run the export.
    /// </summary>
    public void InvokeCsv()
    {
        if (!HasCsv)
        {
            return;
        }

        CloseMenu();
        _ = _actions.ExportCsvAsync();
    }

    /// <summary>
    /// Fire the copy-image action (web <c>handleCopy</c>) as a detached task — the view's click handler.
    /// </summary>
    public void InvokeCopy() => _ = InvokeCopyAsync();

    /// <summary>
    /// Close the menu, copy the chart image and announce the outcome on the toast — the awaitable core of
    /// <see cref="InvokeCopy"/> (exposed for headless tests). Mirrors the web <c>handleCopy</c>: close, await
    /// <c>onCopyImage()</c>, then raise the success / "downloaded instead" / failure toast per outcome (the
    /// inert toast simply drops the announcement, like <c>useOptionalToast() === null</c>).
    /// </summary>
    public async Task InvokeCopyAsync()
    {
        CloseMenu();
        ChartExportClipboardOutcome outcome = await _actions.CopyImageAsync().ConfigureAwait(false);
        ChartExportToastIntent intent = ToastIntentFor(outcome);
        _toast.Show(intent.Severity, intent.Message);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
