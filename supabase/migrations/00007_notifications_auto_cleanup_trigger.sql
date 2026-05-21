-- 通知自动清理函数：每次新通知插入后触发
-- 策略1：删除该用户超过 30 天的旧通知
-- 策略2：若仍超过 100 条，删除最旧的直到剩余 100 条
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := NEW.user_id;
  v_count   int;
BEGIN
  -- 策略1：删除 30 天前的通知
  DELETE FROM notifications
  WHERE user_id = v_user_id
    AND created_at < now() - interval '30 days';

  -- 策略2：超过 100 条时删除最旧的
  SELECT COUNT(*) INTO v_count
  FROM notifications
  WHERE user_id = v_user_id;

  IF v_count > 100 THEN
    DELETE FROM notifications
    WHERE id IN (
      SELECT id FROM notifications
      WHERE user_id = v_user_id
      ORDER BY created_at ASC
      LIMIT (v_count - 100)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 绑定到 notifications 表的 INSERT 事件（AFTER，不阻塞写入）
CREATE TRIGGER trg_notifications_auto_cleanup
AFTER INSERT ON notifications
FOR EACH ROW
EXECUTE FUNCTION cleanup_old_notifications();