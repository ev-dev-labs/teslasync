using System.Globalization;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.System;
using Windows.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>TemplateGallery</c> feature surface — a parity port of
/// web/src/features/dashboard/components/TemplateGallery.tsx. It reproduces the web component's controlled
/// modal: a light-dismiss scrim hosting a tokenized panel (web <c>Modal size="lg"</c> with
/// <c>bg-[#0f1218]</c> + <c>border-white/[0.08]</c>) whose title swaps between "Dashboard Templates" and
/// "Template Preview" with the selection. The gallery branch lists a dashed "Blank Dashboard" option (web
/// <c>onApply('__blank__')</c>) followed by one card per preset — each a ghost button carrying the shared
/// <see cref="MiniGridPreview"/> thumbnail, the localized name, a widget-count badge, the description and up to
/// five category icons (web <c>useCategoryIcons</c>). Selecting a card opens the detail branch (web
/// <c>TemplateDetail</c>): the preview, name, description, the "{{count}} widgets" line, the per-widget list
/// and the Back / Use-This-Template actions. <c>Open</c> mirrors the web <c>open</c> prop; the
/// <see cref="Apply"/> and <see cref="Close"/> events mirror <c>onApply</c> / <c>onClose</c>. The surface is
/// presentational and fetches nothing, so — like the web source — it has no loading / error / stale / offline
/// branch; the content states are the gallery grid, the detail view and a friendly empty note when no presets
/// exist (the blank option always remains). All copy resolves through the i18n facade
/// (<see cref="TemplateGalleryProjection"/>); every interactive element carries a Narrator name and the panel
/// is keyboard-dismissable (Escape).
/// </summary>
public sealed partial class TemplateGallery : ContentControl
{
    private const double PanelMaxWidth = 720;       // web Modal size="lg"
    private const double PanelMaxHeightFraction = 0.8; // web max-h-[80vh]
    private const double TwoColumnMinWidth = 560;   // web md:grid-cols-2 breakpoint
    private const double CardSpacing = 12;          // web gap-3
    private const string GlassBrushKey = "TsColorSurfaceGlassBrush";
    private const string ScrimBrushKey = "TsColorScrimBrush";

    private readonly ILocalizer _localizer;
    private readonly TemplateGalleryDiagnostics _diagnostics;

