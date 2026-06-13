using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="GotoIndicator"/> view — the native port of the web
/// component (web/src/components/feedback/GotoIndicator.tsx). The web component resolves a single localized label
/// through <c>useTranslation</c> and renders a bottom-centre chord hint when its <c>visible</c> prop is set,
/// returning <c>null</c> otherwise. This holder reproduces that exactly: it resolves the <see cref="Label"/> once
/// through the <see cref="ILocalizer"/> facade (P1/S10) plus the composed <see cref="AccessibleName"/> (the label
/// followed by the registration's two physical key-cap glyphs <c>g</c> and <c>?</c>, which are never localized),
/// and drives a settable <see cref="IsVisible"/> flag (the web <c>visible</c> prop)
/// that projects to the pure <see cref="Visibility"/> state and raises <see cref="PropertyChanged"/> so the view
/// shows or collapses the overlay. Because the surface reads no data there is no loading / error / stale /
/// offline branch to model — the only states are <see cref="GotoIndicatorVisibility.Hidden"/> and
/// <see cref="GotoIndicatorVisibility.Shown"/>. Arming / disarming and the one-time open are recorded through the
/// PII-safe <see cref="GotoIndicatorDiagnostics"/>. The view performs no i18n or visibility decision of its own —
/// it binds to this holder. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class GotoIndicatorViewModel : INotifyPropertyChanged
{
    private readonly GotoIndicatorDiagnostics _diagnostics;
    private readonly string _label;
    private readonly string _accessibleName;
    private bool _isVisible;
    private bool _opened;

    /// <summary>Creates the holder over the i18n facade, an initial visibility, and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade the label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="visible">The initial armed state (web <c>visible</c> prop); defaults to hidden.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public GotoIndicatorViewModel(
        ILocalizer localizer,
        bool visible = false,
        GotoIndicatorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new GotoIndicatorDiagnostics();
        _label = GotoIndicatorRegistration.ResolveLabel(localizer);
        _accessibleName = GotoIndicatorRegistration.ComposeAccessibleName(_label);
        _isVisible = visible;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>GotoIndicator</c>).</summary>
    public static string Slug => GotoIndicatorRegistration.Slug;

    /// <summary>The localized lead-in label (web <c>t('shortcuts.goto', 'Go to...')</c>).</summary>
    public string Label => _label;

    /// <summary>The composed accessible name Narrator reads when the hint is armed (label + key-caps).</summary>
    public string AccessibleName => _accessibleName;

    /// <summary>
    /// Whether the chord leader is armed (web <c>visible</c> prop). Setting it to a new value records the
    /// arm / disarm transition and raises <see cref="PropertyChanged"/> for both this property and
    /// <see cref="Visibility"/> so the view shows or collapses the overlay; setting it to the current value is a
    /// no-op (no transition is recorded).
    /// </summary>
    public bool IsVisible
    {
        get => _isVisible;
        set
        {
            if (_isVisible == value)
            {
                return;
            }

            _isVisible = value;

            if (value)
            {
                _diagnostics.RecordShown();
            }
            else
            {
                _diagnostics.RecordHidden();
            }

            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsVisible)));
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Visibility)));
        }
    }

    /// <summary>The pure render state derived from <see cref="IsVisible"/> (web <c>if (!visible) return null</c>).</summary>
    public GotoIndicatorVisibility Visibility => GotoIndicatorVisibilityPolicy.Decide(_isVisible);

    /// <summary>Arm the hint so the overlay is shown (web parent setting <c>visible=true</c>).</summary>
    public void Show() => IsVisible = true;

    /// <summary>Disarm the hint so the overlay is collapsed (web parent setting <c>visible=false</c>).</summary>
    public void Hide() => IsVisible = false;

    /// <summary>
    /// Record the surface opening exactly once (web component mount), emitting the <c>view.opened</c> diagnostic.
    /// Idempotent — a second call is a no-op — so repeated <c>Loaded</c> events never double-count.
    /// </summary>
    public void MarkOpened()
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }
}
