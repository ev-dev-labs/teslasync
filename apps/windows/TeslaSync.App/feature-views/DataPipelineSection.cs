using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Data Pipeline surface — a parity port of
/// web/src/features/system/components/status/DataPipelineSection.tsx. It composes the web's
/// <c>AccordionSection</c>: a disclosure header (an Archive glyph, the "Data Pipeline" title +
/// "Compression statistics and export job queue" description and up to two header badges — an info
/// "{savings}% saved" badge when compression is present and a warning "{n} active" badge when jobs are
/// queued or processing) above a body that reproduces the web's two sub-sections — a "Compression
/// Statistics" block (four metric tiles — Compression Ratio / Estimated Savings / Total Positions /
/// Compressed — and a centred savings <see cref="TsRadialGauge"/>) and an always-shown "Export Job Queue"
/// block (four queue stat tiles — Pending / Processing / Completed / Failed — plus a job table of Status /
/// Type / Format / File / Records / Created, or a friendly inline empty surface when the queue is empty).
/// Every state renders — a loading skeleton, the populated body, a friendly empty surface, an explicit retry
/// surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="DataPipelineSectionViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every tile / row carries a Narrator name.
/// </summary>
public sealed partial class DataPipelineSection : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE7B8"; // Segoe Fluent — Archive (web Archive)

    private const double StatusColumnWidth = 132;
    private const double TypeColumnWidth = 120;
    private const double FormatColumnWidth = 96;
    private const double RecordsColumnWidth = 110;
    private const double CreatedColumnWidth = 176;
    private const double GaugeDiameter = 140; // web RadialGauge size={140}

    private readonly DataPipelineSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DataPipelineSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The two-read data port.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    /// <param name="clock">An injectable clock for time formatting/freshness.</param>
    public DataPipelineSection(
        IDataPipelineSectionSource source,
        ILocalizer localizer,
        DataPipelineSectionDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DataPipelineSectionDiagnostics();
        _viewModel = new DataPipelineSectionViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, DataPipelineSectionRegistration.Title(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>data-pipeline-section</c>).</summary>
    public static string SurfaceId => DataPipelineSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public DataPipelineSectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DataPipelineSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies). Neither endpoint is vehicle-scoped, so no vehicle
    /// source is required.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    public static DataPipelineSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DataPipelineSectionDiagnostics? diagnostics = null)
    {
        var source = new DataPipelineSectionSource(api, engine, options);
        return new DataPipelineSection(source, localizer, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        _root.Children.Clear();

        var accordion = new TsAccordion
        {
            Header = BuildHeader(),
            Content = BuildBody(),
            IsExpanded = true,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(accordion, _viewModel.Title);
        _root.Children.Add(accordion);
    }

    // ── Header ───────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Width = 40,
            Height = 40,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = HeaderGlyph,
                FontSize = 18,
                Foreground = DisplayTokens.Accent,
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var description = new TextBlock
        {
            Text = _viewModel.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(title);
        texts.Children.Add(description);

        var trailing = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // Web header badges: an info "{savings}% saved" badge, then a warning "{n} active" badge.
        if (_viewModel.Display.HasSavedBadge)
        {
            trailing.Children.Add(BuildHeaderBadge(StatusKind.Info, _viewModel.Display.SavedBadgeText));
        }

        if (_viewModel.Display.HasActiveBadge)
        {
            trailing.Children.Add(BuildHeaderBadge(StatusKind.Warning, _viewModel.Display.ActiveBadgeText));
        }

        trailing.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var header = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(texts, 1);
        Grid.SetColumn(trailing, 2);
        header.Children.Add(iconChip);
        header.Children.Add(texts);
        header.Children.Add(trailing);
        return header;
    }

    private static TsBadge BuildHeaderBadge(StatusKind status, string text)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // ── Body ─────────────────────────────────────────────────────────────────────────────────────────

    private UIElement BuildBody() => _viewModel.State switch
    {
        DataPipelineSectionState.Loading => BuildLoading(),
        DataPipelineSectionState.Error => BuildError(),
        DataPipelineSectionState.Empty => BuildEmpty(),
        _ => BuildContent(),
    };

    private StackPanel BuildContent()
    {
        var column = new StackPanel { Spacing = 24, Padding = new Thickness(0, 8, 0, 0) };
        if (_viewModel.Display.HasCompression)
        {
            column.Children.Add(BuildCompressionSection());
        }

        column.Children.Add(BuildExportSection());
        return column;
    }

    // ── Compression Statistics ─────────────────────────────────────────────────────────────────────────

    private StackPanel BuildCompressionSection()
    {
        var section = new StackPanel { Spacing = 16 };
        section.Children.Add(new SectionTitle { Value = _viewModel.CompressionStatisticsTitle });
        section.Children.Add(BuildMetricGrid(_viewModel.Display.CompressionTiles));
        section.Children.Add(BuildGauge());
        return section;
    }

    private StackPanel BuildGauge()
    {
        var gauge = new TsRadialGauge
        {
            Value = _viewModel.Display.SavingsPercent,
            Max = 100,
            Unit = "%",
            Decimals = 1,
            Label = _viewModel.Display.GaugeLabel,
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var host = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        host.Children.Add(gauge);
        return host;
    }

    // ── Export Job Queue ─────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildExportSection()
    {
        var section = new StackPanel { Spacing = 16 };
        section.Children.Add(new SectionTitle { Value = _viewModel.ExportJobQueueTitle });

        if (_viewModel.Display.HasExportJobs)
        {
            section.Children.Add(BuildMetricGrid(_viewModel.Display.StatTiles));
            section.Children.Add(BuildExportTable());
        }
        else
        {
            section.Children.Add(BuildInlineEmpty(_viewModel.NoExportJobsMessage, HeaderGlyph));
        }

        return section;
    }

    private StackPanel BuildExportTable()
    {
        var columns = new[]
        {
            new ColumnSpec(_viewModel.StatusHeader, new GridLength(StatusColumnWidth)),
            new ColumnSpec(_viewModel.TypeHeader, new GridLength(TypeColumnWidth)),
            new ColumnSpec(_viewModel.FormatHeader, new GridLength(FormatColumnWidth)),
            new ColumnSpec(_viewModel.FileHeader, new GridLength(1.6, GridUnitType.Star)),
            new ColumnSpec(_viewModel.RecordsHeader, new GridLength(RecordsColumnWidth)),
            new ColumnSpec(_viewModel.CreatedHeader, new GridLength(CreatedColumnWidth)),
        };

        var table = NewTable(columns);
        foreach (var row in _viewModel.Display.ExportRows)
        {
            var statusBrush = DisplayTokens.Brush(row.StatusBrushKey);
            var statusCell = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                VerticalAlignment = VerticalAlignment.Center,
            };
            if (!string.IsNullOrEmpty(row.StatusGlyph))
            {
                statusCell.Children.Add(new FontIcon { Glyph = row.StatusGlyph, FontSize = 14, Foreground = statusBrush });
            }

            statusCell.Children.Add(new TextBlock
            {
                Text = row.StatusText,
                FontSize = 12,
                Foreground = statusBrush,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });

            var type = TextCell(row.Type, DisplayTokens.TextPrimary);

            // web Format column: <Badge variant="neutral" size="sm">{row.format}</Badge>
            var formatBadge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = new TextBlock { Text = row.Format, FontSize = 12 },
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Left,
            };
            AutomationProperties.SetName(formatBadge, row.Format);

            // web File column: <span className="font-mono text-xs truncate">{row.file_name}</span>
            var file = new TextBlock
            {
                Text = row.FileName,
                FontSize = 12,
                FontFamily = MonospaceFont,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };

            var records = TextCell(row.RecordCount, DisplayTokens.TextPrimary);
            var created = TextCell(row.Created, DisplayTokens.TextSecondary);

            table.Children.Add(BuildRow(
                columns,
                new UIElement[] { statusCell, type, formatBadge, file, records, created },
                row.AutomationName));
        }

        return table;
    }

    // ── Tiles ────────────────────────────────────────────────────────────────────────────────────────

    private static Grid BuildMetricGrid(IReadOnlyList<DataPipelineMetricTile> tiles)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < 4; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var tile = BuildMetricTile(tiles[i]);
            Grid.SetColumn(tile, i % 4);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildMetricTile(DataPipelineMetricTile tile)
    {
        var accent = DisplayTokens.Brush(tile.AccentBrushKey);

        var glyph = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = 14,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = tile.Label,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(glyph);
        header.Children.Add(label);

        var value = new TextBlock
        {
            Text = tile.Value,
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(header);
        column.Children.Add(value);

        var card = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, tile.AutomationName);
        return card;
    }

    // ── State surfaces ───────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 16, Padding = new Thickness(0, 8, 0, 8) };
        column.Children.Add(new TsSkeleton { BlockHeight = 128 }); // web Skeleton h-32
        column.Children.Add(new TsSkeleton { BlockHeight = 192 }); // web Skeleton h-48
        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Border BuildInlineEmpty(string message, string glyph)
    {
        var content = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon { Glyph = glyph, FontSize = 24, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        content.Children.Add(icon);
        content.Children.Add(new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        var border = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(16),
            MinHeight = 72,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(border, message);
        return border;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Table primitives ─────────────────────────────────────────────────────────────────────────────

    private static StackPanel NewTable(IReadOnlyList<ColumnSpec> columns)
    {
        var table = new StackPanel { Spacing = 0 };

        var headerGrid = NewColumnGrid(columns);
        headerGrid.Padding = new Thickness(8, 4, 8, 6);
        for (int i = 0; i < columns.Count; i++)
        {
            var caption = new TextBlock
            {
                Text = columns[i].Header,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextMuted,
                CharacterSpacing = 40,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
            Grid.SetColumn(caption, i);
            headerGrid.Children.Add(caption);
        }

        table.Children.Add(new Border
        {
            Child = headerGrid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        });
        return table;
    }

    private static Border BuildRow(IReadOnlyList<ColumnSpec> columns, UIElement[] cells, string automationName)
    {
        var grid = NewColumnGrid(columns);
        grid.Padding = new Thickness(8, 6, 8, 6);
        grid.MinHeight = 40;
        for (int i = 0; i < cells.Length && i < columns.Count; i++)
        {
            var cell = cells[i];
            Grid.SetColumn((FrameworkElement)cell, i);
            grid.Children.Add(cell);
        }

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        AutomationProperties.SetName(border, automationName);
        return border;
    }

    private static Grid NewColumnGrid(IReadOnlyList<ColumnSpec> columns)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var column in columns)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = column.Width });
        }

        return grid;
    }

    private static TextBlock TextCell(string text, Brush foreground) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = foreground,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static FontFamily MonospaceFont =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var v) && v is FontFamily f
            ? f
            : new FontFamily("Consolas");

    protected override AutomationPeer OnCreateAutomationPeer() => new DataPipelineSectionAutomationPeer(this);

    private readonly record struct ColumnSpec(string Header, GridLength Width);

    private sealed class DataPipelineSectionAutomationPeer(DataPipelineSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
