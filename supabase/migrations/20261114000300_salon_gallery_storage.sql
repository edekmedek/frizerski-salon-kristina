INSERT INTO storage.buckets (id, name, public) VALUES ('salon-gallery', 'salon-gallery', false) ON CONFLICT (id) DO UPDATE SET public = false;
CREATE POLICY gallery_storage_admin_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'salon-gallery' AND public.is_admin());
CREATE POLICY gallery_storage_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'salon-gallery' AND public.is_admin());
CREATE POLICY gallery_storage_admin_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'salon-gallery' AND public.is_admin()) WITH CHECK (bucket_id = 'salon-gallery' AND public.is_admin());
CREATE POLICY gallery_storage_admin_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'salon-gallery' AND public.is_admin());
