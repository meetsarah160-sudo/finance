-- Additive repair; no financial records are deleted or rewritten.
BEGIN;
ALTER TABLE public.user_configs ADD COLUMN IF NOT EXISTS bucket_map jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION public.finance_touch_config_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.finance_touch_config_revision() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER finance_config_revision
BEFORE UPDATE ON public.user_configs
FOR EACH ROW EXECUTE FUNCTION public.finance_touch_config_revision();
COMMIT;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_configs' AND column_name = 'bucket_map';
