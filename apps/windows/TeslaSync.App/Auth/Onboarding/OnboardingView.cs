using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Shell;

namespace TeslaSync.App.Auth.Onboarding;

/// <summary>
/// The onboarding / sign-in surface (route <c>onboarding</c>, public). Renders the
/// pre-auth call to action and drives the interactive OIDC PKCE sign-in through
/// <see cref="AppAuth.Service"/>, reflecting every <see cref="AuthState"/> transition:
/// idle, signing-in (loading), failure (error + retry) and signed-in (with sign-out).
/// State changes are marshalled onto the UI thread; the page never renders authenticated
/// content while signed out.
/// </summary>
public sealed partial class OnboardingView : UserControl
{
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly AuthService _auth = AppAuth.Service;

    private readonly StackPanel _signInPanel;
    private readonly StackPanel _signedInPanel;
    private readonly TsButton _signInButton;
    private readonly TsButton _signOutButton;
    private readonly ErrorText _error;
    private readonly Text _signInSubtitle;

    public OnboardingView()
    {
        _signInButton = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Large,
            IconGlyph = "\uE77B",
            Text = L("onboarding.signIn", "Sign in"),
        };
        _signInButton.Click += OnSignInClick;

        _error = new ErrorText { Visibility = Visibility.Collapsed };
        _signInSubtitle = new Text
        {
            Value = L("onboarding.subtitle", "Connect your TeslaSync account to view your fleet, drives and charging."),
        };

        _signInPanel = new StackPanel
        {
            Spacing = 16,
            MaxWidth = 420,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _signInPanel.Children.Add(new FontIcon { Glyph = "\uE804", FontSize = 40 });
        _signInPanel.Children.Add(new PageTitle { Value = L("onboarding.title", "Sign in to TeslaSync") });
        _signInPanel.Children.Add(_signInSubtitle);
        _signInPanel.Children.Add(_error);
        _signInPanel.Children.Add(_signInButton);

        _signOutButton = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Large,
            IconGlyph = "\uE7E8",
            Text = L("onboarding.signOut", "Sign out"),
        };
        _signOutButton.Click += OnSignOutClick;

        _signedInPanel = new StackPanel
        {
            Spacing = 16,
            MaxWidth = 420,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        _signedInPanel.Children.Add(new FontIcon { Glyph = "\uE73E", FontSize = 40 });
        _signedInPanel.Children.Add(new PageTitle { Value = L("onboarding.signedInTitle", "You're signed in") });
        _signedInPanel.Children.Add(new Text { Value = L("onboarding.signedInSubtitle", "Your session is active and secured.") });
        _signedInPanel.Children.Add(_signOutButton);

        var root = new Grid { Padding = new Thickness(24) };
        root.Children.Add(_signInPanel);
        root.Children.Add(_signedInPanel);
        Content = root;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render(_auth.State);
    }

    private static string L(string key, string fallback) => Localization.Get(key, fallback);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _auth.StateChanged += OnAuthStateChanged;
        Render(_auth.State);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => _auth.StateChanged -= OnAuthStateChanged;

    private void OnAuthStateChanged(object? sender, AuthState state)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(state);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(state));
        }
    }

    private void Render(AuthState state)
    {
        var signedIn = state.IsAuthenticated;
        _signedInPanel.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        _signInPanel.Visibility = signedIn ? Visibility.Collapsed : Visibility.Visible;

        var authenticating = state is AuthState.Authenticating;
        _signInButton.IsLoading = authenticating;
        _signInButton.Text = authenticating
            ? L("onboarding.signingIn", "Signing in…")
            : L("onboarding.signIn", "Sign in");

        if (state is AuthState.Failed)
        {
            _error.Value = L("onboarding.error", "Sign-in could not be completed. Please try again.");
            _error.Visibility = Visibility.Visible;
            _signInButton.Text = L("onboarding.retry", "Try again");
        }
        else
        {
            _error.Visibility = Visibility.Collapsed;
        }
    }

    private async void OnSignInClick(object sender, RoutedEventArgs e)
    {
        try
        {
            await _auth.SignInAsync().ConfigureAwait(true);
        }
        catch (AuthCanceledException)
        {
            // User dismissed the browser; fall back to the idle prompt.
            Render(_auth.State);
        }
        catch (AuthException)
        {
            // AuthService has already transitioned to Failed; Render shows the error.
        }
    }

    private async void OnSignOutClick(object sender, RoutedEventArgs e)
    {
        _signOutButton.IsLoading = true;
        try
        {
            await _auth.SignOutAsync().ConfigureAwait(true);
        }
        finally
        {
            _signOutButton.IsLoading = false;
        }
    }
}
