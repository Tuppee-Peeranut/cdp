BEGIN;

-- Storage RLS policies for `avatars` bucket
-- Allow public read (if bucket is public); allow authenticated uploads; restrict update/delete to owner

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_public_read'
  ) THEN
    CREATE POLICY avatars_public_read
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_authenticated_insert'
  ) THEN
    CREATE POLICY avatars_authenticated_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'avatars');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_owner_update'
  ) THEN
    CREATE POLICY avatars_owner_update
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'avatars' AND owner = auth.uid())
      WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_owner_delete'
  ) THEN
    CREATE POLICY avatars_owner_delete
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'avatars' AND owner = auth.uid());
  END IF;
END $$;

COMMIT;
