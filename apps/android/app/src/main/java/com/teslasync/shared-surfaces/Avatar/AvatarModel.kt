// Pure, framework-free model + projection + diagnostics for the Avatar shared surface — the native
// analogue of every value the web component derives (web/src/components/data-display/Avatar.tsx). No
// Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is a PRESENTATIONAL primitive, not a data-fetching view: it renders one of three visuals
// in priority order — an `src` image (falling back to initials/glyph on load error), deterministic
// two-letter initials on a colour hashed from the user id (or name) seed, or a generic glyph (a person for
// `kind="user"`, the Helix brand mark for `kind="bot"`) — plus an optional presence dot and an optional
// tooltip. Its only hook is `useTranslation`; the identity it renders is caller-supplied. Because there is
// no async cache-then-network feed behind it, the surface has no loading / error / stale / offline data
// lifecycle of its own — modelling those would fabricate behaviour the web spec does not have (the same
// rationale the accepted VisuallyHidden / AIChatbotIndicator ports document). The surface's REAL states are
// reproduced instead and every one renders (no hidden surface):
//   • image       — `src` present and loadable.
//   • initials    — an attributed name (the content state).
//   • glyph-user  — anonymous / id-only with `kind="user"`.
//   • glyph-bot   — the Helix mark for `kind="bot"` (the assistant identity).
//   • empty       — truly anonymous (no id, no name, no image) → the neutral glyph fallback.
//   • offline     — the offline presence dot (alongside online / idle), a live-status presentation.
// The four i18n strings the web source resolves (`avatar.unknown`, `avatar.statusOnline`,
// `avatar.statusIdle`, `avatar.statusOffline`) already exist in the P1/S10 catalog as
// `translation_avatar_*`; the view resolves them through `stringResource`, never an English literal.
//
// The colour palette is the Okabe-Ito colour-blind-safe palette (web `CHART_COLORS_CB_SAFE`), which on
// Android is the generated, index-stable `TeslaTokens.chart.categorical` token list (apps/design/tokens.json
// `chart.categorical` — the identical eight hues in the identical order). The seed → index mapping is the
// same djb2 hash the web uses, reproduced here so the same id/name renders the same hue cross-platform.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Avatar — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.avatar

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). It is the surface slug
 * the prompt mandates (`Avatar`) and carries no user id, name, or image URL, so a diagnostics line can never
 * leak who an avatar attributes to.
 */
const val AVATAR_SLUG: String = "Avatar"

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The number of hues in the Okabe-Ito colour-blind-safe palette (web `CHART_COLORS_CB_SAFE.length`). It MUST
 * equal `TeslaTokens.chart.categorical.size` — the generated palette the view indexes — so the seed → hue
 * mapping is identical to the web component. The view passes the live `categorical.size`; this default keeps
 * the pure model and its off-device tests pinned to the same eight-hue contract.
 */
const val OKABE_ITO_PALETTE_SIZE: Int = 8

private const val DJB2_SEED: Int = 5381
private const val DJB2_MULTIPLIER: Int = 33
private const val UNSIGNED_INT_MASK: Long = 0xFFFFFFFFL
private const val QUESTION_MARK: String = "?"
private const val MIN_NAME_PARTS: Int = 2
private const val INITIALS_MAX: Int = 2
private val WHITESPACE: Regex = Regex("\\s+")

/**
 * Size token — the native tag for the web `size` prop. Pixel sizes match the web (`xs=16, sm=24, md=32,
 * lg=48`), chosen to align with the icon-box sizes used in table rows (`sm`) and card headers (`md`).
 */
enum class AvatarSize(
    val px: Int,
) {
    Xs(16),
    Sm(24),
    Md(32),
    Lg(48),
}

/** Shape token — web `shape`. [Circle] is the default; [Rounded] matches the web `rounded-lg` corner. */
enum class AvatarShape {
    Circle,
    Rounded,
}

/**
 * Presence token — web `status`. Renders a small corner dot: green ([Online]) / amber ([Idle]) / neutral
 * grey ([Offline]). The dot carries its own accessible label so presence is announced alongside the name.
 */
enum class AvatarStatus {
    Online,
    Idle,
    Offline,
}

/**
 * Kind selector for the no-name fallback — web `kind`. [User] renders a generic person glyph; [Bot] renders
 * the Helix brand mark (the assistant slot the self-hosted single-user chatbot uses, since it has no display
 * name to attribute messages to).
 */
enum class AvatarKind {
    User,
    Bot,
}

/**
 * The caller-supplied identity the surface renders — the native analogue of the web component's data-derived
 * props (`userId`, `name`, `src`, `status`, `kind`). Presentation-only props (size, shape, tooltip) are not
 * identity and are passed to the composable directly. Every field is optional so the truly-anonymous avatar
 * (the chatbot's bot mark) is the zero value.
 */
data class AvatarIdentity(
    val userId: String? = null,
    val name: String? = null,
    val src: String? = null,
    val status: AvatarStatus? = null,
    val kind: AvatarKind = AvatarKind.User,
)

/**
 * The resolved visual the avatar renders, in the web's priority order. A closed set the view switches on so
 * every branch is exhaustively covered and unit-tested off-device.
 */
sealed interface AvatarContent {
    /** The `src` image is present and has not failed to load (web's first branch). */
    data class Image(
        val src: String,
    ) : AvatarContent

    /** Deterministic two-letter initials for an attributed name (web's second branch). */
    data class Initials(
        val text: String,
    ) : AvatarContent

    /** The generic glyph for an unnamed avatar — a person ([AvatarKind.User]) or the Helix mark
     * ([AvatarKind.Bot]) — web's third branch. */
    data class Glyph(
        val kind: AvatarKind,
    ) : AvatarContent
}

