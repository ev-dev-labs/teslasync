-- Phase-46 / Prompt 08 — in-app feedback / report-bug sink.
--
-- Stores a single user-submitted feedback / bug report row. Captured by the
-- SPA's <FeedbackModal> (sidebar button + Cmd+K command) and POSTed to
-- /api/v1/feedback. The admin /api/v1/admin/feedback list + PATCH endpoints
-- read and update these rows; an optional GitHub Issues bridge can post a
-- mirrored issue and persist the resulting URL in github_issue_url so the
-- admin queue links straight to the canonical tracking issue.
--
-- Data shape mirrors the FeedbackEntry frontend type. submitter_subject is
-- populated from the configured ForwardAuth header value when the install is
-- running behind a reverse-proxy auth provider; NULL in open mode (no users
-- table exists, so subject IS the identity surface).
BEGIN;

CREATE TABLE IF NOT EXISTS user_feedback (
  id                bigserial   PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  category          text        NOT NULL CHECK (category IN ('bug', 'feature', 'other')),
  title             text        NOT NULL,
  body              text        NOT NULL,
  page_route        text,
  user_agent        text,
  app_version       text,
  user_email        text,
  recent_errors     jsonb,
  console_tail      text,
  status            text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'closed')),
  github_issue_url  text,
  submitter_subject text,
  submitter_ip      text,
  triaged_at        timestamptz,
  triaged_by        text
);

COMMENT ON TABLE user_feedback IS
  'In-app feedback / bug reports captured by the SPA <FeedbackModal>.';
COMMENT ON COLUMN user_feedback.category IS
  'One of: bug | feature | other. Drives admin queue filtering.';
COMMENT ON COLUMN user_feedback.title IS
  'Short summary entered by the user (5..120 chars enforced server-side).';
COMMENT ON COLUMN user_feedback.body IS
  'Free-form description (20..4000 chars enforced server-side).';
COMMENT ON COLUMN user_feedback.page_route IS
  'window.location.pathname at the moment Submit was clicked.';
COMMENT ON COLUMN user_feedback.user_agent IS
  'navigator.userAgent string from the submitting browser (truncated).';
COMMENT ON COLUMN user_feedback.app_version IS
  'import.meta.env.VITE_APP_VERSION baked into the SPA bundle.';
COMMENT ON COLUMN user_feedback.user_email IS
  'Optional reply-to email entered by the user (free-form, not validated).';
COMMENT ON COLUMN user_feedback.recent_errors IS
  'JSON array of recent reportFrontendError payloads (up to N), captured when includeRecentErrors=true.';
COMMENT ON COLUMN user_feedback.console_tail IS
  'Optional console-log tail captured when includeConsoleTail=true (privacy: opt-in).';
COMMENT ON COLUMN user_feedback.status IS
  'Triage state: new (default) | triaged | closed.';
COMMENT ON COLUMN user_feedback.github_issue_url IS
  'URL of the mirrored GitHub Issue when the optional bridge is configured.';
COMMENT ON COLUMN user_feedback.submitter_subject IS
  'ForwardAuth header value of the submitter (NULL in open mode).';
COMMENT ON COLUMN user_feedback.submitter_ip IS
  'Best-effort client IP recorded for abuse triage; redacted by retention worker if needed.';
COMMENT ON COLUMN user_feedback.triaged_at IS
  'Timestamp of the most recent admin status/PATCH change.';
COMMENT ON COLUMN user_feedback.triaged_by IS
  'ForwardAuth subject of the admin who last updated the row.';

CREATE INDEX IF NOT EXISTS idx_user_feedback_status_created
  ON user_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_submitter_created
  ON user_feedback (submitter_subject, created_at DESC)
  WHERE submitter_subject IS NOT NULL;

COMMIT;
