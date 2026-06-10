using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using VirtualKey = Windows.System.VirtualKey;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Alert Message Editor surface — a parity port of
/// web/src/features/notifications/components/AlertMessageEditor.tsx. It composes the include-title
/// toggle, the body template field with a <c>{{</c>-triggered insert-token autocomplete popover, the
/// "Pick a preset" gallery modal and the debounced live preview pane. All data flows through the shared
/// <see cref="AlertMessageEditorViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class AlertMessageEditor : ContentControl, IDisposable
{
    private const string PresetGlyph = "\uE82F";   // Segoe Fluent — Lightbulb (curated presets)
    private const string PreviewGlyph = "\uE7B3";  // Segoe Fluent — RedEye (preview)

    private readonly AlertMessageEditorViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AlertMessageEditorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 8 };
    private readonly TsCheckbox _includeTitle = new();
    private readonly TsTextarea _textarea = new();
    private readonly TsPopover _popover = new();
    private readonly Border _autocompleteHost = new();
    private readonly TsButton _presetButton = new();
    private readonly TsGlassPanel _previewPanel = new();
    private readonly StackPanel _previewBody = new() { Spacing = 2 };
    private readonly TsModal _presetModal = new();
    private readonly StackPanel _presetModalBody = new() { Spacing = 12 };

    private bool _started;
    private bool _renderQueued;
    private bool _suppressEvents;
    private bool _popoverShown;
    private bool _modalShown;
    private bool _disposed;

    /// <summary>Creates the surface over its three data sources, the localizer, the initial state and diagnostics.</summary>
    public AlertMessageEditor(
        IMessageTokenSource tokenSource,
        IMessagePresetSource presetSource,
        IMessagePreviewSource previewSource,
        ILocalizer localizer,
        AlertRuleDraft draft,
        string msgTemplate = "",
        bool includeTitle = true,
        AlertMessageEditorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(tokenSource);
        ArgumentNullException.ThrowIfNull(presetSource);
        ArgumentNullException.ThrowIfNull(previewSource);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(draft);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AlertMessageEditorDiagnostics();
        _viewModel = new AlertMessageEditorViewModel(
            tokenSource, presetSource, previewSource, localizer, draft, msgTemplate, includeTitle);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.TemplateEdited += OnTemplateEdited;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id this view registers under (<c>alert-message-editor</c>).</summary>
    public static string RegistryId => AlertMessageEditorRegistration.Id;

    /// <summary>The state holder driving this surface (exposed for host wiring and tests).</summary>
    public AlertMessageEditorViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed data sources from the shared data layer
    /// (the host's P2-core dependencies).
    /// </summary>
    public static AlertMessageEditor Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AlertRuleDraft draft,
        string msgTemplate = "",
        bool includeTitle = true,
        AlertMessageEditorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);

        var tokenSource = new MessageTokenSource(api, engine, options);
        var presetSource = new MessagePresetSource(api, engine, options);
        var previewSource = new MessagePreviewSource(api);
        return new AlertMessageEditor(
            tokenSource, presetSource, previewSource, localizer, draft, msgTemplate, includeTitle, diagnostics);
    }

    private void BuildChrome()
    {
        _root.Children.Add(BuildIncludeTitleRow());
        _root.Children.Add(BuildLabelRow());
        _root.Children.Add(BuildEditorRow());
        _root.Children.Add(BuildPreviewRow());

        _presetModal.Title = AlertMessageEditorText.PresetModalTitle(_localizer);
        _presetModal.CloseButtonText = AlertMessageEditorText.Close(_localizer);
        _presetModal.Content = new ScrollViewer
        {
            Content = _presetModalBody,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
        _presetModal.Closed += OnPresetModalClosed;
    }

    private StackPanel BuildIncludeTitleRow()
    {
        _includeTitle.Content = new TextBlock
        {
            Text = AlertMessageEditorText.IncludeTitleLabel(_localizer),
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
        };
        AutomationProperties.SetName(_includeTitle, AlertMessageEditorText.IncludeTitleLabel(_localizer));
        _includeTitle.Checked += OnIncludeTitleToggled;
        _includeTitle.Unchecked += OnIncludeTitleToggled;

        var help = new TsHelpTooltip { Hint = AlertMessageEditorText.IncludeTitleHelp(_localizer) };
        AutomationProperties.SetName(help, AlertMessageEditorText.IncludeTitleHelp(_localizer));

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(_includeTitle);
        row.Children.Add(help);
        return row;
    }

    private Grid BuildLabelRow()
    {
        var label = new TextBlock
        {
            Text = AlertMessageEditorText.MessageTemplateLabel(_localizer).ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var hint = new TextBlock
        {
            Text = AlertMessageEditorText.MessageTemplateHint(_localizer),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var help = new TsHelpTooltip { Hint = AlertMessageEditorText.MessageTemplateHelp(_localizer) };
        AutomationProperties.SetName(help, AlertMessageEditorText.MessageTemplateHelp(_localizer));

        var labels = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        labels.Children.Add(label);
        labels.Children.Add(hint);
        labels.Children.Add(help);

        _presetButton.Text = AlertMessageEditorText.PresetButton(_localizer);
        _presetButton.IconGlyph = PresetGlyph;
        _presetButton.Variant = ButtonVariant.Subtle;
        _presetButton.Size = ControlSize.Small;
        _presetButton.HorizontalAlignment = HorizontalAlignment.Right;
        AutomationProperties.SetName(_presetButton, AlertMessageEditorText.PresetButton(_localizer));
        _presetButton.Click += OnPresetButtonClick;

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(labels, 0);
        Grid.SetColumn(_presetButton, 1);
        row.Children.Add(labels);
        row.Children.Add(_presetButton);
        return row;
    }

    private TsPopover BuildEditorRow()
    {
        _textarea.Hint = AlertMessageEditorText.MessageTemplateHintText(_localizer);
        _textarea.MaxLength = 1024;
        _textarea.MinHeight = 72;
        _textarea.Text = _viewModel.MsgTemplate;
        AutomationProperties.SetName(_textarea, AlertMessageEditorText.MessageTemplateLabel(_localizer));
        _textarea.TextChanged += OnTextareaTextChanged;
        _textarea.KeyDown += OnTextareaKeyDown;

        _autocompleteHost.MaxHeight = 280;
        _autocompleteHost.MinWidth = 280;
        AutomationProperties.SetName(_autocompleteHost, AlertMessageEditorText.AutocompleteLabel(_localizer));
        LiveRegion.Configure(_autocompleteHost);

        _popover.Content = _textarea;
        _popover.PopoverContent = _autocompleteHost;
        return _popover;
    }

    private TsGlassPanel BuildPreviewRow()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var eye = new FontIcon { Glyph = PreviewGlyph, FontSize = 12, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(eye, AccessibilityView.Raw);
        header.Children.Add(eye);
        header.Children.Add(new TextBlock
        {
            Text = AlertMessageEditorText.PreviewLabel(_localizer).ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
        });

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(header);
        column.Children.Add(_previewBody);

        _previewPanel.Glow = GlassGlow.None;
        _previewPanel.Content = column;
        LiveRegion.Configure(_previewBody);
        AutomationProperties.SetName(_previewPanel, AlertMessageEditorText.PreviewLabel(_localizer));
        return _previewPanel;
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

    /// <summary>Detach from the view-model and cancel any in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.TemplateEdited -= OnTemplateEdited;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnIncludeTitleToggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetIncludeTitle(_includeTitle.IsChecked == true);
    }

    private void OnTextareaTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.OnTemplateChanged(_textarea.Text, _textarea.SelectionStart);
    }

    private void OnTextareaKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (!_viewModel.AutocompleteOpen || !_viewModel.HasFilteredTokens)
        {
            return;
        }

        switch (e.Key)
        {
            case VirtualKey.Down:
                _viewModel.MoveCursorDown();
                e.Handled = true;
                break;
            case VirtualKey.Up:
                _viewModel.MoveCursorUp();
                e.Handled = true;
                break;
            case VirtualKey.Enter:
            case VirtualKey.Tab:
                _viewModel.AcceptHighlighted();
                e.Handled = true;
                break;
            case VirtualKey.Escape:
                _viewModel.CloseAutocomplete();
                e.Handled = true;
                break;
            default:
                break;
        }
    }

    private void OnPresetButtonClick(object sender, RoutedEventArgs e) => _viewModel.OpenPresetGallery();

    private void OnTemplateEdited(object? sender, TemplateEdit edit)
    {
        void Apply()
        {
            _suppressEvents = true;
            _textarea.Text = edit.Text;
            _textarea.SelectionStart = Math.Clamp(edit.Caret, 0, _textarea.Text.Length);
            _textarea.Focus(FocusState.Programmatic);
            _suppressEvents = false;
        }

        RunOnDispatcher(Apply);
    }

    private void OnPresetModalClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        _modalShown = false;
        _viewModel.ClosePresetGallery();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        RunOnDispatcher(RenderCoalesced);
    }

    private void RunOnDispatcher(Action action)
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

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _suppressEvents = true;
        _includeTitle.IsChecked = _viewModel.IncludeTitle;
        _suppressEvents = false;

        RenderAutocomplete();
        RenderPreview();
        RenderPresetGallery();
    }

    private void RenderAutocomplete()
    {
        _autocompleteHost.Child = BuildAutocompleteContent();

        bool shouldShow = _viewModel.AutocompleteOpen;
        if (shouldShow && !_popoverShown)
        {
            _popover.Show();
            _popoverShown = true;
            LiveRegion.Announce(_autocompleteHost);
        }
        else if (!shouldShow && _popoverShown)
        {
            _popover.Hide();
            _popoverShown = false;
        }
    }

    private UIElement BuildAutocompleteContent()
    {
        if (_viewModel.TokensLoading)
        {
            return MutedNote(AlertMessageEditorText.Loading(_localizer));
        }

        if (!_viewModel.HasFilteredTokens)
        {
            return MutedNote(AlertMessageEditorText.AutocompleteEmpty(_localizer));
        }

        var list = new StackPanel { Spacing = 2, Padding = new Thickness(4) };
        foreach (var group in _viewModel.FilteredTokenGroups)
        {
            list.Children.Add(new TextBlock
            {
                Text = group.Group,
                FontSize = 10,
                CharacterSpacing = 80,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(6, 4, 6, 2),
            });

            foreach (var token in group.Tokens)
            {
                list.Children.Add(BuildTokenRow(token));
            }
        }

        return list;
    }

    private Button BuildTokenRow(MessageToken token)
    {
        bool highlighted = _viewModel.HighlightedToken is { } h && string.Equals(h.Key, token.Key, StringComparison.Ordinal);

        var code = new TextBlock
        {
            Text = token.InsertText,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = token.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        content.Children.Add(code);
        content.Children.Add(label);

        var button = new Button
        {
            Content = content,
            Background = highlighted ? DisplayTokens.Surface : Transparent(),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(6, 4, 6, 4),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            DataContext = token,
        };
        AutomationProperties.SetName(button, token.AutomationName);
        button.Click += OnTokenRowClick;
        return button;
    }

    private void OnTokenRowClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: MessageToken token })
        {
            _viewModel.InsertToken(token);
        }
    }

    private void RenderPreview()
    {
        _previewBody.Children.Clear();
        switch (_viewModel.PreviewState)
        {
            case AlertMessagePreviewState.Error:
                _previewBody.Children.Add(new TextBlock
                {
                    Text = _viewModel.PreviewError ?? AlertMessageEditorText.PreviewErrorText(_localizer),
                    FontSize = 12,
                    Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                    TextWrapping = TextWrapping.Wrap,
                });
                break;

            case AlertMessagePreviewState.Loading:
                _previewBody.Children.Add(MutedText(AlertMessageEditorText.Loading(_localizer)));
                break;

            case AlertMessagePreviewState.Rendered:
                if (_viewModel.ShowPreviewTitle)
                {
                    _previewBody.Children.Add(new TextBlock
                    {
                        Text = _viewModel.PreviewTitle,
                        FontSize = 13,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = DisplayTokens.TextPrimary,
                        TextWrapping = TextWrapping.Wrap,
                    });
                }

                _previewBody.Children.Add(new TextBlock
                {
                    Text = _viewModel.PreviewBody,
                    FontSize = 12,
                    FontStyle = _viewModel.PreviewBodyIsEmptyNote ? Windows.UI.Text.FontStyle.Italic : Windows.UI.Text.FontStyle.Normal,
                    Foreground = _viewModel.PreviewBodyIsEmptyNote ? DisplayTokens.TextMuted : DisplayTokens.TextSecondary,
                    TextWrapping = TextWrapping.Wrap,
                });
                break;

            default:
                _previewBody.Children.Add(MutedText(AlertMessageEditorText.PreviewEmpty(_localizer)));
                break;
        }

        LiveRegion.Announce(_previewBody);
    }

    private void RenderPresetGallery()
    {
        _presetModalBody.Children.Clear();
        _presetModalBody.Children.Add(new TextBlock
        {
            Text = AlertMessageEditorText.PresetModalIntro(_localizer),
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        });

        if (_viewModel.PresetTags.Count > 0)
        {
            _presetModalBody.Children.Add(BuildTagChips());
        }

        switch (_viewModel.PresetsState)
        {
            case AlertMessageCatalogState.Loading:
                _presetModalBody.Children.Add(CenteredNote(AlertMessageEditorText.Loading(_localizer)));
                break;

            case AlertMessageCatalogState.Error:
                _presetModalBody.Children.Add(CenteredNote(_viewModel.PresetsError ?? AlertMessageEditorText.PresetEmpty(_localizer)));
                break;

            default:
                if (!_viewModel.HasPresets)
                {
                    _presetModalBody.Children.Add(CenteredNote(AlertMessageEditorText.PresetEmpty(_localizer)));
                }
                else
                {
                    foreach (var preset in _viewModel.FilteredPresets)
                    {
                        _presetModalBody.Children.Add(BuildPresetCard(preset));
                    }
                }

                break;
        }

        bool shouldShow = _viewModel.PresetGalleryOpen;
        if (shouldShow && !_modalShown && XamlRoot is not null)
        {
            _modalShown = true;
            _presetModal.XamlRoot = XamlRoot;
            _ = _presetModal.ShowAsync();
        }
        else if (!shouldShow && _modalShown)
        {
            _modalShown = false;
            _presetModal.Hide();
        }
    }

    private StackPanel BuildTagChips()
    {
        var wrap = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        wrap.Children.Add(BuildTagChip(null, AlertMessageEditorText.PresetAllTag(_localizer), _viewModel.ActiveTag is null));
        foreach (var tag in _viewModel.PresetTags)
        {
            wrap.Children.Add(BuildTagChip(tag, tag, string.Equals(_viewModel.ActiveTag, tag, StringComparison.Ordinal)));
        }

        return wrap;
    }

    private TsButton BuildTagChip(string? tag, string label, bool active)
    {
        var chip = new TsButton
        {
            Text = label,
            Variant = active ? ButtonVariant.Primary : ButtonVariant.Subtle,
            Size = ControlSize.Small,
            DataContext = tag,
        };
        AutomationProperties.SetName(chip, label);
        chip.Click += OnTagChipClick;
        return chip;
    }

    private void OnTagChipClick(object sender, RoutedEventArgs e)
    {
        if (sender is TsButton button)
        {
            _viewModel.SetActiveTag(button.DataContext as string);
        }
    }

    private Button BuildPresetCard(MessagePreset preset)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new TextBlock
        {
            Text = preset.Name,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });

        if (!string.IsNullOrEmpty(preset.Description))
        {
            column.Children.Add(new TextBlock
            {
                Text = preset.Description,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        column.Children.Add(new TextBlock
        {
            Text = preset.Template,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
            Foreground = DisplayTokens.Accent,
            TextWrapping = TextWrapping.Wrap,
        });

        var card = new Button
        {
            Content = column,
            Background = Transparent(),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            DataContext = preset,
        };
        AutomationProperties.SetName(card, preset.AutomationName);
        card.Click += OnPresetCardClick;
        return card;
    }

    private void OnPresetCardClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: MessagePreset preset })
        {
            _viewModel.ApplyPreset(preset);
        }
    }

    private static TextBlock MutedText(string text) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
    };

    private static Border MutedNote(string text) => new()
    {
        Padding = new Thickness(8, 6, 8, 6),
        Child = MutedText(text),
    };

    private static TextBlock CenteredNote(string text)
    {
        var block = MutedText(text);
        block.HorizontalAlignment = HorizontalAlignment.Center;
        block.TextAlignment = TextAlignment.Center;
        block.Margin = new Thickness(0, 12, 0, 12);
        return block;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
