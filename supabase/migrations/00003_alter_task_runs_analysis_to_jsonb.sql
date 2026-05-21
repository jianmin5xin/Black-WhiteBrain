-- 将 analysis 字段从 text 改为 jsonb，以支持白质层结构化推理结果存储
ALTER TABLE public.task_runs
  ALTER COLUMN analysis TYPE jsonb USING
    CASE
      WHEN analysis IS NULL THEN NULL
      WHEN analysis ~ '^\s*\{' THEN analysis::jsonb
      ELSE jsonb_build_object('raw_text', analysis)
    END;