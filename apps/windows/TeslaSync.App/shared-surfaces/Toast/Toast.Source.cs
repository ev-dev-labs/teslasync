using System.Globalization;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The toast queue seam the <c>Toast</c> surface binds through (P1/S8) — the native analogue of the web
/// <c>ToastContextValue</c> the <c>useToast()</c> hook returns (web/src/components/feedback/Toast.tsx L74-81).
/// It exposes the current ordered queue (<see cref="Snapshot"/>, the web <c>toasts</c> state), raises
/// <see cref="Changed"/> whenever the queue mutates (the web <c>setToasts(...)</c> re-render), and offers the
/// <see cref="Show"/> and <see cref="Dismiss"/> verbs. The web context's <c>success</c>/<c>error</c>/<c>info</c>/
/// <c>warning</c> tone shorthands are provided as call-site-identical extension methods on
/// <see cref="ToastControllerExtensions"/> (kept off the interface so the reserved <c>Error</c> member name does
/// not bind to a virtual/interface slot). The view never owns toast state — it observes this seam. The production
/// binding is <see cref="ToastController"/>; <see cref="ToastAccess"/> reproduces the web <c>useToast</c>
/// (throwing) and <c>useOptionalToast</c> (nullable) accessors over it.
/// </summary>
public interface IToastController
{
    /// <summary>The current queue, oldest first (web <c>toasts</c>); a stable snapshot safe to enumerate.</summary>
    IReadOnlyList<ToastItem> Snapshot { get; }

    /// <summary>Raised whenever the queue changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Enqueue a toast (web <c>toast(opts)</c>): assigns an id, resolves the duration (a null duration becomes the
    /// 4000 ms default), appends it, and drops the oldest beyond <see cref="ToastRegistration.MaxVisible"/>.
    /// </summary>
    /// <param name="request">The toast inputs.</param>
    /// <returns>The assigned queue id (web <c>`toast-${++toastCounter}`</c>).</returns>
    string Show(ToastRequest request);

    /// <summary>Dismiss the toast with the given id (web <c>dismiss(id)</c>); a no-op when it is already gone.</summary>
    /// <param name="id">The queue id to remove.</param>
    void Dismiss(string id);
}

/// <summary>
/// The production <see cref="IToastController"/> — the native analogue of the web <c>ToastProvider</c> state
/// (web/src/components/feedback/Toast.tsx L130-154). It holds the queue, assigns ids
/// (<c>`toast-${++toastCounter}`</c>), enforces the five-toast cap by dropping the oldest
/// (the web <c>[...prev.slice(-4), next]</c>), and raises <see cref="Changed"/> after every mutation so the bound
/// view re-renders. The one-shot auto-dismiss timing is a view concern (each <see cref="ToastItem.Duration"/>
/// arms a one-shot timer in the WinUI host, the native analogue of the web <c>setTimeout(() =&gt; dismiss(id),
/// duration)</c>), keeping this controller free of UI-thread/timer concerns and unit-testable headlessly.
/// Thread-safe: queue mutations are serialized and <see cref="Changed"/> / diagnostics fire outside the lock.
/// </summary>
public sealed class ToastController : IToastController
{
    private readonly object _gate = new();
    private readonly List<ToastItem> _items = [];
    private readonly ToastDiagnostics _diagnostics;
    private int _counter;

    /// <summary>Creates a controller over an optional PII-safe diagnostics collector.</summary>
    /// <param name="diagnostics">The diagnostics collector for shown/dismissed counters, or null.</param>
    public ToastController(ToastDiagnostics? diagnostics = null) =>
        _diagnostics = diagnostics ?? new ToastDiagnostics();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<ToastItem> Snapshot
    {
        get
        {
            lock (_gate)
            {
                return _items.ToArray();
            }
        }
    }