    private readonly Grid _root = new();
    private readonly Border _backdrop = new();
    private readonly Border _panel = new();
    private readonly TextBlock _title = new();
    private readonly TsButton _closeButton = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small };
    private readonly ScrollViewer _scroller = new();
    private readonly TsRouteTransition _bodyHost = new();

    private TemplateGalleryModel _model;
    private string? _selectedId;
    private int _columnBucket = -1;
    private bool _openRecorded;

    /// <summary>Whether the modal is shown (web <c>open</c>); collapses the surface when false.</summary>
    public static readonly DependencyProperty OpenProperty = DependencyProperty.Register(
        nameof(Open), typeof(bool), typeof(TemplateGallery),
        new PropertyMetadata(false, OnOpenChanged));

    /// <summary>Creates the surface over its i18n facade, an optional model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial inputs; defaults to <see cref="TemplateGalleryModel.Default"/> (the preset catalog).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TemplateGallery(
        ILocalizer localizer,
        TemplateGalleryModel? model = null,
        TemplateGalleryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? TemplateGalleryModel.Default;
        _diagnostics = diagnostics ?? new TemplateGalleryDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        Content = _root;
        Visibility = Open ? Visibility.Visible : Visibility.Collapsed;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a template (or the blank option) is applied — the native <c>onApply(presetId)</c>.</summary>
    public event EventHandler<string>? Apply;

    /// <summary>Raised when the modal is dismissed — the native <c>onClose</c>.</summary>
    public event EventHandler? Close;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TemplateGallery</c>).</summary>
    public static string Slug => TemplateGalleryRegistration.Slug;

    /// <summary>Whether the modal is shown (web <c>open</c>).</summary>
    public bool Open
    {
        get => (bool)GetValue(OpenProperty);
        set => SetValue(OpenProperty, value);
    }

    /// <summary>The current inputs; reassigning re-projects and re-renders the surface.</summary>
    public TemplateGalleryModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _selectedId = null;
            Render();
        }
    }

    private static void OnOpenChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var gallery = (TemplateGallery)d;
        bool open = (bool)e.NewValue;
        gallery.Visibility = open ? Visibility.Visible : Visibility.Collapsed;

        if (open)
        {
            // Each fresh open returns to the gallery branch (web resets selectedId on close).
            gallery._selectedId = null;
            gallery.Render();
            gallery.RecordOpenedOnce();
        }
        else
        {
            gallery._openRecorded = false;
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (Open)
        {
            RecordOpenedOnce();
        }
    }

    private void RecordOpenedOnce()
    {
        if (_openRecorded)
        {
            return;
        }

        _openRecorded = true;
        _diagnostics.RecordViewOpened();
    }

    // ── Chrome: scrim backdrop + centered tokenized panel (header + scrollable body) ─────────────────────
    private void BuildChrome()
    {
        _backdrop.Background = ScrimBrush();
        _backdrop.HorizontalAlignment = HorizontalAlignment.Stretch;
        _backdrop.VerticalAlignment = VerticalAlignment.Stretch;
        _backdrop.IsTapEnabled = true;
        _backdrop.Tapped += OnBackdropTapped;

        _panel.Background = DisplayTokens.Brush(GlassBrushKey);
        _panel.BorderBrush = DisplayTokens.Border;
        _panel.BorderThickness = new Thickness(1);
        _panel.CornerRadius = DisplayTokens.Radius("TsRadiusLg", 16);
        _panel.HorizontalAlignment = HorizontalAlignment.Center;
        _panel.VerticalAlignment = VerticalAlignment.Center;
        _panel.MaxWidth = PanelMaxWidth;
        _panel.Margin = new Thickness(24);
        _panel.Padding = new Thickness(20);

        var layout = new Grid();
        layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        layout.Children.Add(BuildHeader());

        _scroller.HorizontalScrollMode = ScrollMode.Disabled;
        _scroller.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _scroller.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _scroller.Content = _bodyHost;
        Grid.SetRow(_scroller, 1);
        layout.Children.Add(_scroller);

        _panel.Child = layout;

        _root.Children.Add(_backdrop);
        _root.Children.Add(_panel);
        _root.SizeChanged += OnRootSizeChanged;

        // Escape dismisses the modal (the web Modal's keyboard close).
        _root.IsTabStop = false;
        KeyDown += OnKeyDown;
    }

    private Grid BuildHeader()
    {
        var header = new Grid { Margin = new Thickness(0, 0, 0, 16) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _title.FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18);
        _title.FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeSectionFontWeight", 600));
        _title.Foreground = DisplayTokens.TextPrimary;
        _title.TextTrimming = TextTrimming.CharacterEllipsis;
        _title.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_title, 0);
        header.Children.Add(_title);

        _closeButton.Content = new FontIcon
        {
            Glyph = TemplateGalleryRegistration.CloseGlyph,
            FontSize = 16,
        };
        AutomationProperties.SetName(_closeButton, TemplateGalleryRegistration.CloseLabel(_localizer));
        ToolTipService.SetToolTip(_closeButton, TemplateGalleryRegistration.CloseLabel(_localizer));
        _closeButton.Click += (_, _) => RaiseClose();
        Grid.SetColumn(_closeButton, 1);
        header.Children.Add(_closeButton);

        return header;
    }

    private void OnRootSizeChanged(object sender, SizeChangedEventArgs e)
    {
        _panel.MaxHeight = Math.Max(240, e.NewSize.Height * PanelMaxHeightFraction);

        if (_selectedId is null)
        {
            int bucket = ColumnsFor(AvailablePanelWidth());
            if (bucket != _columnBucket)
            {
                Render();
            }
        }
    }

    private void OnBackdropTapped(object sender, TappedRoutedEventArgs e) => RaiseClose();

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Escape)
        {
            e.Handled = true;
            RaiseClose();
        }
    }

    private void RaiseClose()
    {
        _selectedId = null;
        Close?.Invoke(this, EventArgs.Empty);
    }

    private void RaiseApply(string presetId)
    {
        _diagnostics.RecordTemplateApplied(presetId);
        _selectedId = null;
        Apply?.Invoke(this, presetId);
    }

    private void SelectTemplate(string presetId)
    {
        _selectedId = presetId;
        _diagnostics.RecordTemplateSelected(presetId);
        Render();
    }

    // ── Render: swap the body between the gallery grid and the detail view ───────────────────────────────
    private void Render()
    {
        var selected = _selectedId is null ? null : _model.Find(_selectedId);
        if (selected is null)
        {
            _selectedId = null;
            RenderGallery();
        }
        else
        {
            RenderDetail(selected);
        }
    }

    private void RenderGallery()
    {
        var display = TemplateGalleryProjection.ProjectGallery(_model, _localizer);
        _title.Text = display.Title;
        AutomationProperties.SetName(_panel, display.AutomationName);

        int columns = ColumnsFor(AvailablePanelWidth());
        _columnBucket = columns;

        var grid = new Grid { RowSpacing = CardSpacing, ColumnSpacing = CardSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var items = new List<FrameworkElement> { BuildBlankCard(display.Blank) };
        foreach (var card in display.Cards)
        {
            items.Add(BuildPresetCard(card));
        }

        if (display.IsEmpty)
        {
            items.Add(BuildEmptyNote(display.EmptyMessage, columns));
        }

        int rows = (int)Math.Ceiling(items.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < items.Count; i++)
        {
            var element = items[i];
            Grid.SetRow(element, i / columns);
            Grid.SetColumn(element, i % columns);
            grid.Children.Add(element);
        }

        _bodyHost.Content = grid;
    }

    private void RenderDetail(DashboardTemplate template)
    {
        var display = TemplateGalleryProjection.ProjectDetail(template, _localizer);
        _title.Text = display.Title;
        AutomationProperties.SetName(_panel, display.AutomationName);
        _bodyHost.Content = BuildDetail(display);
    }

    // ── Gallery: the dashed blank-dashboard option (web blank StaggerItem) ───────────────────────────────
    private TsButton BuildBlankCard(TemplateBlankCardDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(BuildIconBadge(display.Glyph, 20));

        var copy = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        copy.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypePanelFontWeight", 600)),
            Foreground = DisplayTokens.TextPrimary,
        });
        copy.Children.Add(new TextBlock
        {
            Text = display.Description,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        });
        row.Children.Add(copy);

        var button = NewCardButton(display.AutomationName);
        button.BorderBrush = DisplayTokens.Border;
        button.BorderThickness = new Thickness(1);
        button.Content = row;
        button.Click += (_, _) => RaiseApply(TemplateGalleryRegistration.BlankApplyId);
        return button;
    }

    // ── Gallery: one preset card (web TemplateCard) ──────────────────────────────────────────────────────
    private TsButton BuildPresetCard(TemplateCardDisplay card)
    {
        var stack = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Stretch };

        stack.Children.Add(new MiniGridPreview(_localizer, card.Preview));

        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = card.Name,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypePanelFontWeight", 600)),
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);
        titleRow.Children.Add(name);

        var badge = new TsBadge { Status = StatusKind.Neutral, VerticalAlignment = VerticalAlignment.Center };
        badge.Content = new TextBlock { Text = card.WidgetCount.ToString(CultureInfo.CurrentCulture) };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
        Grid.SetColumn(badge, 1);
        titleRow.Children.Add(badge);
        stack.Children.Add(titleRow);

        if (card.Description is { } description)
        {
            stack.Children.Add(new TextBlock
            {
                Text = description,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
                MaxLines = 2,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        if (card.CategoryIcons.Count > 0)
        {
            stack.Children.Add(BuildCategoryIcons(card.CategoryIcons));
        }

        var button = NewCardButton(card.AutomationName);
        button.Content = stack;
        button.Click += (_, _) => SelectTemplate(card.Id);
        return button;
    }

    // ── Detail: preview, meta, per-widget list, Back / Use-This-Template actions (web TemplateDetail) ─────
    private TsFadeIn BuildDetail(TemplateDetailDisplay display)
    {
        var stack = new StackPanel { Spacing = 16, HorizontalAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(stack, display.AutomationName);

        stack.Children.Add(new MiniGridPreview(_localizer, display.Preview));

        var meta = new StackPanel { Spacing = 4 };
        meta.Children.Add(new TextBlock
        {
            Text = display.Name,
            FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18),
            FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeSectionFontWeight", 600)),
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });

        if (display.Description is { } description)
        {
            meta.Children.Add(new TextBlock
            {
                Text = description,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
                Foreground = DisplayTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        meta.Children.Add(new TextBlock
        {
            Text = display.WidgetCountText,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
        });
        stack.Children.Add(meta);

        if (display.Widgets.Count > 0)
        {
            stack.Children.Add(BuildWidgetRows(display.Widgets));
        }

        stack.Children.Add(BuildDetailActions(display));

        return new TsFadeIn { Content = stack };
    }

    private static Grid BuildWidgetRows(IReadOnlyList<TemplateWidgetRow> rows)
    {
        var grid = new Grid { RowSpacing = 8, ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        int total = (int)Math.Ceiling(rows.Count / 2.0);
        for (int r = 0; r < total; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < rows.Count; i++)
        {
            var element = BuildWidgetRow(rows[i]);
            Grid.SetRow(element, i / 2);
            Grid.SetColumn(element, i % 2);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Border BuildWidgetRow(TemplateWidgetRow row)
    {
        var container = new Border
        {
            Background = DisplayTokens.Brush(GlassBrushKey),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(12, 8, 12, 8),
        };

        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (row.Glyph is { } glyph)
        {
            var icon = new FontIcon
            {
                Glyph = glyph,
                FontSize = 14,
                Foreground = DisplayTokens.TextMuted,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            content.Children.Add(icon);
        }

        content.Children.Add(new TextBlock
        {
            Text = row.Name,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });

        container.Child = content;
        AutomationProperties.SetName(container, row.Name);
        return container;
    }

    private StackPanel BuildDetailActions(TemplateDetailDisplay display)
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(0, 4, 0, 0),
        };

        var back = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = TemplateGalleryRegistration.BackGlyph,
            Text = display.BackLabel,
        };
        AutomationProperties.SetName(back, display.BackLabel);
        back.Click += (_, _) =>
        {
            _selectedId = null;
            Render();
        };
        actions.Children.Add(back);

        var apply = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            IconGlyph = TemplateGalleryRegistration.ApplyGlyph,
            Text = display.ApplyLabel,
        };
        AutomationProperties.SetName(apply, display.ApplyLabel);
        apply.Click += (_, _) => RaiseApply(display.Id);
        actions.Children.Add(apply);

        return actions;
    }

    // ── Shared small pieces ──────────────────────────────────────────────────────────────────────────────
    private static StackPanel BuildCategoryIcons(IReadOnlyList<TemplateCategoryIcon> icons)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (var icon in icons)
        {
            var chip = new Border
            {
                Background = DisplayTokens.Brush(GlassBrushKey),
                CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4),
                Padding = new Thickness(4),
            };

            if (icon.Glyph is { } glyph)
            {
                chip.Child = new FontIcon
                {
                    Glyph = glyph,
                    FontSize = 12,
                    Foreground = DisplayTokens.TextMuted,
                };
            }

            ToolTipService.SetToolTip(chip, icon.CategoryLabel);
            AutomationProperties.SetName(chip, icon.CategoryLabel);
            row.Children.Add(chip);
        }

        return row;
    }

    private static Border BuildIconBadge(string glyph, double size)
    {
        return new Border
        {
            Background = DisplayTokens.Brush(GlassBrushKey),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(10),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = glyph,
                FontSize = size,
                Foreground = DisplayTokens.TextMuted,
            },
        };
    }

    private static Border BuildEmptyNote(string message, int columnSpan)
    {
        var note = new Border
        {
            Background = DisplayTokens.Brush(GlassBrushKey),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(16),
            Child = new TextBlock
            {
                Text = message,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
                Foreground = DisplayTokens.TextMuted,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
            },
        };

        AutomationProperties.SetName(note, message);
        LiveRegion.Configure(note);
        Grid.SetColumnSpan(note, Math.Max(1, columnSpan));
        return note;
    }

    private static TsButton NewCardButton(string automationName)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Large,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
            Padding = new Thickness(12),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
        };
        AutomationProperties.SetName(button, automationName);
        return button;
    }

    private double AvailablePanelWidth()
    {
        double host = _root.ActualWidth > 0 ? _root.ActualWidth : ActualWidth;
        double width = Math.Min(PanelMaxWidth, host > 0 ? host - 48 : PanelMaxWidth);
        return Math.Max(0, width - 40); // panel padding (20 each side)
    }

    private static int ColumnsFor(double availableWidth) => availableWidth >= TwoColumnMinWidth ? 2 : 1;

    private static Brush ScrimBrush()
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue(ScrimBrushKey, out var value) && value is Brush brush)
        {
            return brush;
        }

        // Modal backdrop dim — a structural overlay, not a semantic token colour.
        return new SolidColorBrush(Color.FromArgb(0x99, 0x00, 0x00, 0x00));
    }
}
