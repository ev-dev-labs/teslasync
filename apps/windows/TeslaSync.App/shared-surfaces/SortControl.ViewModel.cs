using System.ComponentModel;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="SortControl"/> view — the native port of the
/// web <c>SortControl</c> component body (web/src/components/forms/SortControl.tsx). It observes the bound
/// <see cref="ISortControlSource"/> (the P1/S8 seam carrying the field, direction, options and optional toggle
/// label), projects each change through <see cref="SortControlProjection"/> into a render-ready
/// <see cref="Display"/>, and raises <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries
/// no view-framework dependency so it is verified headlessly; the WinUI view marshals its notifications onto
/// the dispatcher.
/// </summary>
public sealed class SortControlViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISortControlSource _source;
    private readonly ILocalizer _localizer;
    private SortControlDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    public SortControlViewModel(ISortControlSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The diagnostics slug this surface registers under (<c>SortControl</c>).</summary>
    public static string Slug => SortControlRegistration.Slug;

    /// <summary>The render-ready projection of the current field / direction / options.</summary>
    public SortControlDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, DirectionChangedArgs);
            PropertyChanged?.Invoke(this, IsAscendingChangedArgs);
        }
    }

    /// <summary>The current normalized direction (ascending or descending).</summary>
    public SortDirection Direction => _display.Direction;

    /// <summary>True while the direction is ascending.</summary>
    public bool IsAscending => _display.IsAscending;

    /// <summary>Detach from the data seam (idempotent).</summary>
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

    private void OnSourceChanged(object? sender, EventArgs e) => Display = Project();

    private SortControlDisplay Project() => SortControlProjection.Project(
        _source.Options,
        _source.Field,
        _source.Direction,
        _source.DirectionAccessibleLabel,
        _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs DirectionChangedArgs = new(nameof(Direction));
    private static readonly PropertyChangedEventArgs IsAscendingChangedArgs = new(nameof(IsAscending));
}
