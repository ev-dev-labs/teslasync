using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Modal"/> view — the native port of the web
/// <c>Modal</c> component (web/src/components/ui/Modal.tsx). It owns the four presentational inputs that map to
/// the web props (<c>open</c> → <see cref="IsOpen"/>, <c>title</c> → <see cref="Title"/>, <c>size</c> →
/// <see cref="Size"/>, <c>ariaLabel</c> → <see cref="AriaLabel"/>), derives the header gate / accessible name /
/// close label from them, and drives the dismiss callback (web <c>onClose</c> → <see cref="CloseRequested"/>).
/// The web component is a pure presentational container with no read query, so the surface never shows a
/// loading / empty / error / stale / offline state; its states are open-with-title, open-without-title (the
/// <c>ariaLabel</c> branch), the four size presets and the closed branch. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class ModalViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly ModalDiagnostics _diagnostics;

    private bool _isOpen;
    private string? _title;
    private ModalSize _size = ModalSize.Md;
    private string? _ariaLabel;

    /// <summary>Creates the holder over the i18n facade and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade the close label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public ModalViewModel(ILocalizer localizer, ModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ModalDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the modal should close (web <c>onClose()</c> — Esc, backdrop click or close button).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Whether the modal is open (web <c>open</c>). When false the surface renders nothing.</summary>
    public bool IsOpen
    {
        get => _isOpen;
        set => Set(ref _isOpen, value);
    }

    /// <summary>The optional dialog title (web <c>title</c>). Editing it re-evaluates the header / accessible name.</summary>
    public string? Title
    {
        get => _title;
        set
        {
            if (Set(ref _title, value))
            {
                Raise(nameof(HasTitle));
                Raise(nameof(AccessibleName));
            }
        }
    }

    /// <summary>The width preset (web <c>size</c>; default <see cref="ModalSize.Md"/>).</summary>
    public ModalSize Size
    {
        get => _size;
        set => Set(ref _size, value);
    }

    /// <summary>
    /// The accessible label used when no <see cref="Title"/> is rendered (web <c>ariaLabel</c>). Editing it
    /// re-evaluates the accessible name.
    /// </summary>
    public string? AriaLabel
    {
        get => _ariaLabel;
        set
        {
            if (Set(ref _ariaLabel, value))
            {
                Raise(nameof(AccessibleName));
            }
        }
    }

    /// <summary>True when a header (title + close button) renders (web <c>title &amp;&amp; (…)</c>).</summary>
    public bool HasTitle => ModalProjection.ShouldRenderHeader(_title);

    /// <summary>
    /// The dialog's accessible name — the title when present, else the <see cref="AriaLabel"/>, else empty
    /// (web <c>aria-labelledby</c> / <c>aria-label</c>).
    /// </summary>
    public string AccessibleName => ModalProjection.ResolveAccessibleName(_title, _ariaLabel);

    /// <summary>The localized close-button accessible name (web <c>aria-label="Close"</c>).</summary>
    public string CloseLabel => ModalRegistration.CloseLabel(_localizer);

    /// <summary>Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event.</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Request that the modal close (web <c>onClose()</c>): raises <see cref="CloseRequested"/>.</summary>
    public void RequestClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
