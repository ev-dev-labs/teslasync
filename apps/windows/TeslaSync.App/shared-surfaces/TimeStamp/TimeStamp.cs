using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;

namespace TeslaSync.App.SharedSurfaces.TimeStampSurface;

/// <summary>
/// The native WinUI 3 TimeStamp surface — a parity port of web/src/components/data-display/TimeStamp.tsx
/// in its cross-feature role as the application's hover-to-flip timestamp renderer (the web component
/// mounted at table cells, activity feeds, drive/charge rows). It renders the primary format as inline
/// text (web <c>&lt;span&gt;{primary}&lt;/span&gt;</c>) and attaches the alternate format as the hover
/// tooltip (web <c>&lt;Tooltip content={secondary}&gt;</c>), so a relative body ("2h ago") reveals its
/// absolute instant ("Apr 4, 2026, 02:30 AM") on hover and vice-versa. The body tier is the user's
/// <c>time_format_default</c> preference unless a call site overrides it via <see cref="Format"/>; the
/// zone + locale follow <see cref="Mode"/> (the web <c>in</c> prop) resolved against the bound
/// <see cref="ITimeStampContext"/> (web <c>useTimeFormatPreference()</c> + <c>useDateFormat()</c>). All
/// projection flows through the pure <see cref="TimeStampFormatting"/> via the
/// <see cref="TimeStampViewModel"/>; the view performs no I/O. Because the web source is a synchronous
/// formatter with no async read, the surface has no loading / error / stale / offline chrome — only the
/// empty (no value → em-dash, no tooltip) and rendered branches, the honest union the web source actually
/// shows. The visible text is exposed as the Narrator name, and the surface emits the <c>view.opened</c>
/// diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class TimeStamp : ContentControl, IDisposable
{
    private readonly TimeStampViewModel _viewModel;
    private readonly TimeStampDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TextBlock _text = new();
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over the system default context (system zone + en-US + relative preference).</summary>
    public TimeStamp()
        : this(context: null, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the surface over an explicit context seam (P1/S8) and an optional PII-safe diagnostics
    /// collector. Pass a populated <see cref="ITimeStampContext"/> to bind the live locale / zones / tz
    /// mode / format preference; pass <see langword="null"/> for the system defaults.
    /// </summary>
    public TimeStamp(ITimeStampContext? context, TimeStampDiagnostics? diagnostics = null)
    {
        _viewModel = new TimeStampViewModel(context);
        _diagnostics = diagnostics ?? new TimeStampDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _text.Foreground = DisplayTokens.TextPrimary;

        Content = _text;
        IsTabStop = false;
        VerticalContentAlignment = VerticalAlignment.Center;

        SyncFromViewModel();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>TimeStamp</c>).</summary>
    public static string Slug => TimeStampRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TimeStampViewModel ViewModel => _viewModel;

    /// <summary>The timestamp to render (web <c>value</c>); <see langword="null"/> shows the em-dash sentinel with no tooltip.</summary>
    public DateTimeOffset? Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The visible format selector (web <c>format</c>, default <see cref="TimeStampFormat.Auto"/>).</summary>
    public TimeStampFormat Format
    {
        get => _viewModel.Format;
        set => _viewModel.Format = value;
    }

    /// <summary>The explicit zone mode (web <c>in</c> prop); <see langword="null"/> defers to the context default.</summary>
    public TimeStampTzMode? Mode
    {
        get => _viewModel.Mode;
        set => _viewModel.Mode = value;
    }

    /// <summary>Re-sample the clock and recompute the rendered value (the analogue of a web re-render).</summary>
    public void Refresh() => _viewModel.Refresh();

    /// <summary>Detach from the view-model and context seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(SyncFromViewModel);

    private void SyncFromViewModel()
    {
        _text.Text = _viewModel.Display;

        // web <Tooltip content={secondary}>: the alternate format on hover; null means a bare span (no tooltip).
        ToolTipService.SetToolTip(this, _viewModel.HasTooltip ? _viewModel.Tooltip : null);
        AutomationProperties.SetName(this, _viewModel.AccessibleName);
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }
}