/**
 * The render-ready projection of an [AvatarIdentity]. [content] is the chosen visual; [attributed] is true
 * when there is something to attribute the avatar to (a name or a non-empty user id) — it gates the coloured
 * background versus the neutral surface (web's `isAttributed`); [colorIndex] is the palette index the seed
 * hashes to (used only when [attributed]).
 */
data class AvatarVisual(
    val content: AvatarContent,
    val attributed: Boolean,
    val colorIndex: Int,
)

/**
 * djb2 hash — small, deterministic, no dependencies; the exact port of the web `djb2` so the same seed maps
 * to the same palette hue cross-platform. Kotlin `Int` multiplication wraps modulo 2^32 (two's complement),
 * which equals JavaScript's `ToInt32(hash * 33)`, and the trailing mask reproduces the web `>>> 0` unsigned
 * coercion. Returns the unsigned 32-bit value widened to [Long].
 */
fun djb2(input: String): Long {
    var hash = DJB2_SEED
    for (index in input.indices) {
        hash = (hash * DJB2_MULTIPLIER) xor input[index].code
    }
    return hash.toLong() and UNSIGNED_INT_MASK
}

/**
 * Picks a palette index from [seed] (web `avatarColorIndex`): the djb2 hash modulo [paletteSize]. Total — a
 * non-positive [paletteSize] yields `0` rather than dividing by zero. Exported so the colour-stability
 * assertion can pin the mapping without re-deriving it.
 */
fun avatarColorIndex(
    seed: String,
    paletteSize: Int = OKABE_ITO_PALETTE_SIZE,
): Int = if (paletteSize <= 0) 0 else (djb2(seed) % paletteSize).toInt()

/**
 * Computes the visible initials for [name] (web `avatarInitials`): the first character of the first two
 * whitespace-separated words ("John Doe" → "JD"), or the first two characters of a single word ("Cher" →
 * "CH", "X" → "X"). Blank or null input returns "?" so the avatar never renders empty.
 */
fun avatarInitials(name: String?): String {
    val trimmed = name?.trim().orEmpty()
    if (trimmed.isEmpty()) return QUESTION_MARK
    val parts = trimmed.split(WHITESPACE).filter { it.isNotEmpty() }
    return if (parts.size >= MIN_NAME_PARTS) {
        "${parts[0][0]}${parts[1][0]}".uppercase()
    } else {
        parts.first().take(INITIALS_MAX).uppercase()
    }
}

/**
 * The hash seed for the palette index (web `seed`): the user id when non-empty, otherwise the trimmed name,
 * otherwise "?" so the truly-anonymous avatar still hashes to a stable (neutral, unused) index.
 */
fun avatarSeed(
    userId: String?,
    name: String?,
): String {
    val base = if (!userId.isNullOrEmpty()) userId else name?.trim().orEmpty()
    return base.ifEmpty { QUESTION_MARK }
}

/**
 * Whether the avatar attributes to a known entity (web `isAttributed`): a non-blank name OR a non-empty user
 * id. Drives the coloured-background-versus-neutral-surface choice so an anonymous avatar never implies a
 * user identity through a hashed hue.
 */
fun isAttributed(
    userId: String?,
    name: String?,
): Boolean = !name?.trim().isNullOrEmpty() || !userId.isNullOrEmpty()

/**
 * Projects an [identity] (and the live [imageFailed] flag the view owns) onto the render-ready
 * [AvatarVisual], in the web's priority order: a present, un-failed `src` → [AvatarContent.Image]; else an
 * attributed name → [AvatarContent.Initials]; else the kind's [AvatarContent.Glyph]. Pure (no Compose / no
 * clock) so every branch is exhaustively unit-tested. [paletteSize] is the live palette length the view
 * passes (`TeslaTokens.chart.categorical.size`).
 */
fun resolveAvatarVisual(
    identity: AvatarIdentity,
    imageFailed: Boolean,
    paletteSize: Int = OKABE_ITO_PALETTE_SIZE,
): AvatarVisual {
    val imageSrc = identity.src?.takeIf { it.isNotEmpty() && !imageFailed }
    val initials = avatarInitials(identity.name)
    val attributed = isAttributed(identity.userId, identity.name)
    val colorIndex = avatarColorIndex(avatarSeed(identity.userId, identity.name), paletteSize)
    val content =
        when {
            imageSrc != null -> AvatarContent.Image(imageSrc)
            initials != QUESTION_MARK -> AvatarContent.Initials(initials)
            else -> AvatarContent.Glyph(identity.kind)
        }
    return AvatarVisual(content = content, attributed = attributed, colorIndex = colorIndex)
}

/**
 * The tooltip / image-alt label (web `tooltipLabel`): the trimmed [name] when known, otherwise the localised
 * [unknownFallback] (`avatar.unknown`) so the avatar always carries a meaningful label.
 */
fun avatarTooltipLabel(
    name: String?,
    unknownFallback: String,
): String = name?.trim().orEmpty().ifEmpty { unknownFallback }

/**
 * The merged accessible label a TalkBack user hears for the whole avatar: the [name] (or localised
 * [unknownFallback]) followed by the localised presence [statusLabel] when present (web folds the avatar
 * label and the status dot's `aria-label` into the same announcement). Kept pure so the a11y label is
 * unit-tested without a Compose host.
 */
fun avatarAccessibilityLabel(
    name: String?,
    unknownFallback: String,
    statusLabel: String?,
): String {
    val base = avatarTooltipLabel(name, unknownFallback)
    return if (statusLabel.isNullOrEmpty()) base else "$base, $statusLabel"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [AVATAR_SLUG] (P1/S11) — never a
 * user id, name, or image URL, so a diagnostics line can never leak who an avatar represents. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordAvatarOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AVATAR_SLUG))
}
