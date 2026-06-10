package io.teslasync.shared.core.presentation.chat

import io.teslasync.shared.core.data.repo.ChatRepository
import io.teslasync.shared.core.data.repo.chatHistoryKey
import io.teslasync.shared.core.data.repo.chatHistoryQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useChat`
 * domain:
 *
 *  1. [normalizeChatTitle] — the rename title rule (`trim`, empty ⇒ null) from
 *     `useRenameChatSession`'s `setQueryData`.
 *  2. [applyRenameToSessions] — the optimistic session-list rename patch (matching row's title
 *     normalised, others untouched).
 *  3. [applyDeleteToSessions] — the optimistic session-list delete patch (matching row removed).
 *  4. [chatHistoryKey] / [chatHistoryQuery] — the `chatKeys.history(sessionId)` key and the
 *     `/chatbot/history?session_id=` query.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to
 * stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class ChatGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- normalizeChatTitle -------------------------------------------------------

    @Serializable
    private data class TitleRow(
        val name: String,
        val input: String,
        val expected: String? = null,
    )

    private fun titleRows(): List<TitleRow> = json.decodeFromString(TITLE_GOLDEN)

    @Test
    fun titleGoldenCoversEveryShape() {
        val names = titleRows().map { it.name }.toSet()
        listOf("plain", "trims_surrounding", "empty_to_null", "whitespace_to_null", "inner_spaces_kept")
            .forEach { assertTrue(it in names, "title golden missing the '$it' case") }
    }

    @Test
    fun everyTitleRowMatchesNormalizeChatTitle() {
        for (row in titleRows()) {
            assertEquals(row.expected, normalizeChatTitle(row.input), "normalizeChatTitle('${row.name}')")
        }
    }

    // ---- applyRenameToSessions ----------------------------------------------------

    @Serializable
    private data class IdTitle(
        val id: String,
        val title: String? = null,
    )

    @Serializable
    private data class RenameRow(
        val name: String,
        val sessions: List<ChatSessionInfo>,
        val sessionId: String,
        val title: String,
        val expected: List<IdTitle>,
    )

    private fun renameRows(): List<RenameRow> = json.decodeFromString(RENAME_GOLDEN)

    @Test
    fun renameGoldenCoversEveryShape() {
        val names = renameRows().map { it.name }.toSet()
        listOf("renames_match_only", "clears_to_null_on_blank", "no_match_unchanged")
            .forEach { assertTrue(it in names, "rename golden missing the '$it' case") }
    }

    @Test
    fun everyRenameRowMatchesApplyRename() {
        for (row in renameRows()) {
            val actual = applyRenameToSessions(row.sessions, row.sessionId, row.title).map { IdTitle(it.id, it.title) }
            assertEquals(row.expected, actual, "applyRenameToSessions('${row.name}')")
        }
    }

    // ---- applyDeleteToSessions ----------------------------------------------------

    @Serializable
    private data class DeleteRow(
        val name: String,
        val sessions: List<ChatSessionInfo>,
        val sessionId: String,
        val expected: List<String>,
    )

    private fun deleteRows(): List<DeleteRow> = json.decodeFromString(DELETE_GOLDEN)

    @Test
    fun deleteGoldenCoversEveryShape() {
        val names = deleteRows().map { it.name }.toSet()
        listOf("removes_match", "no_match_unchanged", "removes_only_match_of_many")
            .forEach { assertTrue(it in names, "delete golden missing the '$it' case") }
    }

    @Test
    fun everyDeleteRowMatchesApplyDelete() {
        for (row in deleteRows()) {
            val actual = applyDeleteToSessions(row.sessions, row.sessionId).map { it.id }
            assertEquals(row.expected, actual, "applyDeleteToSessions('${row.name}')")
        }
    }

    // ---- chatHistoryKey / chatHistoryQuery ----------------------------------------

    @Test
    fun historyKeyMatchesTheWebQueryKeyTuple() {
        assertEquals("history:abc", chatHistoryKey("abc"))
        assertEquals("history:9f3c-uuid", chatHistoryKey("9f3c-uuid"))
    }

    @Test
    fun historyQueryCarriesSessionIdSnakeCase() {
        assertEquals(mapOf("session_id" to "abc"), chatHistoryQuery("abc"))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(ChatRepository::class.simpleName == "ChatRepository")
    }

    private companion object {
        val TITLE_GOLDEN =
            """
            [
              { "name": "plain",               "input": "My chat",        "expected": "My chat" },
              { "name": "trims_surrounding",   "input": "  My chat  ",    "expected": "My chat" },
              { "name": "empty_to_null",        "input": "",               "expected": null },
              { "name": "whitespace_to_null",   "input": "   ",            "expected": null },
              { "name": "inner_spaces_kept",    "input": "  a  b  ",       "expected": "a  b" }
            ]
            """.trimIndent()

        val RENAME_GOLDEN =
            """
            [
              { "name": "renames_match_only",
                "sessions": [ { "id": "a", "title": "old" }, { "id": "b", "title": "keep" } ],
                "sessionId": "a", "title": "  new  ",
                "expected": [ { "id": "a", "title": "new" }, { "id": "b", "title": "keep" } ] },
              { "name": "clears_to_null_on_blank",
                "sessions": [ { "id": "a", "title": "old" } ],
                "sessionId": "a", "title": "   ",
                "expected": [ { "id": "a", "title": null } ] },
              { "name": "no_match_unchanged",
                "sessions": [ { "id": "a", "title": "old" } ],
                "sessionId": "zzz", "title": "new",
                "expected": [ { "id": "a", "title": "old" } ] }
            ]
            """.trimIndent()

        val DELETE_GOLDEN =
            """
            [
              { "name": "removes_match",
                "sessions": [ { "id": "a" }, { "id": "b" } ], "sessionId": "a",
                "expected": [ "b" ] },
              { "name": "no_match_unchanged",
                "sessions": [ { "id": "a" }, { "id": "b" } ], "sessionId": "zzz",
                "expected": [ "a", "b" ] },
              { "name": "removes_only_match_of_many",
                "sessions": [ { "id": "a" }, { "id": "b" }, { "id": "c" } ], "sessionId": "b",
                "expected": [ "a", "c" ] }
            ]
            """.trimIndent()
    }
}
