import { describe, it, expect } from 'vitest'

import {
  ATTACHMENT_POLICY,
  PROBLEM_REPORT_LIMITS,
  buildProblemReportDiagnostics,
  buildProblemReportSubmission,
  previewProblemReport,
  validateProblemReport,
  type ProblemReportInput,
} from '../problemReport'
import { buildSupportBundle } from '../supportBundle'
import { findForbiddenContent } from '../supportBundle'

/**
 * HELP-09. The submission is the only thing that leaves the browser, so these
 * tests assert on the submission object itself rather than on the modal.
 */

function input(overrides: Partial<ProblemReportInput> = {}): ProblemReportInput {
  return {
    title: 'Charging costs are blank',
    description:
      'Every charging session shows an empty cost column even though I set a price yesterday.',
    pathname: '/charging/8172',
    includeDiagnostics: false,
    bundle: null,
    appVersion: '1.2.3',
    browserSummary: 'Chrome 120',
    ...overrides,
  }
}

describe('validateProblemReport', () => {
  it('accepts a well-formed report', () => {
    expect(validateProblemReport(input())).toEqual({ valid: true, errors: [] })
  })

  it('mirrors the server minimums for title and description', () => {
    const short = validateProblemReport(input({ title: 'a', description: 'too short' }))
    expect(short.valid).toBe(false)
    expect(short.errors).toContain('title_too_short')
    expect(short.errors).toContain('description_too_short')
  })

  it('rejects oversized input rather than letting the server 400', () => {
    const result = validateProblemReport(
      input({
        title: 'x'.repeat(PROBLEM_REPORT_LIMITS.titleMax + 1),
        description: 'y'.repeat(PROBLEM_REPORT_LIMITS.descriptionMax + 1),
      }),
    )
    expect(result.errors).toContain('title_too_long')
    expect(result.errors).toContain('description_too_long')
  })

  it('does not throw on a malformed input object', () => {
    expect(() =>
      validateProblemReport(undefined as unknown as ProblemReportInput),
    ).not.toThrow()
  })
})

describe('buildProblemReportSubmission — wire shape', () => {
  it('emits only the fields the feedback endpoint accepts', () => {
    const submission = buildProblemReportSubmission(input())
    // The endpoint uses DisallowUnknownFields; an extra key is a hard 400.
    const allowed = new Set([
      'category',
      'title',
      'body',
      'page_route',
      'user_agent',
      'app_version',
      'user_email',
      'recent_errors',
      'console_tail',
    ])
    for (const key of Object.keys(submission)) {
      expect(allowed.has(key)).toBe(true)
    }
    expect(submission.category).toBe('bug')
  })

  it('sends the route TEMPLATE, never the raw pathname', () => {
    const submission = buildProblemReportSubmission(input({ pathname: '/charging/8172' }))
    expect(submission.page_route).toBe('/charging/:id')
    expect(submission.page_route).not.toContain('8172')
  })

  it('templates an opaque share token out of the route', () => {
    const submission = buildProblemReportSubmission(
      input({ pathname: '/s/private-share-slug-xyz' }),
    )
    expect(submission.page_route).not.toContain('private-share-slug-xyz')
  })

  it('never populates console_tail or user_email, at any consent level', () => {
    const bundle = buildSupportBundle({ appVersion: '1.2.3' })
    const withConsent = buildProblemReportSubmission(
      input({ includeDiagnostics: true, bundle }),
    )
    expect(withConsent.console_tail).toBeUndefined()
    expect(withConsent.user_email).toBeUndefined()
    expect(ATTACHMENT_POLICY.consoleTail).toBe('never')
    expect(ATTACHMENT_POLICY.userEmail).toBe('never')
    expect(ATTACHMENT_POLICY.files).toBe('never')
    expect(ATTACHMENT_POLICY.screenshots).toBe('never')
  })

  it('sends a coarse browser summary, not the raw user-agent', () => {
    const submission = buildProblemReportSubmission(input({ browserSummary: 'Safari 17' }))
    expect(submission.user_agent).toBe('Safari 17')
    expect(submission.user_agent).not.toContain('Mozilla')
  })
})

describe('buildProblemReportSubmission — consent', () => {
  const bundle = buildSupportBundle({
    appVersion: '1.2.3',
    healthOverall: 'degraded',
    healthServices: [
      { name: 'db', status: 'ok' },
      { name: 'mqtt', status: 'down' },
    ],
    errors: [{ name: 'Error', message: 'boom', route: '/drives/1', occurred_at: '' }],
  })

  it('omits diagnostics entirely when consent is withheld', () => {
    const submission = buildProblemReportSubmission(
      input({ includeDiagnostics: false, bundle }),
    )
    expect(submission.recent_errors).toBeUndefined()
  })

  it('omits diagnostics when consent is given but no bundle exists', () => {
    const submission = buildProblemReportSubmission(
      input({ includeDiagnostics: true, bundle: null }),
    )
    expect(submission.recent_errors).toBeUndefined()
  })

  it('attaches the redacted projection when consent is given', () => {
    const submission = buildProblemReportSubmission(
      input({ includeDiagnostics: true, bundle }),
    )
    const diagnostics = submission.recent_errors as ReturnType<
      typeof buildProblemReportDiagnostics
    >
    expect(diagnostics.app_version).toBe('1.2.3')
    expect(diagnostics.health_overall).toBe('degraded')
    expect(diagnostics.degraded_services).toEqual(['mqtt:down'])
    expect(diagnostics.errors).toHaveLength(1)
  })

  it('treats only ok/healthy/up as healthy when listing degraded services', () => {
    const diagnostics = buildProblemReportDiagnostics(
      buildSupportBundle({
        healthServices: [
          { name: 'a', status: 'OK' },
          { name: 'b', status: 'healthy' },
          { name: 'c', status: 'up' },
          { name: 'd', status: 'degraded' },
        ],
      }),
    )
    expect(diagnostics.degraded_services).toEqual(['d:degraded'])
  })
})

describe('buildProblemReportSubmission — redaction of user free text', () => {
  it('strips a token the user pasted into the description', () => {
    const submission = buildProblemReportSubmission(
      input({
        description:
          'It fails with Authorization: Bearer abc123def456ghi789 every single time I retry it.',
      }),
    )
    expect(submission.body).not.toContain('abc123def456ghi789')
  })

  it('strips a VIN the user pasted into the title', () => {
    const submission = buildProblemReportSubmission(
      input({ title: 'No data for 5YJ3E1EA7KF317654' }),
    )
    expect(submission.title).not.toContain('5YJ3E1EA7KF317654')
  })

  it('leaves ordinary prose intact', () => {
    const description =
      'The charging cost column is empty for every session recorded since Tuesday.'
    expect(buildProblemReportSubmission(input({ description })).body).toBe(description)
  })

  it('produces a preview that contains nothing forbidden', () => {
    const preview = previewProblemReport(
      input({
        title: 'Broken for 5YJ3E1EA7KF317654',
        description: 'Contact me at owner@example.com — it broke near 37.774929,-122.419418.',
        pathname: '/vehicles/5YJ3E1EA7KF317654',
      }),
    )
    expect(findForbiddenContent(preview)).toEqual([])
  })

  it('previews exactly the object that will be POSTed', () => {
    const values = input()
    expect(previewProblemReport(values)).toBe(
      JSON.stringify(buildProblemReportSubmission(values), null, 2),
    )
  })
})
