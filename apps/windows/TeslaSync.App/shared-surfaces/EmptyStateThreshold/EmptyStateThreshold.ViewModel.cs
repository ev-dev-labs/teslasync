using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="EmptyStateThreshold"/> view — the native port of
/// the web component body (web/src/components/feedback/EmptyStateThreshold.tsx). It observes the bound
/// <see cref="IEmptyStateThresholdSource"/> (the P1/S8 props seam), projects each change through
/// <see cref="EmptyStateThresholdProjection"/> into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency, so it is
/// verified headlessly; the WinUI view marshals its notifications onto the dispatcher. <see cref="Dispose"/>
/// unsubscribes from the source (the web effect cleanup).
/// </summary>
public sealed class EmptyStateThresholdViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IEmptyStateThresholdSource _source;
    private EmptyStateThresholdDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and props seam (P1/S8), projecting the initial frame.</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The props state-holder seam (web component props).</param>
    public EmptyStateThresholdViewModel(ILocalizer localizer, IEmptyStateThresholdSource source)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>EmptyStateThreshold</c>).</summary>
    public static string Slug => EmptyStateThresholdRegistration.Slug;

    /// <summary>The render-ready projection of the current inputs.</summary>
    public EmptyStateThresholdDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
        }
    }

    /// <summary>The section title (web <c>sectionLabel</c>).</summary>
    public string Title => _display.Title;

    /// <summary>The resolved message (custom override or default count phrasing).</summary>
    public string Message => _display.Message;

    /// <summary>The optional description; empty when none.</summary>
    public string Description => _display.Description;

    /// <summary>Whether the description paragraph should be drawn.</summary>
    public bool HasDescription => _display.HasDescription;

    /// <summary>Whether the call-to-action region should be drawn.</summary>
    public bool HasAction => _display.HasAction;

    /// <summary>The composed status text the live region announces.</summary>
    public string AccessibleName => _display.AccessibleName;

    /// <summary>Detach from the props seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        var next = Project();
        if (next != _display)
        {
            Display = next;
        }
    }

    private EmptyStateThresholdDisplay Project() =>
        EmptyStateThresholdProjection.Project(_source.Current, _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
}
