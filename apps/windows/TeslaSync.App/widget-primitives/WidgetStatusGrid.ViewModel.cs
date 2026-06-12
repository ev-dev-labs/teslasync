using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="WidgetStatusGrid"/> view — the native port
/// of the web <c>WidgetStatusGrid</c> component body
/// (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx). It observes the bound
/// <see cref="IWidgetStatusGridSource"/> (the P1/S8 seam carrying the grid inputs), projects each change
/// through <see cref="WidgetStatusGridProjection"/> into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency so it
/// is verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class WidgetStatusGridViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs StateChangedArgs = new(nameof(State));
    private static readonly PropertyChangedEventArgs IsEmptyChangedArgs = new(nameof(IsEmpty));

    private readonly IWidgetStatusGridSource _source;
    private readonly ILocalizer _localizer;
    private WidgetStatusGridDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    public WidgetStatusGridViewModel(IWidgetStatusGridSource source, ILocalizer localizer)
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

    /// <summary>The diagnostics slug this surface registers under (<c>WidgetStatusGrid</c>).</summary>
    public static string Slug => WidgetStatusGridRegistration.Slug;

    /// <summary>The render-ready projection of the current input.</summary>
    public WidgetStatusGridDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, StateChangedArgs);
            PropertyChanged?.Invoke(this, IsEmptyChangedArgs);
        }
    }

    /// <summary>Which render branch is showing (empty / populated).</summary>
    public WidgetStatusGridState State => _display.State;

    /// <summary>True while the empty surface is showing.</summary>
    public bool IsEmpty => _display.State == WidgetStatusGridState.Empty;

    /// <summary>The number of projected cells.</summary>
    public int Count => _display.Count;

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

    private WidgetStatusGridDisplay Project() => WidgetStatusGridProjection.Project(_source.Input, _localizer);
}
