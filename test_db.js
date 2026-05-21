import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
  const { data: { user } } = await supabase.auth.signInWithPassword({
    email: 'admin@admin.com',
    password: 'password123'
  });
  
  if (!user) {
    console.log("No user");
    return;
  }
  
  console.log("User ID:", user.id);
  
  // Create a fake task and run
  const { data: task } = await supabase.from('tasks').insert({
    title: 'Test legacy',
    environment_type: 'web_automation',
    user_id: user.id
  }).select().single();
  
  // Run 1: without snapshot
  const { data: run1, error: err1 } = await supabase.from('task_runs').insert({
    task_id: task.id,
    status: 'running',
    user_id: user.id
  }).select().single();
  
  console.log("Run 1 is_legacy_run:", run1?.is_legacy_run, err1?.message);
  
  // Run 2: with snapshot
  const { data: run2, error: err2 } = await supabase.from('task_runs').insert({
    task_id: task.id,
    status: 'running',
    user_id: user.id,
    skill_history_id: '00000000-0000-0000-0000-000000000000', // need a valid uuid? Let's just create a dummy skill history.
  }).select().single();
  
  console.log("Run 2 error:", err2?.message);
}
run();
