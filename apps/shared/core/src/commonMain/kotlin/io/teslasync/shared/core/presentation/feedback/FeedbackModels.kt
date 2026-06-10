package io.teslasync.shared.core.presentation.feedback

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * One persisted in-app feedback row — the cross-platform port of the web `FeedbackEntry`
 * interface (web/src/api/types.ts), itself mirroring the Go `dbuser.UserFeedback` struct
 * (internal/database/user/feedback_repo.go). Keys arrive snake_case from `POST /feedback`
 * (the created row) and `GET|PATCH /admin/feedback`; they are matched verbatim via [SerialName]
 * so a cached payload round-trips unchanged.
 *
 * Only [id], [createdAt], [category], [title], [body], and [status] are guaranteed by the
 * server; every other column is `omitempty` on the Go side, so each defaults to `""`/`null`
 * and a sparse row still decodes. [recentErrors] is an opaque JSON blob (`json.RawMessage` on
 * the wire, `unknown` on web) carried as a [JsonElement] so it round-trips shape-preserving
 * without imposing a schema. No field is unit-bearing, so there is no SI conversion at this
 * layer — display formatting is the render boundary's job (S5).
 */
@Serializable
public data class FeedbackEntry(
    val id: Long,
    @SerialName("created_at") val createdAt: String,
    val category: String,
    val title: String,
    val body: String,
    @SerialName("page_route") val pageRoute: String = "",
    @SerialName("user_agent") val userAgent: String = "",
    @SerialName("app_version") val appVersion: String = "",
    @SerialName("user_email") val userEmail: String = "",
    @SerialName("recent_errors") val recentErrors: JsonElement? = null,
    @SerialName("console_tail") val consoleTail: String = "",
    val status: String,
    @SerialName("github_issue_url") val githubIssueUrl: String = "",
    @SerialName("submitter_subject") val submitterSubject: String = "",
    @SerialName("submitter_ip") val submitterIp: String = "",
    @SerialName("triaged_at") val triagedAt: String? = null,
    @SerialName("triaged_by") val triagedBy: String = "",
)

/**
 * The admin feedback-queue page response — the port of the web `FeedbackListResponse` interface,
 * mirroring the Go `adminFeedbackListResponse` (internal/api/adminfeedback/handler.go). The
 * server echoes the [limit]/[offset] it actually applied and reports whether the optional GitHub
 * Issues bridge is wired ([githubBridgeEnabled]) so a screen can hide the "Forward to GitHub"
 * action; [githubRepo] is `omitempty` and only present when the bridge is configured.
 */
@Serializable
public data class FeedbackListResponse(
    val items: List<FeedbackEntry> = emptyList(),
    val total: Long = 0,
    val limit: Int = 0,
    val offset: Int = 0,
    @SerialName("github_bridge_enabled") val githubBridgeEnabled: Boolean = false,
    @SerialName("github_repo") val githubRepo: String? = null,
)

/**
 * The `POST /feedback` body — the port of the web `FeedbackSubmitInput`. [category], [title],
 * and [body] are required by the server; every other field is optional and is only carried on
 * the wire when supplied (a null field is dropped, mirroring `JSON.stringify` dropping an
 * `undefined` key — note an explicit empty string IS sent, exactly as the web object literal
 * would carry `''`). [recentErrors] is the same opaque JSON blob as on [FeedbackEntry].
 */
public data class FeedbackSubmitInput(
    val category: String,
    val title: String,
    val body: String,
    val pageRoute: String? = null,
    val userAgent: String? = null,
    val appVersion: String? = null,
    val userEmail: String? = null,
    val recentErrors: JsonElement? = null,
    val consoleTail: String? = null,
)

/**
 * The `PATCH /admin/feedback/{id}` body — the port of the web `FeedbackUpdateInput`. Every
 * field is optional so a partial patch only sends what changed (a null field is dropped,
 * mirroring `JSON.stringify(update)` over a partial object); [forwardToGithub] is only emitted
 * when set, so a plain status change never asks the server to mint a GitHub issue.
 *
 * @property id the feedback row to patch (carried in the path, not the body).
 */
public data class FeedbackUpdateInput(
    val id: Long,
    val status: String? = null,
    val githubIssueUrl: String? = null,
    val forwardToGithub: Boolean? = null,
)

/**
 * The optional filter for the admin feedback queue — the port of the web `FeedbackListParams`.
 * Every field is optional; [status]/[category] narrow the queue and [limit]/[offset] page it.
 * A blank (`""`) status/category means "no filter" (the web `buildQuery` truthy guard), which
 * is why those fields are plain strings rather than an enum — the web type admits `''`.
 *
 * @property status restrict to `new`/`triaged`/`closed`; null or `""` lists every status.
 * @property category restrict to `bug`/`feature`/`other`; null or `""` lists every category.
 * @property limit page size; null omits it (the server applies its own default).
 * @property offset page offset; null omits it.
 */
public data class FeedbackListParams(
    val status: String? = null,
    val category: String? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)
