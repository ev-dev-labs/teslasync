using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.CronParser;

/// <summary>
/// The native WinUI 3 Cron Parser surface — a parity port of
/// web/src/features/admin/components/devtools/tools/CronParser.tsx (<c>CronParserTool</c>). It reproduces the
/// web's interactive cron calculator: a tokenized glass card (the web <c>ToolCard</c>) whose header carries a
/// green-tinted Segoe Fluent glyph (the web Lucide <c>Timer</c>), the localized title and description; an
/// expression field (the web <c>Input</c> with its <c>Cron Expression</c> header and <c>*/5 * * * *</c>
/// hint); a wrap of preset chips (Every Minute … Every Month) that fill the field; and — once a valid
/// five-field expression is entered — a description block (the web <c>describeCron</c> result, tinted with the
/// success token) and a numbered list of upcoming runs (the web <c>getNextCronRuns</c> rows, each a status
/// chip plus a monospace fire time). Until a valid expression is entered a friendly empty surface renders, so
/// the region is never a blank box (the web simply shows nothing — the native polish always fills it). The
/// surface is presentational: it has no data source and no asynchronous reads, so there is no
/// loading / error / stale / offline state (the web source has none). All projection flows through the shared
/// <see cref="CronParserViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade, the expression field and every chip carry a Narrator name, the result region is a polite live
/// region so a screen reader announces each recomputation, and the surface adds no custom motion (so the
/// reduced-motion setting is honoured by construction).
/// </summary>
public sealed partial class CronParserTool : ContentControl, IDisposable
{
    // Segoe Fluent Icons code point — the platform glyph standing in for the web Lucide Timer icon.
    private const string TimerGlyph = "\uE787";

    // Semantic accent token (web Tailwind neon-green -> nearest design token; no ad-hoc hex).
    private const string GreenAccentKey = "TsColorSuccessBrush";

    private readonly CronParserViewModel _viewModel;
    private readonly CronParserDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsInput _input;
    private readonly Border _resultsHost;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its preset source, localizer and diagnostics.</summary>
    /// <param name="source">The cron preset source (the canonical catalog).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public CronParserTool(
        ICronPresetSource source,
        ILocalizer localizer,
        CronParserDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new CronParserDiagnostics();
        _viewModel = new CronParserViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        _input = new TsInput
        {
            Header = _viewModel.InputLabel,
            Hint = _viewModel.InputHint,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(_input, _viewModel.InputLabel);
        _input.TextChanged += OnInputTextChanged;

        _resultsHost = new Border { HorizontalAlignment = HorizontalAlignment.Stretch };
        LiveRegion.Configure(_resultsHost);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_input);
        body.Children.Add(BuildPresetRow());
        body.Children.Add(_resultsHost);

        var card = new StackPanel { Spacing = 16 };
        card.Children.Add(BuildHeader(_viewModel.Title, _viewModel.ToolDescription, TimerGlyph, GreenAccentKey));
        card.Children.Add(body);

