// Notifications / Webhooks page — default data port for the embedded section.
//
// The web WebhooksPage renders <WebhookChannelsSection /> with no props; the
// section composes its own data through the useWebhookChannels() hooks. The native
// section takes its IWebhookChannelsSource explicitly, so — exactly like every
// other shell-registered W7 page (EnergyPage, WeeklyDigestPage, …) — the
// parameterless page hands the section an inert default source. The section still
// renders all of its states (its empty surface shows for an empty list); a host /
// test that wants live data constructs the page with a repository-backed source.
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Threading;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The default inert <see cref="IWebhookChannelsSource"/> — yields a single empty webhook list and treats every
/// mutation/utility as a no-op. It is the safe default the shell-registered <see cref="WebhooksPage"/> feeds the
/// embedded <see cref="WebhookChannelsSection"/> until a host wires the repository-backed
/// <see cref="WebhookChannelsSource"/>, mirroring the empty-source default the other W7 pages use. The section's
/// own empty surface renders from the single <see cref="RepositoryResult{T}.Empty()"/> emission.
/// </summary>
public sealed class EmptyWebhookChannelsSource : IWebhookChannelsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyWebhookChannelsSource Instance { get; } = new();

    private EmptyWebhookChannelsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WebhookChannelList>> StreamWebhooksAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<WebhookChannelList>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task ToggleAsync(long id, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task<WebhookTestResult> TestWebhookAsync(long id, CancellationToken cancellationToken = default) =>
        Task.FromResult(WebhookTestResult.Failure(string.Empty));

    /// <inheritdoc />
    public Task<string> PreviewSignatureAsync(string secret, string body, CancellationToken cancellationToken = default) =>
        Task.FromResult(string.Empty);
}
