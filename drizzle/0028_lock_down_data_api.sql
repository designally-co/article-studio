-- Article Studio is a server-side application. It connects to Postgres with
-- DATABASE_URL and does not expose these application tables through the
-- Supabase Data API. Keep that boundary explicit: RLS denies Data API access
-- unless a future migration deliberately adds a narrowly scoped policy.

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricing ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.refinements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.routine_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.image_references ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pillars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Supabase grants public-schema tables to its API roles by default. Article
-- Studio has no browser-side Supabase client, so remove those grants as a
-- second layer of protection. The Postgres owner used by DATABASE_URL retains
-- access and continues to bypass RLS unless FORCE ROW LEVEL SECURITY is added.
DO $data_api_lockdown$
BEGIN
  -- PGlite does not define Supabase's API roles, so keep the migration portable
  -- by revoking only when those roles exist.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE '
      || 'public.app_settings, public.pricing, public.users, public.projects, '
      || 'public.drafts, public.api_usage_log, public.refinements, public.categories, '
      || 'public.api_keys, public.brand_profiles, public.images, public.routine_runs, '
      || 'public.routines, public.image_references, public.pillars FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE '
      || 'public.app_settings, public.pricing, public.users, public.projects, '
      || 'public.drafts, public.api_usage_log, public.refinements, public.categories, '
      || 'public.api_keys, public.brand_profiles, public.images, public.routine_runs, '
      || 'public.routines, public.image_references, public.pillars FROM authenticated';
  END IF;
END
$data_api_lockdown$;
