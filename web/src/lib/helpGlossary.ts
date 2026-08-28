/**
 * Contextual definitions for the terms that carry the most ambiguity in an EV
 * telemetry product (HELP-03).
 *
 * The six required terms — state of charge, rated range, degradation, phantom
 * drain, efficiency and signal freshness — all share a failure mode: the user
 * recognises the word, assumes a definition, and then reads the chart wrong.
 * "Rated range dropped 20 km" is alarming if you think rated range is a
 * measurement, and unremarkable once you know it is EPA rating × state of
 * charge.
 *
 * Every entry therefore carries THREE parts, not one:
 *   - `definition`  — what the term means.
 *   - `howMeasured` — where our number actually comes from, so the user can
 *                     judge how much to trust it.
 *   - `aliases`     — synonyms and abbreviations, so the help index finds the
 *                     entry when the user searches the word they know.
 *
 * i18n reuse: where the app already ships a vetted definition string, that key
 * is reused verbatim (`help.vampireDrain.body`, `help.battery.degradationRate`,
 * `help.lifetime.avgEfficiency`, `help.signal.stale`, `help.battery.soh`).
 * Fallbacks below are byte-identical to the shipped catalog values so an
 * install with no translation bundle renders the same sentence.
 */

export interface GlossaryTerm {
  /** Stable id. Also the help-index key and the `<GlossaryTerm term>` prop. */
  id: string
  termKey: string
  termFallback: string
  definitionKey: string
  definitionFallback: string
  /** Provenance — how this app derives the number. */
  howMeasuredKey: string
  howMeasuredFallback: string
  /** Lower-case synonyms, abbreviations and common misspellings. */
  aliases: readonly string[]
  /** Canonical page where the term is used, for "see it in context". */
  learnMoreTo?: string
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: 'soc',
    termKey: 'glossary.soc.term',
    termFallback: 'State of charge (SOC)',
    definitionKey: 'glossary.soc.definition',
    definitionFallback:
      'The percentage of usable energy currently left in the battery, where 100% is a full charge of the pack as it exists today — not as it was when new.',
    howMeasuredKey: 'glossary.soc.howMeasured',
    howMeasuredFallback:
      'Reported directly by the vehicle. The displayed value already excludes the buffer the car reserves below 0%, so a car at 0% is not an empty pack.',
    aliases: ['soc', 'state of charge', 'battery level', 'battery percentage', 'charge level'],
    learnMoreTo: '/battery',
  },
  {
    id: 'rated_range',
    termKey: 'glossary.ratedRange.term',
    termFallback: 'Rated range',
    definitionKey: 'glossary.ratedRange.definition',
    definitionFallback:
      'A rating, not a prediction: the current state of charge multiplied by a fixed EPA-derived distance per percent. It ignores weather, speed, terrain and load.',
    howMeasuredKey: 'glossary.ratedRange.howMeasured',
    howMeasuredFallback:
      'Reported by the vehicle. Because the multiplier is fixed, rated range moves only when state of charge or the pack’s estimated capacity moves — real trips almost always use more.',
    aliases: ['rated range', 'epa range', 'estimated range', 'range', 'ideal range'],
    learnMoreTo: '/analytics/range',
  },
  {
    id: 'degradation',
    termKey: 'glossary.degradation.term',
    termFallback: 'Degradation',
    // Reuses the shipped definition for the degradation-rate metric.
    definitionKey: 'help.battery.degradationRate',
    definitionFallback:
      'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).',
    howMeasuredKey: 'glossary.degradation.howMeasured',
    howMeasuredFallback:
      'Derived from many observed charges over weeks. A single reading is noise: temperature, recent fast charging and a resting pack all shift the estimate by more than a year of real loss.',
    aliases: ['degradation', 'capacity loss', 'soh', 'state of health', 'battery health', 'fade'],
    learnMoreTo: '/battery-degradation',
  },
  {
    id: 'phantom_drain',
    termKey: 'glossary.phantomDrain.term',
    termFallback: 'Phantom drain (vampire drain)',
    // Reuses the shipped vampire-drain definition.
    definitionKey: 'help.vampireDrain.body',
    definitionFallback:
      'Battery percentage lost per day while the vehicle is parked and not charging, derived from observed parked windows.',
    howMeasuredKey: 'glossary.phantomDrain.howMeasured',
    howMeasuredFallback:
      'Measured only across parked, non-charging windows. Sentry mode, cabin overheat protection, preconditioning and frequent polling all raise it, and each is a setting rather than a fault.',
    aliases: ['phantom drain', 'vampire drain', 'idle loss', 'parked drain', 'standby drain'],
    learnMoreTo: '/charging/vampire-drain',
  },
  {
    id: 'efficiency',
    termKey: 'glossary.efficiency.term',
    termFallback: 'Efficiency',
    // Reuses the shipped lifetime-efficiency definition.
    definitionKey: 'help.lifetime.avgEfficiency',
    definitionFallback:
      'Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.',
    howMeasuredKey: 'glossary.efficiency.howMeasured',
    howMeasuredFallback:
      'Computed from completed drives that report both distance and energy. Charging losses are not included, so a wall-meter figure will always look worse than this one.',
    aliases: ['efficiency', 'wh/km', 'wh/mi', 'consumption', 'energy use'],
    learnMoreTo: '/analytics',
  },
  {
    id: 'signal_freshness',
    termKey: 'glossary.signalFreshness.term',
    termFallback: 'Signal freshness',
    // Reuses the shipped stale-signal definition.
    definitionKey: 'help.signal.stale',
    definitionFallback:
      'A signal is marked stale when its last-seen value in Redis is older than 2 minutes — treat with caution; the vehicle may be offline or the pipeline may be backed up.',
    howMeasuredKey: 'glossary.signalFreshness.howMeasured',
    howMeasuredFallback:
      'Freshness is the age of the last received value, not a health check. A sleeping vehicle produces stale signals by design; that is normal and costs no range.',
    aliases: ['signal freshness', 'stale', 'staleness', 'last seen', 'data age', 'live data'],
    learnMoreTo: '/signals',
  },
  {
    id: 'state_of_health',
    termKey: 'glossary.stateOfHealth.term',
    termFallback: 'State of health (SoH)',
    definitionKey: 'help.battery.soh',
    definitionFallback:
      'State of Health — current usable capacity divided by the original rated capacity, expressed as a percentage. Higher is better; new packs start at 100%.',
    howMeasuredKey: 'glossary.stateOfHealth.howMeasured',
    howMeasuredFallback:
      'Estimated from observed full-charge capacity over time. It is an estimate with a real error bar, which is why the trend matters more than any single value.',
    aliases: ['soh', 'state of health', 'pack health', 'usable capacity'],
    learnMoreTo: '/battery',
  },
] as const

const GLOSSARY_BY_ID: ReadonlyMap<string, GlossaryTerm> = new Map(
  GLOSSARY.map((term) => [term.id, term]),
)

/** Registry lookup by id. */
export function getGlossaryTerm(id: string): GlossaryTerm | null {
  return GLOSSARY_BY_ID.get(id) ?? null
}

/**
 * Resolve a free-text word to a glossary entry — exact id, exact term, or
 * exact alias. Deliberately NOT fuzzy: a wrong definition is worse than none,
 * and fuzzy search belongs in the help index where results are ranked and the
 * user picks.
 */
export function resolveGlossaryTerm(input: string): GlossaryTerm | null {
  if (typeof input !== 'string') return null
  const needle = input.trim().toLowerCase()
  if (needle === '') return null
  const direct = GLOSSARY_BY_ID.get(needle)
  if (direct) return direct
  return (
    GLOSSARY.find(
      (term) =>
        term.termFallback.toLowerCase() === needle ||
        term.aliases.some((alias) => alias.toLowerCase() === needle),
    ) ?? null
  )
}

/** Ids in a stable display order (registry order). */
export function listGlossaryIds(): string[] {
  return GLOSSARY.map((term) => term.id)
}
