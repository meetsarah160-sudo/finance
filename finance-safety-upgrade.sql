-- Additive safety upgrade; run as database administrator. No historical rows changed.
BEGIN;
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS public.finance_backups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), label text NOT NULL,
 data jsonb NOT NULL, daily_key date,
 UNIQUE(owner_id,user_id,daily_key)
);
CREATE TABLE IF NOT EXISTS public.finance_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), table_name text NOT NULL,
 operation text NOT NULL, row_id text NOT NULL, before_data jsonb, after_data jsonb
);
CREATE INDEX IF NOT EXISTS finance_changes_owner_time ON public.finance_changes(owner_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS finance_backups_owner_time ON public.finance_backups(owner_id,user_id,created_at DESC);
ALTER TABLE public.finance_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_backups, public.finance_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.finance_backups TO authenticated;
GRANT SELECT ON public.finance_changes TO authenticated;
CREATE POLICY finance_backup_read ON public.finance_backups FOR SELECT TO authenticated USING (owner_id=(select auth.uid()));
CREATE POLICY finance_backup_create ON public.finance_backups FOR INSERT TO authenticated WITH CHECK (owner_id=(select auth.uid()));
CREATE POLICY finance_changes_read ON public.finance_changes FOR SELECT TO authenticated USING (owner_id=(select auth.uid()));

CREATE OR REPLACE FUNCTION public.finance_read_state(p_profile text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c jsonb; e jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '需要登录'; END IF;
 SELECT to_jsonb(t) INTO c FROM public.user_configs t WHERE owner_id=auth.uid() AND user_id=p_profile;
 IF c IS NULL THEN RAISE EXCEPTION '账本不存在或无权限'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) INTO e
 FROM public.expenses t WHERE owner_id=auth.uid() AND user_id=p_profile;
 RETURN jsonb_build_object('config',c,'expenses',e,'token',md5(c::text||e::text));
END; $$;
REVOKE ALL ON FUNCTION public.finance_read_state(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_read_state(text) TO authenticated;

-- Internal trigger is privileged ONLY to append protected history/automatic backups.
-- It is not an API and cannot be called by clients. Never changes financial records.
CREATE OR REPLACE FUNCTION finance_private.capture_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; old_json jsonb; new_json jsonb; uid uuid; profile text; c jsonb; e jsonb; day_key date;
BEGIN
 IF TG_OP <> 'INSERT' THEN old_json:=to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN new_json:=to_jsonb(NEW); END IF;
 r:=coalesce(old_json,new_json); uid:=(r->>'owner_id')::uuid; profile:=r->>'user_id';
 IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM uid THEN RAISE EXCEPTION '无权记录其他账户的修改'; END IF;
 IF TG_OP='UPDATE' AND (old_json - 'updated_at')=(new_json - 'updated_at') THEN RETURN NEW; END IF;
 IF TG_WHEN='AFTER' THEN
 INSERT INTO public.finance_changes(owner_id,user_id,table_name,operation,row_id,before_data,after_data)
 VALUES(uid,profile,TG_TABLE_NAME,TG_OP,r->>'id',old_json,new_json);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 day_key:=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date;
 IF NOT EXISTS (SELECT 1 FROM public.finance_backups WHERE owner_id=uid AND user_id=profile AND daily_key=day_key) THEN
   SELECT to_jsonb(t) INTO c FROM public.user_configs t WHERE owner_id=uid AND user_id=profile;
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) INTO e FROM public.expenses t WHERE owner_id=uid AND user_id=profile;
   IF c IS NOT NULL THEN
     INSERT INTO public.finance_backups(owner_id,user_id,label,data,daily_key)
     VALUES(uid,profile,'每日首次修改前',jsonb_build_object('config',c,'expenses',e),day_key) ON CONFLICT(owner_id,user_id,daily_key) DO NOTHING;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON FUNCTION finance_private.capture_change() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER finance_track_expenses BEFORE INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION finance_private.capture_change();
CREATE OR REPLACE TRIGGER finance_track_config BEFORE INSERT OR UPDATE OR DELETE ON public.user_configs FOR EACH ROW EXECUTE FUNCTION finance_private.capture_change();

CREATE OR REPLACE TRIGGER finance_audit_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION finance_private.capture_change();
CREATE OR REPLACE TRIGGER finance_audit_config AFTER INSERT OR UPDATE OR DELETE ON public.user_configs FOR EACH ROW EXECUTE FUNCTION finance_private.capture_change();

CREATE OR REPLACE FUNCTION public.finance_create_backup(p_profile text, p_label text DEFAULT '手动云端备份')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s jsonb; bid uuid;
BEGIN
 s:=public.finance_read_state(p_profile);
 INSERT INTO public.finance_backups(owner_id,user_id,label,data) VALUES(auth.uid(),p_profile,left(p_label,80),s) RETURNING id INTO bid;
 RETURN bid;
END; $$;
REVOKE ALL ON FUNCTION public.finance_create_backup(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_create_backup(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_import_atomic(p_profile text,p_token text,p_config jsonb,p_expenses jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s jsonb; backup_id uuid; f text; x jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '需要登录'; END IF;
 -- Block concurrent ordinary writes too, not just calls to this RPC. Locks release at transaction end.
 LOCK TABLE public.user_configs, public.expenses IN SHARE ROW EXCLUSIVE MODE;
 s:=public.finance_read_state(p_profile);
 IF p_token IS DISTINCT FROM s->>'token' THEN RAISE EXCEPTION '云端已被修改，请重新预览导入'; END IF;
 IF jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expenses) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '备份格式错误'; END IF;
 FOREACH f IN ARRAY ARRAY['categories','incomes_data','goals_data','assets_data','asset_history','asset_types'] LOOP
   IF jsonb_typeof(p_config->f) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '配置数组缺失: %', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['expense_overrides','bucket_map'] LOOP
   IF jsonb_typeof(p_config->f) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '配置字段错误: %', f; END IF;
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_expenses) LOOP
   IF x->>'id' IS NULL OR x->>'date' IS NULL OR coalesce(length(trim(x->>'item')),0)=0 OR x->>'amount' IS NULL
      OR (x->>'amount')::numeric::text IN ('NaN','Infinity','-Infinity') OR (x->>'amount')::numeric=0
      THEN RAISE EXCEPTION '支出记录字段错误'; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_config->'categories') c WHERE c->>'id'=x->>'categoryId') THEN RAISE EXCEPTION '支出分类不存在'; END IF;
 END LOOP;
 INSERT INTO public.finance_backups(owner_id,user_id,label,data) VALUES(auth.uid(),p_profile,'导入或恢复前',s) RETURNING id INTO backup_id;
 DELETE FROM public.expenses WHERE owner_id=auth.uid() AND user_id=p_profile
 AND id NOT IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_expenses));
 INSERT INTO public.expenses(id,owner_id,user_id,date,item,amount,category_id,category_name,type)
 SELECT (entry.value->>'id')::uuid,auth.uid(),p_profile,(entry.value->>'date')::date,entry.value->>'item',(entry.value->>'amount')::numeric,
 (entry.value->>'categoryId')::integer,entry.value->>'categoryName',entry.value->>'type' FROM jsonb_array_elements(p_expenses) entry
 ON CONFLICT(id) DO UPDATE SET date=excluded.date,item=excluded.item,amount=excluded.amount,
 category_id=excluded.category_id,category_name=excluded.category_name,type=excluded.type
 WHERE public.expenses.owner_id=auth.uid() AND public.expenses.user_id=p_profile
 AND (public.expenses.date,public.expenses.item,public.expenses.amount,public.expenses.category_id,public.expenses.category_name,public.expenses.type)
 IS DISTINCT FROM (excluded.date,excluded.item,excluded.amount,excluded.category_id,excluded.category_name,excluded.type);
 -- A colliding ID belonging to another profile must abort instead of silently skipping a row.
 IF (SELECT count(*) FROM public.expenses WHERE owner_id=auth.uid() AND user_id=p_profile) <> jsonb_array_length(p_expenses) THEN RAISE EXCEPTION '记录 ID 冲突'; END IF;
 UPDATE public.user_configs SET categories=p_config->'categories',incomes_data=p_config->'incomes_data',goals_data=p_config->'goals_data',
 assets_data=p_config->'assets_data',asset_history=p_config->'asset_history',asset_types=p_config->'asset_types',
 expense_overrides=p_config->'expense_overrides',bucket_map=p_config->'bucket_map'
 WHERE owner_id=auth.uid() AND user_id=p_profile;
 RETURN jsonb_build_object('backup_id',backup_id,'expenses',jsonb_array_length(p_expenses));
END; $$;
REVOKE ALL ON FUNCTION public.finance_import_atomic(text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_import_atomic(text,text,jsonb,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
