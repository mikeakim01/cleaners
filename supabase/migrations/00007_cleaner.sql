-- ============================================================================
-- Phase 7 Track S — Cleaner file attachments (job photos)
-- Tenant-scoped `files` table follows the same tenant-isolation RLS
-- convention as 00001_foundation.sql:
--   ENABLE + FORCE RLS + "tenant_isolation" policy via
--   app.current_tenant GUC + public.is_tenant_member().
-- Rows are immutable (created_at only, no updated_at): before/after photo
-- evidence must never be rewritten. Soft-delete via deleted_at.
-- Storage:
--   * service_role bypasses RLS on storage.objects by default, so uploads
--     go through server-only code (src/services/files.service.ts) with the
--     service-role client and explicit tenant scoping. NO anon policies are
--     created on storage.objects deliberately — the 'tenant-files' bucket is
--     private and clients only ever receive 1-hour signed URLs.
-- Idempotent-safe (IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT).
-- ============================================================================

-- File attachments ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.files (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  entity        text        NOT NULL,
  entity_id     uuid        NOT NULL,
  kind          text        NOT NULL DEFAULT 'photo',
  storage_path  text        NOT NULL,
  mime          text        NOT NULL DEFAULT 'image/jpeg',
  size_bytes    integer     NOT NULL DEFAULT 0,
  captured_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT files_entity_check CHECK (entity IN (
    'job', 'booking', 'customer', 'review', 'invoice'
  )),
  CONSTRAINT files_kind_check CHECK (kind IN (
    'photo', 'document'
  )),
  CONSTRAINT files_size_non_negative CHECK (size_bytes >= 0)
);

COMMENT ON TABLE public.files IS
  'Immutable tenant-scoped file attachments. Before/after job photos are stored with kind = photo and the before/after marker encoded in storage_path. Server-only writes; clients receive signed URLs.';

CREATE INDEX IF NOT EXISTS files_tenant_entity_idx
  ON public.files (tenant_id, entity, entity_id);

-- Row Level Security (identical tenant_isolation convention) -------------------
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.files;
CREATE POLICY "tenant_isolation" ON public.files
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Grants (fail closed; rows immutable — no UPDATE/DELETE for clients) ---------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON public.files TO authenticated;
REVOKE UPDATE, DELETE ON public.files FROM anon, authenticated;

-- Private storage bucket (server-only uploads via the service role) -----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-files', 'tenant-files', false)
ON CONFLICT DO NOTHING;

-- Deliberately NO storage.objects policies for anon/authenticated: the bucket
-- stays private and every read goes through a short-lived signed URL minted
-- server-side (see src/services/files.service.ts listJobPhotos).
