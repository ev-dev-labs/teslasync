using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 VinDecoder surface — a parity port of
/// web/src/features/admin/components/devtools/tools/VinDecoder.tsx. It wraps the shared
/// <see cref="ToolCard"/> (the native counterpart of the web devtools <c>ToolCard</c>: a token-tinted Car
/// badge, the title and description) around the tool's body: a labelled VIN field (the web
/// <c>&lt;Input label={t('Vin')} /&gt;</c> with the sample VIN <c>5YJ3E1EA1NF000001</c> as its hint, here a shared
/// <see cref="TsInput"/>) above the decoded region. When the VIN reaches the decode threshold the region
/// shows the six segment tiles — manufacturer, model, drive, year, plant and serial — each a token-surfaced
/// cell with a localized label over the decoded value (the web <c>{decoded &amp;&amp; ...}</c> grid); when it
/// does not, the region shows a friendly <see cref="TsEmptyState"/> rather than collapsing to a blank box.
/// All data and the decode flow through the shared <see cref="VinDecoderViewModel"/>; the view never performs
/// HTTP and holds no business logic. Every string resolves through the i18n facade, the field and every cell
/// carry a Narrator name, and each settled decode is announced through a polite live region. The surface adds
/// no custom motion, so the reduced-motion setting is honoured by construction.
/// </summary>
public sealed partial class VinDecoder : ContentControl, IDisposable
{
    private const double SmallBreakpoint = 640;     // web sm: -> 2-column decoded grid
    private const double CellSpacing = 8;           // web gap-2

    private readonly VinDecoderViewModel _viewModel;
    private readonly VinDecoderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ToolCard _card = new();
    private readonly StackPanel _body = new();
    private readonly TsInput _input = new();
    private readonly Border _resultHost = new();
    private readonly TextBlock _announcer = new();

    private int _columns = 1;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its localizer and optional PII-safe diagnostics collector.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public VinDecoder(ILocalizer localizer, VinDecoderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new VinDecoderDiagnostics();
        _viewModel = new VinDecoderViewModel(localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _input.TextChanged += OnInputTextChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>VinDecoder</c>).</summary>
    public static string Slug => VinDecoderRegistration.Slug;

    private void BuildChrome()
    {
        _body.Orientation = Orientation.Vertical;
        _body.Spacing = 12; // web space-y-3
        _body.Children.Add(BuildInputColumn());

        _resultHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _body.Children.Add(_resultHost);

        _announcer.FontSize = 11;
        _announcer.Foreground = DisplayTokens.TextMuted;
        _announcer.TextWrapping = TextWrapping.Wrap;
        _announcer.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_announcer);
        _body.Children.Add(_announcer);

        _card.IconGlyph = VinDecoderRegistration.Glyph;
        _card.Accent = VinDecoderRegistration.Accent;
        _card.Title = _viewModel.Title;
        _card.Description = _viewModel.Description;
        _card.Body = _body;

        Content = _card;
    }

    private StackPanel BuildInputColumn()
    {
        var label = new TextBlock
        {
            Text = _viewModel.VinLabel,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };

        _input.Hint = VinDecoderRegistration.SampleVin;
        _input.Text = _viewModel.Vin;
        _input.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_input, _viewModel.VinFieldName);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(label);
        column.Children.Add(_input);
        return column;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and the VIN field (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _input.TextChanged -= OnInputTextChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        SizeChanged -= OnSizeChanged;
        GC.SuppressFinalize(this);
    }

    private void OnInputTextChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.Vin = _input.Text;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int columns = ColumnsForWidth(e.NewSize.Width);
        if (columns != _columns)
        {
            _columns = columns;
            if (_viewModel.State == VinDecoderState.Ready)
            {
                ScheduleRender();
            }
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        AutomationProperties.SetName(_input, _viewModel.VinFieldName);

        _resultHost.Child = _viewModel.State == VinDecoderState.Empty ? BuildEmpty() : BuildCells();

        UpdateAnnouncer();
    }

    private Grid BuildCells()
    {
        var cells = _viewModel.Cells;
        int columns = Math.Clamp(_columns, 1, 2);
        int count = cells.Count;
        int rows = columns > 0 ? (count + columns - 1) / columns : count;

        var grid = new Grid
        {
            ColumnSpacing = CellSpacing,
            RowSpacing = CellSpacing,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            var cell = BuildCell(cells[i]);
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private Border BuildCell(VinDecoderCell cell)
    {
        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };
        var value = new TextBlock
        {
            Text = cell.Value,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        };

        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(label);
        column.Children.Add(value);

        var border = new Border
        {
            Background = DisplayTokens.Brush("TsSurfaceOverlayBrush"),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Padding = new Thickness(12, 8, 12, 8),
            Child = column,
        };
        AutomationProperties.SetName(border, _viewModel.CellName(cell));
        return border;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = VinDecoderRegistration.Glyph,
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private void UpdateAnnouncer()
    {
        // The empty surface is its own live region (TsEmptyState announces its message), so the polite
        // announcer carries only the settled decode result.
        string? message = _viewModel.LastAnnouncement;
        if (_viewModel.State != VinDecoderState.Ready || string.IsNullOrEmpty(message))
        {
            _announcer.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _announcer.Text = message;
        _announcer.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_announcer, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_announcer);
        }
    }

    private static int ColumnsForWidth(double width) => width >= SmallBreakpoint ? 2 : 1;
}