    /// <inheritdoc />
    public string Show(ToastRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var id = ToastRegistration.IdPrefix + NextSequence().ToString(CultureInfo.InvariantCulture);
        var duration = request.Duration ?? TimeSpan.FromMilliseconds(ToastRegistration.DefaultDurationMs);

        var item = new ToastItem
        {
            Id = id,
            Variant = request.Variant,
            Title = request.Title,
            Message = request.Message,
            Duration = duration,
            Action = request.Action,
        };

        lock (_gate)
        {
            _items.Add(item);

            // web: [...prev.slice(-4), next] — keep the newest MaxVisible, dropping the oldest from the front.
            while (_items.Count > ToastRegistration.MaxVisible)
            {
                _items.RemoveAt(0);
            }
        }

        _diagnostics.RecordToastShown(item.Variant);
        RaiseChanged();
        return id;
    }

    /// <inheritdoc />
    public void Dismiss(string id)
    {
        ArgumentNullException.ThrowIfNull(id);

        bool removed;
        lock (_gate)
        {
            // web: setToasts(prev => prev.filter(t => t.id !== id)).
            removed = _items.RemoveAll(t => string.Equals(t.Id, id, StringComparison.Ordinal)) > 0;
        }

        if (removed)
        {
            _diagnostics.RecordToastDismissed();
            RaiseChanged();
        }
    }

    private int NextSequence() => Interlocked.Increment(ref _counter);

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// The web <c>useToast()</c> tone shorthands as extension methods over <see cref="IToastController"/> — the native
/// analogue of the context object's <c>success</c>/<c>error</c>/<c>info</c>/<c>warning</c> helpers
/// (web/src/components/feedback/Toast.tsx L149-152). Each forwards to <see cref="IToastController.Show"/> with the
/// matching tone (the web <c>error</c> verb is the assertive <see cref="CalloutVariant.Danger"/>), so call-sites
/// read identically to the web (e.g. <c>controller.Error(title, detail)</c>) while the interface itself stays free
/// of the reserved <c>Error</c> virtual/interface member name.
/// </summary>
public static class ToastControllerExtensions
{
    /// <summary>Enqueue a success toast (web <c>success(title, message?)</c>).</summary>
    /// <param name="controller">The toast queue.</param>
    /// <param name="title">The bold primary line.</param>
    /// <param name="message">The optional secondary line.</param>
    public static void Success(this IToastController controller, string title, string? message = null) =>
        ShowTone(controller, CalloutVariant.Success, title, message);

    /// <summary>Enqueue an error toast (web <c>error(title, message?)</c>) — the assertive Danger tone.</summary>
    /// <param name="controller">The toast queue.</param>
    /// <param name="title">The bold primary line.</param>
    /// <param name="message">The optional secondary line.</param>
    public static void Error(this IToastController controller, string title, string? message = null) =>
        ShowTone(controller, CalloutVariant.Danger, title, message);

    /// <summary>Enqueue an info toast (web <c>info(title, message?)</c>).</summary>
    /// <param name="controller">The toast queue.</param>
    /// <param name="title">The bold primary line.</param>
    /// <param name="message">The optional secondary line.</param>
    public static void Info(this IToastController controller, string title, string? message = null) =>
        ShowTone(controller, CalloutVariant.Info, title, message);

    /// <summary>Enqueue a warning toast (web <c>warning(title, message?)</c>).</summary>
    /// <param name="controller">The toast queue.</param>
    /// <param name="title">The bold primary line.</param>
    /// <param name="message">The optional secondary line.</param>
    public static void Warning(this IToastController controller, string title, string? message = null) =>
        ShowTone(controller, CalloutVariant.Warning, title, message);

    private static void ShowTone(IToastController controller, CalloutVariant variant, string title, string? message)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(title);
        _ = controller.Show(new ToastRequest { Variant = variant, Title = title, Message = message });
    }
}

/// <summary>
/// The native analogue of the web <c>useToast</c> / <c>useOptionalToast</c> accessors
/// (web/src/components/feedback/Toast.tsx L85-100). In React those hooks read the <c>ToastContext</c>;
/// <c>useToast</c> throws when no <c>&lt;ToastProvider&gt;</c> is mounted, while <c>useOptionalToast</c> returns
/// <c>null</c> so isolated primitives degrade gracefully. Here the composition root supplies an
/// <see cref="IToastController"/> (or null when no overlay is hosted), and these helpers reproduce the same two
/// resolution semantics, including the web throw message verbatim.
/// </summary>
public static class ToastAccess
{
    /// <summary>The web <c>useToast</c> throw message, verbatim (Toast.tsx L87).</summary>
    public const string MissingProviderMessage = "useToast must be used within ToastProvider";

