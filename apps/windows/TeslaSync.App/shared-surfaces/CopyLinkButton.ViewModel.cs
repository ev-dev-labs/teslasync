using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CopyLinkButton"/> view — the native port of the web
/// component body (web/src/components/layout/CopyLinkButton.tsx). It mirrors the web source's behaviour exactly:
/// the controlled <see cref="IsCopied"/> confirmation flag (web <c>const [copied, setCopied] = useState(false)</c>)
/// that swaps the button between its idle "Copy link" + link icon and the "Copied" + check icon
/// (<see cref="Label"/> / <see cref="ShowCheckIcon"/>); the constant accessible name (web
/// <c>aria-label={t('common.copyLink.label', ...)}</c>) that does NOT change with the confirmation state; and the
/// <c>handleClick</c> routing that reads the current link (web <c>window.location.href</c>), writes it to the
/// clipboard, and announces success / failure on the shared toast queue (web <c>useToast()</c> →
/// <c>toast.success</c> / <c>toast.error</c>). On success it raises the success toast and enters the confirmation
/// state; on failure it raises the error toast and stays idle. The two-second revert back to idle (web
/// <c>setTimeout(() =&gt; setCopied(false), 2000)</c>) is a view concern: the view arms a one-shot timer and calls
/// <see cref="ResetCopied"/>, keeping this holder free of UI-thread/timer concerns and unit-testable headlessly.
/// The view binds the projected labels + flags and never performs clipboard I/O. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CopyLinkButtonViewModel : INotifyPropertyChanged
{
    private readonly ICurrentLinkProvider _link;
    private readonly IClipboardWriter _clipboard;
    private readonly IToastController _toast;
    private readonly ILocalizer _localizer;

    private bool _isCopied;

    /// <summary>Creates the holder over its link + clipboard seams (P1/S8), the shared toast queue and i18n facade.</summary>
    /// <param name="link">The current-view-link seam (web <c>window.location.href</c>).</param>
    /// <param name="clipboard">The clipboard-write seam (web <c>navigator.clipboard.writeText</c>).</param>
    /// <param name="toast">The shared toast queue (web <c>useToast()</c>); success / failure are announced through it.</param>
    /// <param name="localizer">The i18n facade every label and message resolves through (web <c>useTranslation()</c>).</param>
    public CopyLinkButtonViewModel(
        ICurrentLinkProvider link,
        IClipboardWriter clipboard,
        IToastController toast,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(link);
        ArgumentNullException.ThrowIfNull(clipboard);
        ArgumentNullException.ThrowIfNull(toast);
        ArgumentNullException.ThrowIfNull(localizer);

        _link = link;
        _clipboard = clipboard;
        _toast = toast;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>CopyLinkButton</c>).</summary>
    public static string Slug => CopyLinkButtonRegistration.Slug;

    /// <summary>
    /// Whether the button currently shows the "Copied" confirmation (web <c>copied</c> state). Set on a successful
    /// copy and reset by the view's revert timer after <see cref="CopyLinkButtonRegistration.RevertDelay"/>.
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
            Raise(nameof(Label));
            Raise(nameof(ShowCheckIcon));
        }
    }

    /// <summary>
    /// The visible button label — the confirmation copy while <see cref="IsCopied"/>, otherwise the idle action
    /// (web <c>{copied ? t('common.copyLink.copied', 'Copied') : t('common.copyLink.action', 'Copy link')}</c>).
    /// </summary>
    public string Label => _isCopied ? CopiedLabel : ActionLabel;

    /// <summary>The idle button label (web <c>common.copyLink.action</c> → "Copy link").</summary>
    public string ActionLabel =>
        _localizer.GetString(CopyLinkButtonRegistration.ActionKey, CopyLinkButtonRegistration.ActionFallback);

    /// <summary>The confirmation button label (web <c>common.copyLink.copied</c> → "Copied").</summary>
    public string CopiedLabel =>
        _localizer.GetString(CopyLinkButtonRegistration.CopiedKey, CopyLinkButtonRegistration.CopiedFallback);

    /// <summary>
    /// The button's accessible name (web <c>aria-label={t('common.copyLink.label', 'Copy link to this view')}</c>).
    /// Constant regardless of the confirmation state, exactly as the web <c>aria-label</c> never changes.
    /// </summary>
    public string AccessibleLabel =>
        _localizer.GetString(CopyLinkButtonRegistration.LabelKey, CopyLinkButtonRegistration.LabelFallback);

    /// <summary>
    /// Whether to show the check (confirmation) icon rather than the link icon — true exactly while
    /// <see cref="IsCopied"/> (web <c>icon={copied ? &lt;Check /&gt; : &lt;Link2 /&gt;}</c>).
    /// </summary>
    public bool ShowCheckIcon => _isCopied;

    /// <summary>The copy-succeeded toast message (web <c>common.copyLink.success</c> → "Link copied to clipboard").</summary>
    public string SuccessMessage =>
        _localizer.GetString(CopyLinkButtonRegistration.SuccessKey, CopyLinkButtonRegistration.SuccessFallback);

    /// <summary>The copy-failed toast message (web <c>common.copyLink.error</c> → "Could not copy link").</summary>
    public string ErrorMessage =>
        _localizer.GetString(CopyLinkButtonRegistration.ErrorKey, CopyLinkButtonRegistration.ErrorFallback);

    /// <summary>
    /// Map a copy outcome to the toast it should raise — the pure projection of the web <c>handleClick</c> branch
    /// (success → <c>toast.success</c>; failure → <c>toast.error</c>). Exposed for headless tests of the mapping.
    /// </summary>
    /// <param name="outcome">The copy outcome.</param>
    public CopyLinkToastIntent ToastIntentFor(CopyLinkOutcome outcome) => outcome switch
    {
        CopyLinkOutcome.Copied => new CopyLinkToastIntent(CopyLinkToastSeverity.Success, SuccessMessage),
        _ => new CopyLinkToastIntent(CopyLinkToastSeverity.Error, ErrorMessage),
    };

    /// <summary>Fire the copy action (web <c>handleClick</c>) as a detached task — the view's click handler.</summary>
    public void Copy() => _ = CopyAsync();

    /// <summary>
    /// Read the current link, copy it to the clipboard and announce the outcome on the shared toast queue — the
    /// awaitable core of <see cref="Copy"/> (exposed for headless tests). Mirrors the web <c>handleClick</c>: take
    /// <c>window.location.href</c>, await the clipboard write, then on success enter the confirmation state and
    /// raise the success toast (web <c>setCopied(true)</c> + <c>toast.success</c>) or on failure raise the error
    /// toast and stay idle (web <c>catch</c> → <c>toast.error</c>). The two-second revert is the view's concern.
    /// </summary>
    /// <returns>The copy outcome.</returns>
    public async Task<CopyLinkOutcome> CopyAsync()
    {
        var link = _link.GetCurrentLink() ?? string.Empty;
        bool ok = await _clipboard.WriteTextAsync(link).ConfigureAwait(false);
        CopyLinkOutcome outcome = ok ? CopyLinkOutcome.Copied : CopyLinkOutcome.Failed;

        if (ok)
        {
            // web: setCopied(true) — enter the confirmation state before announcing success.
            IsCopied = true;
        }

        CopyLinkToastIntent intent = ToastIntentFor(outcome);
        RaiseToast(intent);
        return outcome;
    }

    /// <summary>
    /// Revert the confirmation state back to idle (web <c>setCopied(false)</c>), called by the view's one-shot
    /// timer after <see cref="CopyLinkButtonRegistration.RevertDelay"/>.
    /// </summary>
    public void ResetCopied() => IsCopied = false;

    private void RaiseToast(CopyLinkToastIntent intent)
    {
        switch (intent.Severity)
        {
            case CopyLinkToastSeverity.Success:
                _toast.Success(intent.Message);
                break;

            case CopyLinkToastSeverity.Error:
            default:
                _toast.Error(intent.Message);
                break;
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
