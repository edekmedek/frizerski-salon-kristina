CREATE POLICY gallery_admin_all ON public.salon_gallery_photos FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY gallery_client_read ON public.salon_gallery_photos FOR SELECT TO authenticated USING (visibility = 'client' AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = auth.uid()));
CREATE POLICY gallery_public_read ON public.salon_gallery_photos FOR SELECT TO anon, authenticated USING (visibility = 'public');
