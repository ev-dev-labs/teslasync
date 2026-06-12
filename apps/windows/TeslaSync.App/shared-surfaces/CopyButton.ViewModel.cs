using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CopyButton"/> view — the native port of the web
/// component body (web/src/components/ui/CopyButton.tsx). It mirrors the web source's behaviour exactly:
///
/// <list type="bullet">
///   <item>the controlled <see cref="IsCopied"/> confirmation flag (web <c>const [copied, setCopied] =
///   useState(false)</c>) that swaps the button between its idle "Copy" + copy icon and the "Copied" + check
///   icon (driving <see cref="VisibleLabel"/> / <see cref="ShowCheckIcon"/>);</item>
///   <item>the opt-in inputs that shape rendering — <see cref="Text"/> (web <c>text</c>, the value copied),
///   <see cref="LabelOverride"/> (web <c>label</c>), <see cref="IconOnly"/> (web <c>iconOnly</c>),
///   <see cref="AriaLabelOverride"/> (web <c>ariaLabel</c>), <see cref="WithToast"/> (web <c>withToast</c>) and
///   <see cref="OnCopy"/> (web <c>onCopy</c>);</item>
///   <item>the <c>handleCopy</c> routing that writes <see cref="Text"/> to the clipboard and, on success, enters
///   the confirmation state and invokes <see cref="OnCopy"/>; on either outcome it raises the matching toast
///   only when the caller opted in (web <c>if (withToast) toast?.success/error(...)</c>) and the toast overlay
///   is present (the web <c>useOptionalToast</c> nullable result), and on failure it records the failed write
///   (web <c>console.error</c>).</item>
/// </list>
///
/// The two-second revert back to idle (web <c>setTimeout(() =&gt; setCopied(false), 2000)</c>) is a view concern:
/// the view arms a one-shot timer and calls <see cref="ResetCopied"/>, keeping this holder free of
/// UI-thread/timer concerns and unit-testable headlessly. The view binds the projected labels + flags and never
/// performs clipboard I/O. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CopyButtonViewModel : INotifyPropertyChanged
{
    private readonly IClipboardCopier _clipboard;
    private readonly IToastController? _toast;
    private readonly ILocalizer _localizer;
    private readonly CopyButtonDiagnostics? _diagnostics;

    private string _text = string.Empty;
    private string? _labelOverride;
    private string? _ariaLabelOverride;
    private bool _iconOnly;
    private bool _withToast;
    private bool _isCopied;

    /// <summary>Creates the holder over its clipboard seam (P1/S8), the optional shared toast queue and i18n facade.</summary>
    /// <param name="clipboard">The clipboard-write seam (web <c>navigator.clipboard.writeText</c>).</param>
    /// <param name="toast">
    /// The shared toast queue (web <c>useOptionalToast()</c>); may be null when no toast overlay is hosted, in
    /// which case success / failure are never announced — exactly the web nullable degradation.
    /// </param>
    /// <param name="localizer">The i18n facade every label and message resolves through (web <c>useTranslation()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the failed-write signal (web <c>console.error</c>).</param>
    public CopyButtonViewModel(
        IClipboardCopier clipboard,
        IToastController? toast,
        ILocalizer localizer,
        CopyButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(clipboard);
        ArgumentNullException.ThrowIfNull(localizer);

        _clipboard = clipboard;
        _toast = toast;
        _localizer = localizer;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>CopyButton</c>).</summary>
    public static string Slug => CopyButtonRegistration.Slug;

    /// <summary>The value placed on the clipboard (web <c>text</c> prop). Read at copy time.</summary>
    public string Text
    {
        get => _text;
        set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_text, next, StringComparison.Ordinal))
            {
                return;
            }

            _text = next;
            Raise(nameof(Text));
        }
    }

    /// <summary>
    /// Optional override of the default "Copy" / "Copied" visible label (web <c>label</c>). When set, the visible
    /// label stays this string in BOTH the idle and confirmation states — only the icon toggles — reproducing the
    /// web <c>label ?? (copied ? copiedLabel : copyLabel)</c>.
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

    /// <summary>Optional accessible-name override (web <c>ariaLabel</c>); wins over every auto-generated name when set.</summary>
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
    /// Whether to drop the visible label and show only the icon (web <c>iconOnly</c>, for dense lists). When set,
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

    /// <summary>Whether a success/failure toast is raised on copy (web <c>withToast</c>, default off).</summary>
    public bool WithToast
    {
        get => _withToast;
        set
        {
            if (_withToast == value)
            {
                return;
            }

            _withToast = value;
            Raise(nameof(WithToast));
        }
    }

    /// <summary>Optional callback invoked after a successful copy (web <c>onCopy</c>).</summary>
    public Action? OnCopy { get; set; }

    /// <summary>
    /// Whether the button currently shows the "Copied" confirmation (web <c>copied</c> state). Set on a successful
    /// copy and reset by the view's revert timer after <see cref="CopyButtonRegistration.RevertDelay"/>.
    /// </summary>
    public bool IsCopied
    {
        get => _isCopied;
        private set
        {
            if (_isCopied == value)
            {
                return;
            }

            _isCopied = value;
            Raise(nameof(IsCopied));
            Raise(nameof(ShowCheckIcon));
            Raise(nameof(VisibleLabel));
            Raise(nameof(ResolvedAriaLabel));
        }
    }

    /// <summary>The idle button label (web <c>common.copyButton.copy</c> → "Copy").</summary>
    public string CopyLabel =>
        _localizer.GetString(CopyButtonRegistration.CopyKey, CopyButtonRegistration.CopyFallback);

    /// <summary>The confirmation button label (web <c>common.copyButton.copied</c> → "Copied").</summary>
    public string CopiedLabel =>
        _localizer.GetString(CopyButtonRegistration.CopiedKey, CopyButtonRegistration.CopiedFallback);

    /// <summary>The copy-succeeded toast message (web <c>common.copyButton.successToast</c> → "Copied to clipboard").</summary>
    public string SuccessToastMessage =>
        _localizer.GetString(CopyButtonRegistration.SuccessToastKey, CopyButtonRegistration.SuccessToastFallback);

    /// <summary>The copy-failed toast message (web <c>common.copyButton.errorToast</c> → "Failed to copy").</summary>
    public string ErrorToastMessage =>
        _localizer.GetString(CopyButtonRegistration.ErrorToastKey, CopyButtonRegistration.ErrorToastFallback);

    /// <summary>
    /// Whether to show the check (confirmation) icon rather than the copy icon — true exactly while
    /// <see cref="IsCopied"/> (web <c>icon = copied ? &lt;CheckCircle /&gt; : &lt;Copy /&gt;</c>).
    /// </summary>
    public bool ShowCheckIcon => _isCopied;

    /// <summary>
    /// The visible button text, or null in <see cref="IconOnly"/> mode (web
    /// <c>visibleLabel = iconOnly ? null : (label ?? (copied ? copiedLabel : copyLabel))</c>). A
    /// <see cref="LabelOverride"/> pins the text across both states; otherwise it toggles "Copy" → "Copied".
    /// </summary>
    public string? VisibleLabel =>
        _iconOnly ? null : (_labelOverride ?? (_isCopied ? CopiedLabel : CopyLabel));

    /// <summary>
    /// The resolved accessible name (web
    /// <c>resolvedAriaLabel = ariaLabel ?? (iconOnly ? (copied ? copiedLabel : (label ?? copyLabel)) : undefined)</c>):
    /// an explicit <see cref="AriaLabelOverride"/> always wins; otherwise in <see cref="IconOnly"/> mode the name
    /// mirrors the current state ("Copied" once copied, else the <see cref="LabelOverride"/> or "Copy"); when a
    /// label is visible (not icon-only and no override) this is null so the visible text serves as the name.
    /// </summary>
    public string? ResolvedAriaLabel =>
        _ariaLabelOverride ?? (_iconOnly ? (_isCopied ? CopiedLabel : (_labelOverride ?? CopyLabel)) : null);

    /// <summary>
    /// Map a copy outcome to the toast it would raise — the pure projection of the web <c>handleCopy</c> branch
    /// (success → <c>toast.success</c>; failure → <c>toast.error</c>). This mapping is unconditional; whether the
    /// toast is shown is gated by <see cref="WithToast"/> and the presence of a toast overlay. Exposed for
    /// headless tests of the mapping.
    /// </summary>
    /// <param name="outcome">The copy outcome.</param>
    public CopyButtonToastIntent ToastIntentFor(CopyButtonOutcome outcome) => outcome switch
    {
        CopyButtonOutcome.Copied => new CopyButtonToastIntent(CopyButtonToastSeverity.Success, SuccessToastMessage),
        _ => new CopyButtonToastIntent(CopyButtonToastSeverity.Error, ErrorToastMessage),
    };

    /// <summary>Fire the copy action (web <c>handleCopy</c>) as a detached task — the view's click handler.</summary>
    public void Copy() => _ = CopyAsync();

    /// <summary>
    /// Write <see cref="Text"/> to the clipboard and apply the outcome — the awaitable core of <see cref="Copy"/>
    /// (exposed for headless tests). Mirrors the web <c>handleCopy</c>: await the clipboard write, then on success
    /// enter the confirmation state and invoke <see cref="OnCopy"/> (web <c>setCopied(true)</c> + <c>onCopy?.()</c>)
    /// or on failure record the failed write (web <c>console.error</c>) and stay idle; on either outcome raise the
    /// matching toast only when <see cref="WithToast"/> is set and a toast overlay is present (web
    /// <c>if (withToast) toast?.success/error(...)</c>). The two-second revert is the view's concern.
    /// </summary>
    /// <returns>The copy outcome.</returns>
    public async Task<CopyButtonOutcome> CopyAsync()
    {
        bool ok = await _clipboard.CopyTextAsync(_text).ConfigureAwait(false);
        CopyButtonOutcome outcome = ok ? CopyButtonOutcome.Copied : CopyButtonOutcome.Failed;

        if (ok)
        {
            // web: setCopied(true); onCopy?.() — confirm, then notify the caller.
            IsCopied = true;
            OnCopy?.Invoke();
        }
        else
        {
            // web: console.error('CopyButton: clipboard write failed', err) — fired regardless of withToast.
            _diagnostics?.RecordCopyFailed();
        }

        // web: if (withToast) { toast?.success/error(...) } — opt-in AND a mounted overlay are both required.
        if (_withToast && _toast is { } toast)
        {
            RaiseToast(toast, ToastIntentFor(outcome));
        }

        return outcome;
    }

    /// <summary>
    /// Revert the confirmation state back to idle (web <c>setCopied(false)</c>), called by the view's one-shot
    /// timer after <see cref="CopyButtonRegistration.RevertDelay"/>.
    /// </summary>
    public void ResetCopied() => IsCopied = false;

    private static void RaiseToast(IToastController toast, CopyButtonToastIntent intent)
    {
        switch (intent.Severity)
        {
            case CopyButtonToastSeverity.Success:
                toast.Success(intent.Message);
                break;

            case CopyButtonToastSeverity.Error:
            default:
                toast.Error(intent.Message);
                break;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
