using TeslaSync.App.Core.Auth;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// A test <see cref="ITokenProvider"/>. It hands out an initial token, counts refresh
/// requests, and can rotate to a second token after a <c>401</c> so the auth
/// retry-propagation path can be asserted without the real auth state machine.
/// </summary>
internal sealed class FakeTokenProvider : ITokenProvider
{
    private string? _token;
    private readonly string? _refreshedToken;

    public FakeTokenProvider(string? token, string? refreshedToken = null)
    {
        _token = token;
        _refreshedToken = refreshedToken;
    }

    public int RefreshCount { get; private set; }

    public Task<string?> GetTokenAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_token);

    public Task<bool> OnUnauthorizedAsync(string? failedToken, CancellationToken cancellationToken = default)
    {
        RefreshCount++;
        if (_refreshedToken is null)
        {
            return Task.FromResult(false);
        }

        _token = _refreshedToken;
        return Task.FromResult(true);
    }
}
