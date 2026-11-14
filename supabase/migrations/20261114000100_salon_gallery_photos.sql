CREATE TABLE IF NOT EXISTS public.salon_gallery_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  storage_path text NOT NULL UNIQUE,
  thumbnail_path text,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','client','public')),
  category text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.salon_gallery_photos ENABLE ROW LEVEL SECURITY;
-- Pravila pristupa dodaju se nakon provjere postojece autentikacije.
-- Do tada tablica nema korisnickih RLS pravila i nije dostupna klijentima.