        Content = new TsGlassPanel
        {
            Glow = GlassGlow.Green,
            Padding = new Thickness(20),
            Content = card,
        };

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>cron-parser</c>).</summary>
    public static string RegistryId => CronParserRegistration.Id;

    /// <summary>The Client Utilities host tool id this surface bodies (<c>cron</c>).</summary>
    public static string ToolId => CronParserRegistration.ToolId;

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="CronPresetSource"/> (the web preset list) over
    /// the host's localizer.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static CronParserTool Create(
        ILocalizer localizer,
        CronParserDiagnostics? diagnostics = null) =>
        new(new CronPresetSource(), localizer, diagnostics);

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

    /// <summary>Detach from the view-model and the expression field (idempotent).</summary>
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
        GC.SuppressFinalize(this);
    }

    private void OnInputTextChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.Expression = _input.Text;

    private void OnPresetChosen(string value)
    {
        _input.Text = value;
        _input.SelectionStart = value.Length;
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(CronParserViewModel.Display) or nameof(CronParserViewModel.State))
        {
            ScheduleRender();
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
        _resultsHost.Child = _viewModel.State == CronParserState.Empty ? BuildEmpty() : BuildResults();
        LiveRegion.Announce(_resultsHost);
    }

    private ChipWrapPanel BuildPresetRow()
    {
        var row = new ChipWrapPanel
        {
            HorizontalSpacing = 4,
            VerticalSpacing = 4,
        };

        foreach (var preset in _viewModel.Presets)
        {
            var button = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = preset.Label,
            };
            AutomationProperties.SetName(button, preset.AutomationName);

            string value = preset.Value;
            button.Click += (_, _) => OnPresetChosen(value);
            row.Children.Add(button);
        }

        AutomationProperties.SetName(row, _viewModel.InputLabel);
        return row;
    }

    private StackPanel BuildResults()
    {
        var column = new StackPanel { Spacing = 12 };

        if (_viewModel.HasDescription)
        {
            column.Children.Add(BuildDescriptionBlock(_viewModel.DescriptionLabel, _viewModel.Description));
        }

        column.Children.Add(BuildRunsSection());
        return column;
    }

    private static Border BuildDescriptionBlock(string label, string description)
    {
        var caption = new TextBlock
        {
            Text = label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
        };

        var value = new TextBlock
        {
            Text = description,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(GreenAccentKey),
            TextWrapping = TextWrapping.Wrap,
        };

        var stack = new StackPanel { Spacing = 2 };
        stack.Children.Add(caption);
        stack.Children.Add(value);

        var block = new Border
        {
            Background = DisplayTokens.Surface,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(12, 8, 12, 8),
            Child = stack,
        };
        AutomationProperties.SetName(block, string.Create(CultureInfo.CurrentCulture, $"{label}: {description}"));
        return block;
    }

    private StackPanel BuildRunsSection()
    {
        var section = new StackPanel { Spacing = 4 };

        section.Children.Add(new TextBlock
        {
            Text = _viewModel.NextRunsLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
        });

        if (_viewModel.HasRuns)
        {
            var mono = MonoFontFamily();
            foreach (var run in _viewModel.NextRuns)
            {
                section.Children.Add(BuildRunRow(run, mono));
            }
        }
        else
        {
            section.Children.Add(new TextBlock
            {
                Text = _viewModel.NoRunsMessage,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        return section;
    }

    private static Border BuildRunRow(CronRun run, FontFamily? mono)
    {
        var badge = new TsBadge
        {
            Status = StatusKind.Info,
            Content = new TextBlock { Text = run.Index.ToString(CultureInfo.CurrentCulture) },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);

        var time = new TextBlock
        {
            Text = run.Formatted,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        if (mono is not null)
        {
            time.FontFamily = mono;
        }

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(badge);
        row.Children.Add(time);

        var border = new Border
        {
            Background = DisplayTokens.Surface,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(12, 4, 12, 4),
            Child = row,
        };
        AutomationProperties.SetName(border, run.AutomationName);
        return border;
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = TimerGlyph,
            Message = _viewModel.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        return empty;
    }

    private static Grid BuildHeader(string title, string description, string glyph, string accentBrushKey)
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = AccentChip(accentBrushKey),
            Width = 40,
            Height = 40,
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon
            {
                Glyph = glyph,
                FontSize = 18,
                Foreground = DisplayTokens.Brush(accentBrushKey),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var name = new TextBlock
        {
            Text = title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };

        var subtitle = new TextBlock
        {
            Text = description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var texts = new StackPanel { Spacing = 2 };
        texts.Children.Add(name);
        texts.Children.Add(subtitle);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(texts, 1);
        header.Children.Add(iconChip);
        header.Children.Add(texts);
        return header;
    }

    private static FontFamily? MonoFontFamily() =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var value) && value is FontFamily family
            ? family
            : null;

    private static Brush AccentChip(string accentBrushKey)
    {
        var brush = DisplayTokens.Brush(accentBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }

    /// <summary>
    /// A minimal flow panel that lays its children out left to right and wraps to a new row when the next
    /// child would overflow the available width — the native equivalent of the web preset row's
    /// <c>flex flex-wrap gap-1</c>. Base WinUI ships no wrap panel, so the surface carries its own (the same
    /// pattern the dashboard chip clusters use).
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between chips on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
