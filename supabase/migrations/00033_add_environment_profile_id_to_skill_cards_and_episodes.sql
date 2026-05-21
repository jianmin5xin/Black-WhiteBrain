ALTER TABLE public.skill_cards 
ADD COLUMN environment_profile_id uuid REFERENCES public.environment_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.memory_episodes
ADD COLUMN environment_profile_id uuid REFERENCES public.environment_profiles(id) ON DELETE SET NULL;
