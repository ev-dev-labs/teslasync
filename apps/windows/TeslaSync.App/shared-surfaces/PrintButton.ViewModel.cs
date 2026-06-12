using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PrintButton"/> view — the native port of the web
/// component body (web/src/components/ui/PrintButton.tsx). It mirrors the web source's behaviour exactly:
///
/// <list type="bullet">
///   <item>the controlled <see cref="IsPrinting"/> busy flag (web <c>const [printing, setPrinting] =
///   useState(false)</c>) that guards against re-entrant clicks (web <c>if (printing) return</c>);</item>
///   <item>the opt-in inputs that shape rendering — <see cref="LabelOverride"/> (web <c>label</c>),
///   <see cref="IconOnly"/> (web <c>iconOnly</c>), <see cref="AriaLabelOverride"/> (web <c>ariaLabel</c>) and
///   <see cref="BeforePrint"/> (web <c>beforePrint</c>);</item>
///   <item>the <c>handleClick</c> routing that — when not already printing — enters the busy state, awaits the
///   optional <see cref="BeforePrint"/> hook (and on a throw records the failure and returns to idle WITHOUT
///   opening the dialog, the web <c>catch</c> path), then opens the print experience through the seam and clears
///   the busy flag whether the open succeeded or failed (web <c>try { window.print() } finally {
///   setPrinting(false) }</c>).</item>
/// </list>
///
/// The web wraps <c>window.print()</c> in a <c>requestAnimationFrame</c> so React paints any
/// <c>beforePrint</c> state changes before the browser snapshots the DOM for the print dialog. WinUI prints an
/// explicit print-document source rather than a live visual-tree snapshot, so that paint-flush has no exact native
/// analogue; the faithful behaviour preserved here is the ordering — <see cref="BeforePrint"/> is fully awaited
/// before the seam opens the print experience. The view binds the projected label + accessible name and never
/// performs print I/O. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PrintButtonViewModel : INotifyPropertyChanged
{
    private readonly IPrintInvoker _printer;
    private readonly ILocalizer _localizer;
    private readonly PrintButtonDiagnostics? _diagnostics;

    private string? _labelOverride;
    private string? _ariaLabelOverride;
    private bool _iconOnly;
    private bool _isPrinting;

    /// <summary>Creates the holder over its print seam (P1/S8) and i18n facade.</summary>
    /// <param name="printer">The print-trigger seam (web <c>window.print()</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through (web <c>useTranslation()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the failed-print signal (web <c>console.error</c>).</param>
    public PrintButtonViewModel(
        IPrintInvoker printer,
        ILocalizer localizer,
        PrintButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(printer);
        ArgumentNullException.ThrowIfNull(localizer);

        _printer = printer;
        _localizer = localizer;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>PrintButton</c>).</summary>
    public static string Slug => PrintButtonRegistration.Slug;

    /// <summary>
    /// Optional override of the default "Print" label (web <c>label</c> prop). When set, it replaces the localized
    /// default in both the visible text and the icon-only accessible name (web <c>printLabel = label ??
    /// t('common.printButton.print', 'Print')</c>).
    /// </summary>
    public string? LabelOverride
    {
        get => _labelOverride;
        set
        {
            if (string.Equals(_labelOverride, value, StringComparison.Ordinal))
            {
                return;
            }

            _labelOverride = value;
            Raise(nameof(LabelOverride));
            Raise(nameof(VisibleLabel));
            Raise(nameof(ResolvedAriaLabel));
        }
    }

    /// <summary>Optional accessible-name override (web <c>ariaLabel</c>); wins over the auto-generated name when set.</summary>
    public string? AriaLabelOverride
    {
        get => _ariaLabelOverride;
        set
        {
            if (string.Equals(_ariaLabelOverride, value, StringComparison.Ordinal))
            {
                return;
            }

            _ariaLabelOverride = value;
            Raise(nameof(AriaLabelOverride));
            Raise(nameof(ResolvedAriaLabel));
        }
    }

    /// <summary>
    /// Whether to drop the visible label and show only the printer icon (web <c>iconOnly</c>). When set,
    /// <see cref="VisibleLabel"/> is null and an accessible name is always resolved so the control is never
    /// unlabelled.
    /// </summary>
    public bool IconOnly
    {
        get => _iconOnly;
        set
        {
            if (_iconOnly == value)
            {
                return;
            }

            _iconOnly = value;
            Raise(nameof(IconOnly));
            Raise(nameof(VisibleLabel));
            Raise(nameof(ResolvedAriaLabel));
        }
    }

    /// <summary>
    /// Optional setup hook run before the print experience opens (web <c>beforePrint</c> prop) — e.g. expand
    /// collapsed sections or switch to the tab the user wants on paper. Awaited in full before the seam is invoked;
    /// if it throws, the surface logs the failure and stays idle WITHOUT opening the dialog (web <c>catch</c>).
    /// A synchronous caller returns <see cref="Task.CompletedTask"/>.
    /// </summary>
    public Func<Task>? BeforePrint { get; set; }

    /// <summary>
    /// Whether a print is currently in flight (web <c>printing</c> state) — set for the duration of
    /// <see cref="PrintAsync"/> and used to ignore re-entrant clicks. The web button shows no visual busy
    /// affordance, so this drives only the re-entrancy guard, not the rendered icon/label.
    /// </summary>
    public bool IsPrinting
    {
        get => _isPrinting;
        private set
        {
            if (_isPrinting == value)
            {
                return;
            }

            _isPrinting = value;
            Raise(nameof(IsPrinting));
        }
    }

    /// <summary>The default button label (web <c>common.printButton.print</c> → "Print").</summary>
    public string PrintLabel =>
        _localizer.GetString(PrintButtonRegistration.PrintKey, PrintButtonRegistration.PrintFallback);

    /// <summary>
    /// The visible button text, or null in <see cref="IconOnly"/> mode (web <c>{iconOnly ? null : printLabel}</c>).
    /// A <see cref="LabelOverride"/> replaces the localized default; otherwise it is "Print".
    /// </summary>
    public string? VisibleLabel => _iconOnly ? null : (_labelOverride ?? PrintLabel);

    /// <summary>
    /// The resolved accessible name (web <c>resolvedAriaLabel = ariaLabel ?? (iconOnly ? printLabel :
    /// undefined)</c>): an explicit <see cref="AriaLabelOverride"/> always wins; otherwise in
    /// <see cref="IconOnly"/> mode the name is the print label (the <see cref="LabelOverride"/> or "Print"); when a
    /// label is visible (not icon-only and no override) this is null so the visible text serves as the name.
    /// </summary>
    public string? ResolvedAriaLabel =>
        _ariaLabelOverride ?? (_iconOnly ? (_labelOverride ?? PrintLabel) : null);

    /// <summary>Fire the print action (web <c>handleClick</c>) as a detached task — the view's click handler.</summary>
    public void Print() => _ = PrintAsync();

    /// <summary>
    /// Run the print flow and report the outcome — the awaitable core of <see cref="Print"/> (exposed for headless
    /// tests). Mirrors the web <c>handleClick</c>: ignore a click while already printing (web <c>if (printing)
    /// return</c>); otherwise enter the busy state (web <c>setPrinting(true)</c>), await the optional
    /// <see cref="BeforePrint"/> hook — on a throw record the failed print and return to idle without opening the
    /// dialog (web <c>catch</c> + <c>console.error</c>) — then open the print experience through the seam, clearing
    /// the busy flag whether it succeeded or failed (web <c>finally { setPrinting(false) }</c>) and recording a
    /// failed open.
    /// </summary>
    /// <returns>The print outcome.</returns>
    public async Task<PrintButtonOutcome> PrintAsync()
    {
        // web: if (printing) return — a re-entrant click is ignored while a print is in flight.
        if (_isPrinting)
        {
            return PrintButtonOutcome.AlreadyPrinting;
        }

        // web: setPrinting(true) — set synchronously (before any await) so the guard above is effective.
        IsPrinting = true;

        if (BeforePrint is { } beforePrint)
        {
            try
            {
                await beforePrint().ConfigureAwait(false);
            }
            catch (Exception)
            {
                // web catch: console.error('PrintButton: beforePrint failed', err); setPrinting(false) — the dialog
                // is never opened and the surface returns to idle.
                _diagnostics?.RecordPrintFailed();
                IsPrinting = false;
                return PrintButtonOutcome.BeforePrintFailed;
            }
        }

        bool opened;
        try
        {
            // web: requestAnimationFrame(() => { try { window.print() } ... }) — beforePrint has fully awaited above,
            // so its state changes are committed before the print experience opens.
            opened = await _printer.PrintAsync().ConfigureAwait(false);
        }
        finally
        {
            // web finally: setPrinting(false) — the busy flag clears whether or not the dialog opened.
            IsPrinting = false;
        }

        if (!opened)
        {
            _diagnostics?.RecordPrintFailed();
            return PrintButtonOutcome.PrintFailed;
        }

        return PrintButtonOutcome.Printed;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
