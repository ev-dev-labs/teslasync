using Microsoft.UI.Dispatching;
using Microsoft.UI.Input;
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
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;
using Windows.UI.Core;
using VirtualKey = Windows.System.VirtualKey;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>ChatbotPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/ChatbotPage.tsx</c> (route <c>/chatbot</c>, nav name <c>Chatbot</c>). It binds
/// to a <see cref="ChatbotPageViewModel"/> and renders every web region with Fluent components and design tokens:
/// the page header (web <c>PageContainer title/subtitle</c> + the <c>History</c> toggle action); the optional
/// History sidebar (web <c>SessionList</c> — New Chat plus one row per session with inline rename + delete); the
/// conversation panel (GlassPanel1) whose body switches across the loading skeleton, the failure surface
/// (<see cref="TsQueryError"/> + Retry), the empty "How can Helix help you?" welcome (the Helix mark, the framing
/// copy and the <c>SuggestedPrompts</c> strip) and the populated message list (each row a shared
/// <c>ChatMessageItem</c>); the "Helix is thinking…" indicator (GlassPanel2, the in-button <c>AIThinkingDots</c>);
/// and the composer (a multi-line <see cref="TsTextarea"/> with Enter-to-send / Shift+Enter-newline plus the
/// Send / Stop button). The view is a thin renderer: all branch selection, projection and i18n happen in the
/// view-model's <see cref="ChatbotDisplay"/> projection; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ChatbotPage : UserControl, IDisposable
{
    private const double SidebarWidth = 288;       // web w-72
    private const double Gutter = 16;              // web gap-4
    private const string HistoryGlyph = "\uE81C";  // History
    private const string NewChatGlyph = "\uE710";  // Add
    private const string SendGlyph = "\uE724";     // Send
    private const string StopGlyph = "\uE71A";     // Stop
    private const string RenameGlyph = "\uE70F";   // Edit
    private const string DeleteGlyph = "\uE74D";   // Delete
    private const string HelixGlyph = "\uE99A";    // Robot — the Helix mark

    private readonly ChatbotPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _opened;
    private bool _suppressInputSync;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _historyButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = HistoryGlyph,
    };

    // History sidebar (web SessionList).
    private readonly TsGlassPanel _sessionsPanel = new() { Padding = new Thickness(12) };
    private readonly TsButton _newChatButton = new()
    {
        Variant = ButtonVariant.Outline,
        Size = ControlSize.Small,
        IconGlyph = NewChatGlyph,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };
    private readonly StackPanel _sessionsList = new() { Spacing = 4 };
    private readonly TsEmptyState _sessionsEmpty = new() { IconGlyph = "\uE8BD" };

    // Conversation panel (GlassPanel1).
    private readonly TsGlassPanel _conversationPanel = new() { Padding = new Thickness(0) };
    private readonly StackPanel _loadingHost = new() { Spacing = 12, Padding = new Thickness(16) };
    private readonly TsQueryError _errorState = new();
    private readonly StackPanel _emptyHost = new()
    {
        Spacing = 16,
        Padding = new Thickness(24),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly TextBlock _howCanIHelp = new()
    {
        FontSize = 18,
        FontWeight = FontWeights.SemiBold,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };
    private readonly TextBlock _askAbout = new()
    {
        FontSize = 14,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };
    private readonly SuggestedPrompts _suggestedPrompts;
    private readonly ScrollViewer _messagesScroll = new()
    {
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        Padding = new Thickness(16),
    };
    private readonly StackPanel _messagesStack = new() { Spacing = 12 };

    // Thinking indicator (GlassPanel2).
    private readonly TsGlassPanel _thinkingPanel = new()
    {
        Padding = new Thickness(12),
        Margin = new Thickness(16, 0, 16, 8),
        HorizontalAlignment = HorizontalAlignment.Left,
        Visibility = Visibility.Collapsed,
    };
    private readonly AIThinkingDots _thinkingDots = new();

    // Composer (web Textarea + Send/Stop button).
    private readonly TsTextarea _composer = new()
    {
        AcceptsReturn = true,
        MinHeight = 40,
        MaxHeight = 160,
        TextWrapping = TextWrapping.Wrap,
    };
    private readonly TsButton _sendButton = new()
    {
        Variant = ButtonVariant.Primary,
        IconGlyph = SendGlyph,
    };
    private readonly TsButton _stopButton = new()
    {
        Variant = ButtonVariant.Secondary,
        IconGlyph = StopGlyph,
        Visibility = Visibility.Collapsed,
    };

    private Grid? _bodyGrid;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public ChatbotPage()
        : this(EmptyChatbotFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The chatbot conversation + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ChatbotPage(IChatbotFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new ChatbotPageViewModel(feed, localizer);
        _suggestedPrompts = new SuggestedPrompts(localizer);

        Content = BuildLayout();

        _historyButton.Click += OnHistoryToggle;
        _newChatButton.Click += OnNewChat;
        _sendButton.Click += OnSendClick;
        _stopButton.Click += OnStopClick;
        _composer.KeyDown += OnComposerKeyDown;
        _composer.TextChanged += OnComposerTextChanged;
        _suggestedPrompts.PromptPicked += OnPromptPicked;
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ChatbotPage</c>).</summary>
    public static string Slug => ChatbotRegistration.Slug;

    private Grid BuildLayout()
    {
        var root = new Grid { Padding = new Thickness(24), RowSpacing = 16 };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var header = BuildHeader();
        Grid.SetRow(header, 0);
        root.Children.Add(header);

        var body = BuildBody();
        Grid.SetRow(body, 1);
        root.Children.Add(body);

        return root;
    }

    private Grid BuildHeader()
    {
        _subtitle.Foreground = DisplayTokens.TextSecondary;

        var headings = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        headings.Children.Add(_title);
        headings.Children.Add(_subtitle);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(headings, 0);
        Grid.SetColumn(_historyButton, 1);
        _historyButton.VerticalAlignment = VerticalAlignment.Top;
        header.Children.Add(headings);
        header.Children.Add(_historyButton);
        return header;
    }

    private Grid BuildBody()
    {
        BuildSessionsSidebar();
        BuildConversationPanel();

        var body = new Grid { ColumnSpacing = Gutter };
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid.SetColumn(_sessionsPanel, 0);
        Grid.SetColumn(_conversationPanel, 1);
        body.Children.Add(_sessionsPanel);
        body.Children.Add(_conversationPanel);
        _bodyGrid = body;
        return body;
    }

    private void BuildSessionsSidebar()
    {
        _sessionsPanel.Width = SidebarWidth;
        _sessionsPanel.Visibility = Visibility.Collapsed;

        var stack = new Grid { RowSpacing = 12 };
        stack.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        stack.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        Grid.SetRow(_newChatButton, 0);
        stack.Children.Add(_newChatButton);

        var listScroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = _sessionsList,
        };
        Grid.SetRow(listScroll, 1);
        stack.Children.Add(listScroll);

        AutomationProperties.SetLandmarkType(_sessionsPanel, AutomationLandmarkType.Navigation);
        _sessionsPanel.Content = stack;
    }

    private void BuildConversationPanel()
    {
        // Loading skeleton — a few shimmer bubbles (web ChatMessageItem loading rows).
        for (var i = 0; i < 3; i++)
        {
            _loadingHost.Children.Add(new TsSkeleton
            {
                BlockHeight = 44,
                BlockWidth = i % 2 == 0 ? 280 : 220,
                HorizontalAlignment = i % 2 == 0 ? HorizontalAlignment.Left : HorizontalAlignment.Right,
            });
        }

        _errorState.Visibility = Visibility.Collapsed;
        _errorState.Title = _localizer.GetString("chatbot.error.title", "Couldn't load the conversation");
        _errorState.Message = _localizer.GetString(
            "chatbot.error.message",
            "Something went wrong loading your chat history. Please try again.");
        _errorState.ActionText = _localizer.GetString("common.retry", "Retry");
        _loadingHost.Visibility = Visibility.Collapsed;

        // Empty welcome (web messages.length === 0 surface).
        _howCanIHelp.Foreground = DisplayTokens.TextPrimary;
        _askAbout.Foreground = DisplayTokens.TextSecondary;

        var helixMark = new Border
        {
            Width = 64,
            Height = 64,
            CornerRadius = new CornerRadius(32),
            Background = AccentTint(0.12),
            BorderBrush = AccentTint(0.30),
            BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = new FontIcon { Glyph = HelixGlyph, FontSize = 28, Foreground = DisplayTokens.Accent },
        };
        AutomationProperties.SetAccessibilityView(helixMark, AccessibilityView.Raw);

        var copy = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        copy.Children.Add(_howCanIHelp);
        copy.Children.Add(_askAbout);

        _emptyHost.Children.Add(helixMark);
        _emptyHost.Children.Add(copy);
        _emptyHost.Children.Add(_suggestedPrompts);

        // Message list (web messages.map → ChatMessageItem).
        _messagesScroll.Content = _messagesStack;
        _messagesScroll.Visibility = Visibility.Collapsed;

        var conversationHost = new Grid();
        conversationHost.Children.Add(_loadingHost);
        conversationHost.Children.Add(_errorState);
        conversationHost.Children.Add(_emptyHost);
        conversationHost.Children.Add(_messagesScroll);
        AutomationProperties.SetName(conversationHost, _viewModel.Display.ConversationLabel);
        AutomationProperties.SetLiveSetting(conversationHost, AutomationLiveSetting.Polite);

        _thinkingPanel.Content = _thinkingDots;

        var composer = BuildComposer();

        var panelGrid = new Grid();
        panelGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        panelGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        panelGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(conversationHost, 0);
        Grid.SetRow(_thinkingPanel, 1);
        Grid.SetRow(composer, 2);
        panelGrid.Children.Add(conversationHost);
        panelGrid.Children.Add(_thinkingPanel);
        panelGrid.Children.Add(composer);

        _conversationPanel.Content = panelGrid;
    }

    private Border BuildComposer()
    {
        var border = new Border
        {
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = DisplayTokens.Brush("TsColorBorderBrush"),
            Padding = new Thickness(16),
        };

        var row = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Bottom };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_composer, 0);
        var sendStop = new Grid { VerticalAlignment = VerticalAlignment.Bottom };
        sendStop.Children.Add(_sendButton);
        sendStop.Children.Add(_stopButton);
        Grid.SetColumn(sendStop, 1);

        row.Children.Add(_composer);
        row.Children.Add(sendStop);
        border.Child = row;
        return border;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from the view-model and control events (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _historyButton.Click -= OnHistoryToggle;
        _newChatButton.Click -= OnNewChat;
        _sendButton.Click -= OnSendClick;
        _stopButton.Click -= OnStopClick;
        _composer.KeyDown -= OnComposerKeyDown;
        _composer.TextChanged -= OnComposerTextChanged;
        _suggestedPrompts.PromptPicked -= OnPromptPicked;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _suggestedPrompts.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(ChatbotDisplay display)
    {
        if (_disposed)
        {
            return;
        }

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.DocumentTitle);

        _historyButton.Text = display.HistoryLabel;
        AutomationProperties.SetName(_historyButton, display.HistoryLabel);

        _newChatButton.Text = display.NewChatLabel;
        AutomationProperties.SetName(_newChatButton, display.NewChatLabel);

        _howCanIHelp.Text = display.HowCanIHelp;
        _askAbout.Text = display.AskAbout;
        _thinkingDots.Label = display.Thinking;

        _composer.Hint = display.InputHint;
        AutomationProperties.SetName(_composer, display.InputLabel);

        _sendButton.Visibility = _viewModel.IsSending ? Visibility.Collapsed : Visibility.Visible;
        _sendButton.IsEnabled = !_viewModel.IsSending && !string.IsNullOrWhiteSpace(_composer.Text);
        AutomationProperties.SetName(_sendButton, display.SendLabel);

        _stopButton.Visibility = _viewModel.IsSending ? Visibility.Visible : Visibility.Collapsed;
        _stopButton.Text = display.StopLabel;
        AutomationProperties.SetName(_stopButton, display.StopStreamingLabel);
        ToolTipService.SetToolTip(_stopButton, display.StopHint);

        _thinkingPanel.Visibility = _viewModel.IsSending ? Visibility.Visible : Visibility.Collapsed;
        _sessionsPanel.Visibility = _viewModel.ShowSessions ? Visibility.Visible : Visibility.Collapsed;
        _sessionsEmpty.Message = display.EmptySessionsLabel;

        RenderConversationState(display);
        RenderSessions(display);
        RenderMessages(display);
    }

    private void RenderConversationState(ChatbotDisplay display)
    {
        _loadingHost.Visibility = display.State == ChatbotState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _errorState.Visibility = display.State == ChatbotState.Error ? Visibility.Visible : Visibility.Collapsed;
        _emptyHost.Visibility = display.State == ChatbotState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _messagesScroll.Visibility = display.State == ChatbotState.Success ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderSessions(ChatbotDisplay display)
    {
        _sessionsList.Children.Clear();
        if (!display.HasSessions)
        {
            _sessionsList.Children.Add(_sessionsEmpty);
            return;
        }

        foreach (var session in display.Sessions)
        {
            _sessionsList.Children.Add(BuildSessionRow(session, display));
        }
    }

    private Grid BuildSessionRow(ChatSessionItem session, ChatbotDisplay display)
    {
        var titleText = new TextBlock
        {
            Text = session.Title,
            FontSize = 13,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            Foreground = session.IsActive ? DisplayTokens.TextPrimary : DisplayTokens.TextSecondary,
        };
        var countText = new TextBlock
        {
            Text = session.MessageCountLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
        };
        var stack = new StackPanel { Spacing = 1 };
        stack.Children.Add(titleText);
        stack.Children.Add(countText);

        var select = new TsButton
        {
            Variant = session.IsActive ? ButtonVariant.Subtle : ButtonVariant.Icon,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Content = stack,
        };
        AutomationProperties.SetName(select, session.AutomationName);
        var id = session.Id;
        select.Click += (_, _) => OnSelectSession(id);

        var rename = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = RenameGlyph,
        };
        AutomationProperties.SetName(rename, $"{display.HistoryLabel}: {session.Title}");
        var renameTitle = session.Title;
        rename.Click += (_, _) => _ = ShowRenameDialogAsync(id, renameTitle);

        var delete = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = DeleteGlyph,
        };
        AutomationProperties.SetName(delete, session.Title);
        delete.Click += (_, _) => _ = ConfirmDeleteAsync(id);

        var row = new Grid { ColumnSpacing = 4 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(select, 0);
        Grid.SetColumn(rename, 1);
        Grid.SetColumn(delete, 2);
        row.Children.Add(select);
        row.Children.Add(rename);
        row.Children.Add(delete);
        return row;
    }

    private void RenderMessages(ChatbotDisplay display)
    {
        _messagesStack.Children.Clear();
        foreach (var model in display.Messages)
        {
            var item = new ChatMessageItem(_localizer, model);
            item.RegenerateRequested += OnRegenerate;
            item.EditAndResendRequested += OnEditAndResend;
            item.RetryRequested += OnRetryInvoked;
            _messagesStack.Children.Add(item);
        }

        if (display.State == ChatbotState.Success)
        {
            ScrollMessagesToEnd();
        }
    }

    private void ScrollMessagesToEnd()
    {
        _messagesScroll.UpdateLayout();
        _messagesScroll.ChangeView(null, _messagesScroll.ScrollableHeight, null, disableAnimation: true);
    }

    // ── Event handlers ──────────────────────────────────────────────────────────────────────────────────────

    private void OnHistoryToggle(object sender, RoutedEventArgs e) => _viewModel.ToggleHistory();

    private void OnNewChat(object sender, RoutedEventArgs e)
    {
        _viewModel.StartNewSession();
        SetComposerText(string.Empty);
        _composer.Focus(FocusState.Programmatic);
    }

    private void OnSendClick(object sender, RoutedEventArgs e) => SubmitComposer();

    private void OnStopClick(object sender, RoutedEventArgs e) => _viewModel.CancelSend();

    private void OnComposerKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter && !IsShiftDown())
        {
            e.Handled = true;
            SubmitComposer();
        }
    }

    private void OnComposerTextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressInputSync)
        {
            _viewModel.Input = _composer.Text;
        }

        _sendButton.IsEnabled = !_viewModel.IsSending && !string.IsNullOrWhiteSpace(_composer.Text);
    }

    private void OnPromptPicked(object? sender, string prompt)
    {
        SetComposerText(prompt);
        _composer.Focus(FocusState.Programmatic);
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnRegenerate(object? sender, EventArgs e)
    {
        var lastUser = LastUserContent();
        if (!string.IsNullOrWhiteSpace(lastUser))
        {
            _ = _viewModel.SendMessageAsync(lastUser);
        }
    }

    private void OnEditAndResend(object? sender, ChatMessageEditRequestedEventArgs e) =>
        _ = _viewModel.SendMessageAsync(e.NewText);

    private void OnSelectSession(string sessionId)
    {
        _ = _viewModel.LoadSessionAsync(sessionId);
    }

    private void SubmitComposer()
    {
        var text = _composer.Text;
        if (string.IsNullOrWhiteSpace(text) || _viewModel.IsSending)
        {
            return;
        }

        SetComposerText(string.Empty);
        _ = _viewModel.SendMessageAsync(text);
    }

    private async Task ShowRenameDialogAsync(string sessionId, string currentTitle)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var input = new TsTextarea
        {
            AcceptsReturn = false,
            Text = currentTitle,
            MinHeight = 40,
        };
        AutomationProperties.SetName(input, _localizer.GetString(
            ChatbotRegistration.RenameSessionKey, ChatbotRegistration.RenameSessionDefault));

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = _localizer.GetString(ChatbotRegistration.RenameSessionKey, ChatbotRegistration.RenameSessionDefault),
            Content = input,
            PrimaryButtonText = _localizer.GetString(ChatbotRegistration.SendKey, ChatbotRegistration.SendDefault),
            CloseButtonText = _localizer.GetString("chatbot.actions.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Primary,
        };

        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            await _viewModel.RenameSessionAsync(sessionId, input.Text ?? string.Empty);
        }
    }

    private async Task ConfirmDeleteAsync(string sessionId)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = _localizer.GetString("chatbot.delete.title", "Delete conversation?"),
            Content = _localizer.GetString(
                "chatbot.delete.message",
                "This will permanently remove this conversation and all its messages."),
            PrimaryButtonText = _localizer.GetString("chatbot.delete.confirm", "Delete"),
            CloseButtonText = _localizer.GetString("chatbot.actions.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Close,
        };

        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            await _viewModel.DeleteSessionAsync(sessionId);
        }
    }

    private string? LastUserContent()
    {
        for (var i = _viewModel.Display.Messages.Count - 1; i >= 0; i--)
        {
            var message = _viewModel.Display.Messages[i].Message;
            if (message?.Role == ChatRole.User)
            {
                return message.Content;
            }
        }

        return null;
    }

    private void SetComposerText(string text)
    {
        _suppressInputSync = true;
        _composer.Text = text;
        _suppressInputSync = false;
        _viewModel.Input = text;
        _sendButton.IsEnabled = !_viewModel.IsSending && !string.IsNullOrWhiteSpace(text);
    }

    private static bool IsShiftDown() =>
        InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(CoreVirtualKeyStates.Down);

    private static Brush AccentTint(double opacity)
    {
        if (DisplayTokens.Accent is SolidColorBrush solid)
        {
            var color = solid.Color;
            color.A = (byte)Math.Clamp(opacity * 255, 0, 255);
            return new SolidColorBrush(color);
        }

        return DisplayTokens.Accent;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ChatbotPageAutomationPeer(this);

    private sealed class ChatbotPageAutomationPeer(ChatbotPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
