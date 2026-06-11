using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="Delta"/> view — the native port of the web
/// <c>Delta</c> component body (web/src/components/data-display/Delta.tsx). It observes the bound
/// <see cref="IDeltaSource"/> (the P1/S8 seam carrying the indicator inputs + the unit/currency context),
/// projects each change through <see cref="DeltaProjection"/> into a render-ready <see cref="Display"/>, and
/// raises <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency
/// so it is verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class DeltaViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDeltaSource _source;
    private readonly ILocalizer _localizer;
    private DeltaDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    public DeltaViewModel(IDeltaSource source, ILocalizer localizer)
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

    /// <summary>The diagnostics slug this surface registers under (<c>Delta</c>).</summary>
    public static string Slug => DeltaRegistration.Slug;

    /// <summary>The render-ready projection of the current input + unit context.</summary>
    public DeltaDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, StateChangedArgs);
            PropertyChanged?.Invoke(this, IsValueChangedArgs);
        }
    }

    /// <summary>Which render branch is showing (loading / empty / value).</summary>
    public DeltaState State => _display.State;

    /// <summary>True while a resolved comparison is showing (web populated branch).</summary>
    public bool IsValue => _display.State == DeltaState.Value;

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

    private DeltaDisplay Project() => DeltaProjection.Project(_source.Input, _source.Context, _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs StateChangedArgs = new(nameof(State));
    private static readonly PropertyChangedEventArgs IsValueChangedArgs = new(nameof(IsValue));
}
