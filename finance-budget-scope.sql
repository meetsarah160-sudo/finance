-- Additive budget-scope upgrade. Existing expenses stay unchanged; NULL follows category defaults.
-- Apply after finance-safety-upgrade.sql, before publishing index.html 2026.10.12.1.
BEGIN;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS budget_scope text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.expenses'::regclass AND conname='expenses_budget_scope_check') THEN
  ALTER TABLE public.expenses ADD CONSTRAINT expenses_budget_scope_check CHECK (budget_scope IS NULL OR budget_scope IN ('personal','business'));
 END IF;
END $$;
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
   IF x->>'budgetScope' IS NOT NULL AND x->>'budgetScope' NOT IN ('personal','business') THEN RAISE EXCEPTION '预算归属无效'; END IF;
 END LOOP;
 INSERT INTO public.finance_backups(owner_id,user_id,label,data) VALUES(auth.uid(),p_profile,'导入或恢复前',s) RETURNING id INTO backup_id;
 DELETE FROM public.expenses WHERE owner_id=auth.uid() AND user_id=p_profile
 AND id NOT IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_expenses));
 INSERT INTO public.expenses(id,owner_id,user_id,date,item,amount,category_id,category_name,type,budget_scope)
 SELECT (entry.value->>'id')::uuid,auth.uid(),p_profile,(entry.value->>'date')::date,entry.value->>'item',(entry.value->>'amount')::numeric,
 (entry.value->>'categoryId')::integer,entry.value->>'categoryName',entry.value->>'type',
 CASE WHEN entry.value ? 'budgetScope' THEN entry.value->>'budgetScope'
 ELSE (SELECT old.budget_scope FROM public.expenses old WHERE old.id=(entry.value->>'id')::uuid AND old.owner_id=auth.uid() AND old.user_id=p_profile) END
 FROM jsonb_array_elements(p_expenses) entry
 ON CONFLICT(id) DO UPDATE SET date=excluded.date,item=excluded.item,amount=excluded.amount,
 category_id=excluded.category_id,category_name=excluded.category_name,type=excluded.type,budget_scope=excluded.budget_scope
 WHERE public.expenses.owner_id=auth.uid() AND public.expenses.user_id=p_profile
 AND (public.expenses.date,public.expenses.item,public.expenses.amount,public.expenses.category_id,public.expenses.category_name,public.expenses.type,public.expenses.budget_scope)
 IS DISTINCT FROM (excluded.date,excluded.item,excluded.amount,excluded.category_id,excluded.category_name,excluded.type,excluded.budget_scope);
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
