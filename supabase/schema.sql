CREATE TABLE IF NOT EXISTS public.favorites (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movie_id INTEGER NOT NULL,
  movie_title TEXT NOT NULL,
  poster_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, movie_id)
);

ALTER TABLE public.favorites
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_own_favorites"
ON public.favorites;

DROP POLICY IF EXISTS "insert_own_favorites"
ON public.favorites;

DROP POLICY IF EXISTS "delete_own_favorites"
ON public.favorites;

CREATE POLICY "read_own_favorites"
ON public.favorites
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "insert_own_favorites"
ON public.favorites
FOR INSERT
TO authenticated
WITH CHECK(
  (SELECT auth.uid()) = user_id
);

CREATE POLICY "delete_own_favorites"
ON public.favorites
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, DELETE
ON public.favorites TO authenticated;

GRANT USAGE, SELECT
ON SEQUENCE public.favorites_id_seq
TO authenticated;