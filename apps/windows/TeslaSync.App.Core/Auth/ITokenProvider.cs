namespace TeslaSync.App.Core.Auth;

/// <summary>
/// The seam the networking layer uses to attach and renew bearer credentials.
/// <see cref="AuthService.AsTokenProvider"/> implements it over the auth state
/// machine: <see cref="GetTokenAsync"/> attaches the current access token (refreshing
/// proactively when near expiry) and <see cref="OnUnauthorizedAsync"/> performs a
/// single-flight refresh after a <c>401 Unauthorized</c>. SSE clients (W6) call the
/// same contract to obtain a refreshed token and reconnect after a 401.
/// </summary>
public interface ITokenProvider
{
    /// <summary>The current access token (refreshed if near expiry), or <see langword="null"/> when signed out.</summary>
    Task<string?> GetTokenAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Invoked after a request fails with <c>401 Unauthorized</c>. <paramref name="failedToken"/>
    /// is the bearer that 401'd. Returns <see langword="true"/> when a valid token is
    /// now available (so the caller may retry once), <see langword="false"/> otherwise.
    /// </summary>
    Task<bool> OnUnauthorizedAsync(string? failedToken, CancellationToken cancellationToken = default);
}
