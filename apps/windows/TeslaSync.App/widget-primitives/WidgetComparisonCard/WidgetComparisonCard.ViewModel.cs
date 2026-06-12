using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="WidgetComparisonCard"/> view — the native port of
/// the web <c>WidgetComparisonCard</c> component body
/// (web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx L46-L65). It observes the bound
/// <see cref="IWidgetComparisonCardSource"/> (the P1/S8 seam carrying the metric list + compact flag), projects
/// each change through <see cref="WidgetComparisonCardProjection"/> into a render-ready <see cref="Display"/>, and
/// raises <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency so
/// it is verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class WidgetComparisonCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWidgetComparisonCardSource _source;
    private readonly ILocalizer _localizer;
    private WidgetComparisonCardDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    /// <param name="localizer">The i18n facade used for the empty-line text; never null.</param>
    public WidgetComparisonCardViewModel(IWidgetComparisonCardSource source, ILocalizer localizer)
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

    /// <summary>The diagnostics slug this surface registers under (<c>WidgetComparisonCard</c>).</summary>
    public static string Slug => WidgetComparisonCardRegistration.Slug;

    /// <summary>The render-ready projection of the current input.</summary>
    public WidgetComparisonCardDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, IsEmptyChangedArgs);
        }
    }

    /// <summary>True while the empty branch (the muted "No comparison data" line) is showing.</summary>
    public bool IsEmpty => _display.IsEmpty;

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

    private WidgetComparisonCardDisplay Project() =>
        WidgetComparisonCardProjection.Project(_source.Input, _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs IsEmptyChangedArgs = new(nameof(IsEmpty));
}
