ALTER TABLE public.tasks 
ADD COLUMN environment_profile_id uuid REFERENCES public.environment_profiles(id) ON DELETE SET NULL;
