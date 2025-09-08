BEGIN;

-- Storage RLS policies for `domains` bucket (for dataset uploads)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'domains_public_read'
  ) THEN
    CREATE POLICY domains_public_read
      ON storage.objects FOR SELECT
      USING (bucket_id = 'domains');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'domains_authenticated_insert'
  ) THEN
    CREATE POLICY domains_authenticated_insert
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'domains');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'domains_owner_update'
  ) THEN
    CREATE POLICY domains_owner_update
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'domains' AND owner = auth.uid())
      WITH CHECK (bucket_id = 'domains' AND owner = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'domains_owner_delete'
  ) THEN
    CREATE POLICY domains_owner_delete
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'domains' AND owner = auth.uid());
  END IF;
END $$;

COMMIT;

