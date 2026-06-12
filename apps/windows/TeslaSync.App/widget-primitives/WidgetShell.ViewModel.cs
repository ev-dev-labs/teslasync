using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="WidgetShell"/> view — the native port of the web
/// component body (web/src/features/dashboard/widgets/WidgetShell.tsx). It observes the bound
/// <see cref="IWidgetShellSource"/> (the P1/S8 props seam), projects each change through
/// <see cref="WidgetShellProjection"/> into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency, so it is
/// verified headlessly; the WinUI view marshals its notifications onto the dispatcher and reads <see cref="Localizer"/>
/// to compose the child freshness / pin / help surfaces. <see cref="Dispose"/> unsubscribes from the source (the web
/// effect cleanup).
/// </summary>
public sealed class WidgetShellViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));

    private readonly ILocalizer _localizer;
    private readonly IWidgetShellSource _source;
    private WidgetShellDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and props seam (P1/S8), projecting the initial frame.</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The props state-holder seam (web component props).</param>
    public WidgetShellViewModel(ILocalizer localizer, IWidgetShellSource source)
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

    /// <summary>The canonical surface slug (<c>WidgetShell</c>).</summary>
    public static string Slug => WidgetShellRegistration.Slug;

    /// <summary>The i18n facade the view composes the child freshness / pin / help surfaces through.</summary>
    public ILocalizer Localizer => _localizer;

    /// <summary>The render-ready projection of the current inputs.</summary>
    public WidgetShellDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
        }
    }

    /// <summary>Whether the loading skeleton is shown (web <c>loading</c>).</summary>
    public bool ShowSkeleton => _display.ShowSkeleton;

    /// <summary>Whether the query-error branch is shown (web <c>error</c>).</summary>
    public bool ShowError => _display.ShowError;

    /// <summary>Whether the title row is rendered (web <c>title ?</c>).</summary>
    public bool HasTitle => _display.HasTitle;

    /// <summary>Whether the help affordance is shown (web <c>help &amp;&amp;</c> inside the title row).</summary>
    public bool ShowHelp => _display.ShowHelp;

    /// <summary>Whether the freshness chip is shown (web <c>showFreshness</c>).</summary>
    public bool ShowFreshness => _display.ShowFreshness;

    /// <summary>Whether the pin toggle is shown (web <c>widgetId &amp;&amp; dashboardId</c>).</summary>
    public bool ShowPin => _display.ShowPin;

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

        WidgetShellDisplay next = Project();
        if (next != _display)
        {
            Display = next;
        }
    }

    private WidgetShellDisplay Project() =>
        WidgetShellProjection.Project(_source.Current, _localizer);
}