    /// <summary>
    /// The web <c>useToast()</c>: returns the controller, or throws when none is mounted. Use from call-sites that
    /// require a toast overlay to be present.
    /// </summary>
    /// <param name="controller">The composed controller, or null when no overlay is hosted.</param>
    /// <returns>The non-null controller.</returns>
    /// <exception cref="InvalidOperationException">No controller is available (web "must be used within ToastProvider").</exception>
    public static IToastController Require(IToastController? controller) =>
        controller ?? throw new InvalidOperationException(MissingProviderMessage);

    /// <summary>
    /// The web <c>useOptionalToast()</c>: returns the controller when one is mounted, or null otherwise, so
    /// primitives can surface a toast when available but never crash in isolation.
    /// </summary>
    /// <param name="controller">The composed controller, or null when no overlay is hosted.</param>
    /// <returns>The controller, or null.</returns>
    public static IToastController? Optional(IToastController? controller) => controller;
}

/// <summary>
/// The native analogue of the web <c>useMutationToast()</c> bridge (web/src/api/hooks/_toastHelpers.ts): an
/// i18n-aware wrapper over an <see cref="IToastController"/> that turns mutation outcomes into toasts. It mirrors
/// the web contract exactly — <see cref="Success"/> takes an i18n key + English fallback and shows a success
/// toast titled with the localized string; <see cref="Error"/> takes the raw error (any shape), an i18n key
/// (defaulting to <see cref="ToastRegistration.MutationErrorKey"/>) and a fallback (defaulting to
/// <see cref="ToastRegistration.MutationErrorFallback"/>), and shows an error toast whose secondary line is the
/// error's message so the user sees both the translated title and the underlying detail. UI-free and testable.
/// </summary>
public sealed class ToastMutationReporter
{
    private readonly IToastController _controller;
    private readonly ILocalizer _localizer;

    /// <summary>Creates the reporter over the toast controller and the i18n facade.</summary>
    /// <param name="controller">The toast queue seam (web <c>useToast()</c>).</param>
    /// <param name="localizer">The i18n facade titles resolve through (web <c>useTranslation()</c>).</param>
    public ToastMutationReporter(IToastController controller, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _controller = controller;
        _localizer = localizer;
    }

    /// <summary>
    /// Show a success toast (web <c>success(key, fallback)</c> → <c>toast.success(t(key, …))</c>): resolves the
    /// i18n key (falling back to the English default) and enqueues it as the title.
    /// </summary>
    /// <param name="key">The i18n key for the success title.</param>
    /// <param name="fallback">The English fallback when the key is unresolved.</param>
    public void Success(string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(fallback);
        _controller.Success(_localizer.GetString(key, fallback));
    }

    /// <summary>
    /// Show an error toast (web <c>error(err, key?, fallback?)</c> → <c>toast.error(t(key, …), detail)</c>):
    /// resolves the localized title and shows the error's detail as the secondary line.
    /// </summary>
    /// <param name="error">The raw error (Exception, string, or any object); null shows no detail line.</param>
    /// <param name="key">The i18n key for the title; defaults to <see cref="ToastRegistration.MutationErrorKey"/>.</param>
    /// <param name="fallback">The English fallback; defaults to <see cref="ToastRegistration.MutationErrorFallback"/>.</param>
    public void Error(object? error, string? key = null, string? fallback = null)
    {
        var title = _localizer.GetString(
            key ?? ToastRegistration.MutationErrorKey,
            fallback ?? ToastRegistration.MutationErrorFallback);

        _controller.Error(title, DescribeError(error));
    }

    /// <summary>
    /// Reduce an arbitrary error to its detail line, reproducing the web
    /// <c>err instanceof Error ? err.message : err == null ? undefined : String(err)</c>.
    /// </summary>
    /// <param name="error">The raw error.</param>
    /// <returns>The detail string, or null when there is nothing to show.</returns>
    public static string? DescribeError(object? error) => error switch
    {
        null => null,
        Exception exception => exception.Message,
        _ => error.ToString(),
    };
}
