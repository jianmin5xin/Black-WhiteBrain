
-- ══════════════════════════════════════════════════════════════════════
--  Milestone 4 – Concurrent Patch Safety
--  需求 4：skill_history.version 在同一 skill_card 下必须唯一
--
--  此约束是数据库级最终安全网：
--    · 即使两个并发事务同时通过 RPC 版本号计算，
--      先 COMMIT 的一方写入成功，后提交方触发 UNIQUE VIOLATION，
--      整个事务（含 memory_episodes INSERT）自动回滚。
--    · 与 RPC 层的 FOR UPDATE 悲观锁 + expected_version 乐观锁形成三层防护。
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.skill_history
  ADD CONSTRAINT uq_skill_history_card_version
    UNIQUE (skill_card_id, version);

COMMENT ON CONSTRAINT uq_skill_history_card_version ON public.skill_history IS
  '同一技能卡下版本号不得重复。并发补丁场景下，后写方触发此约束导致事务回滚，'
  '保证 memory_episodes 不产生断链记录（Milestone 4 需求 4）。';
