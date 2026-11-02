-- Cover the review event foreign keys for audit lookups and cascade checks.
create index if not exists pcc_workspace_review_events_intake_idx
  on public.pcc_workspace_intake_review_events_v1(intake_id,reviewed_at desc);
create index if not exists pcc_workspace_review_events_reviewer_idx
  on public.pcc_workspace_intake_review_events_v1(reviewer_subject,reviewed_at desc);
