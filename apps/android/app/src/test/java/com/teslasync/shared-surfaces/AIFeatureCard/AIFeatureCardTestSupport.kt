// Shared off-device test fixtures for the AIFeatureCard surface (the :android:testReleaseUnitTest gate): a
// recording [Logger] that captures the PII-safe `view.opened`/lifecycle events, and two [AiFeatureCardStreamSource]
// fakes — a scripted source that emits a fixed sequence then completes (terminal-state assertions) and a
// channel-backed source that stays open until closed (transient-state assertions). Co-located with the surface's
// tests so both the model and view-model tests reuse one set of fakes.
//
// `InvalidPackageDeclaration` is suppressed: the fixtures mirror the surface's mandated package, which cannot
// match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeaturecard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow

/** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
internal class RecordingLogger : Logger {
    val events = mutableListOf<Pair<String, Map<String, String>>>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        events += event to fields
    }
}

/** Emits a scripted [AiStreamEvent] sequence then completes — the common terminal-state fake. */
internal class ScriptedSource(
    private val events: List<AiStreamEvent>,
) : AiFeatureCardStreamSource {
    var calls = 0

    override fun open(): Flow<AiStreamEvent> {
        calls++
        return flow { events.forEach { emit(it) } }
    }
}

/** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
internal class ManualSource : AiFeatureCardStreamSource {
    val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
    var calls = 0

    override fun open(): Flow<AiStreamEvent> {
        calls++
        return channel.receiveAsFlow()
    }
}
