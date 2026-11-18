-- Conservative rollback: removes the aggregate function and hides the new
-- tables by renaming them so recorded overrides, request events, and payment
-- evidence are not deleted. Review and archive these tables before any DROP.
begin;
drop function if exists public.jvg_platform_fiscal_metrics(uuid,timestamptz,timestamptz);
alter table if exists public.jvg_company_module_overrides rename to jvg_company_module_overrides_rollback_archive;
alter table if exists public.jvg_onboarding_request_events rename to jvg_onboarding_request_events_rollback_archive;
alter table if exists public.jvg_onboarding_requests drop column if exists assigned_admin_id;
alter table if exists public.jvg_onboarding_requests drop column if exists assigned_admin_name;
-- Keep manual confirmation evidence until it has been exported and reviewed.
commit;
