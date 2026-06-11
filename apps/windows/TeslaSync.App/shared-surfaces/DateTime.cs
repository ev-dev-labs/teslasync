using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.DateTimeSurface;

/// <summary>
/// The native WinUI 3 DateTime surface — a parity port of
/// web/src/components/data-display/format/DateTime.tsx in its cross-feature role as the application's
/// canonical locale-aware timestamp renderer (the web component mounted at hundreds of call sites:
/// table cells, drive/charge headers, activity feeds). It renders the formatted value as inline text
/// with the canonical ISO instant on hover (the web <c>&lt;span title=…&gt;</c>) and, when
/// <see cref="ShowTz"/> is set, a muted short zone designator after it (the web trailing
/// <c>&lt;span class="ml-1 text-xs"&gt;</c>). All formatting flows through the pure
/// <see cref="DateTimeSurfaceFormatting"/> via the <see cref="DateTimeViewModel"/>; the view performs no
/// I/O. With no zone prop it stays on the web PURE path (system zone + en-US); when <see cref="Mode"/>
/// (the web <c>in</c> prop) or <see cref="ShowTz"/> is set it binds the zone + locale from the supplied
/// <see cref="IDateTimeContext"/> (web <c>useTimezone()</c> + <c>useSettings()</c>) and re-renders when
/// that context changes. Because the web source is a synchronous formatter with no async read, the
/// surface has no loading / error / stale / offline chrome — only the empty (no value → em-dash) and
/// rendered branches, the honest union the web source actually shows. The rendered text is exposed as
/// the Narrator name, and the surface emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class DateTime : ContentControl, IDisposable
{
    private readonly DateTimeViewModel _viewModel;
    private readonly DateTimeDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TextBlock _text = new();
    private readonly Run _valueRun = new();
    private readonly Run _abbreviationRun = new();
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface on the PURE path (system zone + en-US) — the web no-prop default.</summary>
    public DateTime()
        : this(context: null, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the surface over an explicit zone/locale context seam (P1/S8) and an optional PII-safe
    /// diagnostics collector. Pass a populated <see cref="IDateTimeContext"/> for the zone-aware path; pass
    /// <see langword="null"/> to render in the system zone + en-US (the web PURE path).
    /// </summary>
    public DateTime(IDateTimeContext? context, DateTimeDiagnostics? diagnostics = null)
    {
        _viewModel = new DateTimeViewModel(context);
        _diagnostics = diagnostics ?? new DateTimeDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _valueRun.Foreground = DisplayTokens.TextPrimary;

        // The trailing zone designator mirrors the web `ml-1 text-xs text-[var(--text-muted)]` decoration:
        // a smaller, muted run after the value.
        _abbreviationRun.Foreground = DisplayTokens.TextMuted;
        _abbreviationRun.FontSize = 11;

        _text.Inlines.Add(_valueRun);
        _text.Inlines.Add(_abbreviationRun);
        Content = _text;

        IsTabStop = false;
        VerticalContentAlignment = VerticalAlignment.Center;

        SyncFromViewModel();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>DateTime</c>).</summary>
    public static string Slug => DateTimeRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DateTimeViewModel ViewModel => _viewModel;

    /// <summary>The timestamp to render (web <c>value</c>); <see langword="null"/> shows the em-dash sentinel.</summary>
    public DateTimeOffset? Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The render variant (web <c>variant</c>, default <see cref="DateTimeVariant.Full"/>).</summary>
    public DateTimeVariant Variant
    {
        get => _viewModel.Variant;
        set => _viewModel.Variant = value;
    }

    /// <summary>The explicit zone mode (web <c>in</c> prop); selects the zone-aware path when set.</summary>
    public DateTimeTzMode? Mode
    {
        get => _viewModel.Mode;
        set => _viewModel.Mode = value;
    }

    /// <summary>Whether to append the short zone designator (web <c>showTz</c>).</summary>
    public bool ShowTz
    {
        get => _viewModel.ShowTz;
        set => _viewModel.ShowTz = value;
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
        _valueRun.Text = _viewModel.Display;
        _abbreviationRun.Text = _viewModel.HasAbbreviation ? $" {_viewModel.Abbreviation}" : string.Empty;

        // The web span carries the canonical ISO instant as its title (hover); null means no tooltip.
        ToolTipService.SetToolTip(this, _viewModel.Title);
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
