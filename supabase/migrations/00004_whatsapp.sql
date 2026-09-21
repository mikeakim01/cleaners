-- ============================================================================
-- Phase 4 Track J — WhatsApp migration
-- whatsapp_accounts, whatsapp_templates, whatsapp_conversations,
-- whatsapp_messages, whatsapp_automation_rules + RLS.
--
-- Conventions
--   * Every tenant-scoped row carries `tenant_id`; RLS enforces isolation via
--     the `app.current_tenant` GUC combined with `public.is_tenant_member()`.
--     Client-supplied tenant ids are NEVER trusted.
--   * All tenant tables use ENABLE RLS + FORCE RLS + policy "tenant_isolation"
--     FOR ALL TO authenticated (same shape as foundation / core CRM / financial).
--   * Soft-delete via `deleted_at`; unique references are partial
--     (WHERE deleted_at IS NULL) so re-use after delete stays possible.
--   * Access tokens are stored encrypted (see src/server/crypto.ts
--     encryptSecret/decryptSecret with APP_ENCRYPTION_KEY) — never plaintext.
--   * This migration is idempotent-safe (IF NOT EXISTS / DROP POLICY IF EXISTS)
--     and contains its own policies — without them the migration is incomplete.
-- ============================================================================

-- WhatsApp accounts ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL UNIQUE REFERENCES public.tenants (id) ON DELETE CASCADE,
  phone_number_id    text        NOT NULL UNIQUE,
  display_name       text,
  waba_id            text        NOT NULL,
  access_token_enc   text        NOT NULL,
  status             text        NOT NULL DEFAULT 'DISCONNECTED',
  last_tested_at     timestamptz,
  webhook_subscribed boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT whatsapp_accounts_status_check CHECK (status IN (
    'DISCONNECTED', 'PENDING', 'CONNECTED', 'ERROR'
  ))
);

CREATE INDEX IF NOT EXISTS whatsapp_accounts_tenant_status_idx
  ON public.whatsapp_accounts (tenant_id, status);

-- WhatsApp templates -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name             text        NOT NULL,
  language         text        NOT NULL DEFAULT 'en',
  category         text        NOT NULL DEFAULT 'UTILITY',
  body             text        NOT NULL,
  variables        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status           text        NOT NULL DEFAULT 'DRAFT',
  meta_template_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT whatsapp_templates_category_check CHECK (category IN (
    'UTILITY', 'MARKETING', 'AUTHENTICATION'
  )),
  CONSTRAINT whatsapp_templates_status_check CHECK (status IN (
    'DRAFT', 'PENDING', 'APPROVED', 'REJECTED'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_tenant_name_lang_unique
  ON public.whatsapp_templates (tenant_id, name, language)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_templates_tenant_status_idx
  ON public.whatsapp_templates (tenant_id, status);

-- WhatsApp conversations -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id      uuid        REFERENCES public.customers (id),
  phone_e164       text        NOT NULL,
  status           text        NOT NULL DEFAULT 'OPEN',
  assigned_user_id uuid,
  last_message_at  timestamptz,
  unread_count     integer     NOT NULL DEFAULT 0 CONSTRAINT whatsapp_conversations_unread_non_negative CHECK (unread_count >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT whatsapp_conversations_status_check CHECK (status IN (
    'OPEN', 'RESOLVED', 'BLOCKED'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_tenant_phone_unique
  ON public.whatsapp_conversations (tenant_id, phone_e164)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_conversations_tenant_status_last_idx
  ON public.whatsapp_conversations (tenant_id, status, last_message_at);

-- WhatsApp messages ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  conversation_id uuid        NOT NULL REFERENCES public.whatsapp_conversations (id) ON DELETE CASCADE,
  waba_message_id text,
  kind            text        NOT NULL DEFAULT 'text',
  direction       text        NOT NULL,
  body            text,
  template_name   text,
  template_params jsonb,
  status          text        NOT NULL DEFAULT 'queued',
  error           text,
  sent_by         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT whatsapp_messages_kind_check CHECK (kind IN (
    'text', 'template', 'image', 'audio', 'document', 'contacts',
    'location', 'reaction', 'unknown'
  )),
  CONSTRAINT whatsapp_messages_direction_check CHECK (direction IN (
    'inbound', 'outbound'
  )),
  CONSTRAINT whatsapp_messages_status_check CHECK (status IN (
    'queued', 'sent', 'delivered', 'read', 'failed'
  ))
);

-- Global idempotency on the provider message id (deleted rows excluded).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_waba_id_unique
  ON public.whatsapp_messages (waba_message_id)
  WHERE deleted_at IS NULL AND waba_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_tenant_conversation_created_idx
  ON public.whatsapp_messages (tenant_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS whatsapp_messages_tenant_status_idx
  ON public.whatsapp_messages (tenant_id, status);

-- WhatsApp automation rules ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_automation_rules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event         text        NOT NULL,
  template_id   uuid        REFERENCES public.whatsapp_templates (id),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT whatsapp_automation_rules_event_check CHECK (event IN (
    'booking.created', 'booking.confirmed', 'quote.sent', 'job.en_route',
    'job.arrived', 'job.completed', 'invoice.sent', 'payment.received',
    'review.request'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_automation_rules_tenant_event_unique
  ON public.whatsapp_automation_rules (tenant_id, event)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_automation_rules_tenant_active_idx
  ON public.whatsapp_automation_rules (tenant_id, active);

-- updated_at triggers ----------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_accounts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.whatsapp_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_templates;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_conversations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_messages;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_automation_rules;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.whatsapp_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security ------------------------------------------------------------
-- WhatsApp accounts
ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.whatsapp_accounts;
CREATE POLICY "tenant_isolation" ON public.whatsapp_accounts
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- WhatsApp templates
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.whatsapp_templates;
CREATE POLICY "tenant_isolation" ON public.whatsapp_templates
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- WhatsApp conversations
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.whatsapp_conversations;
CREATE POLICY "tenant_isolation" ON public.whatsapp_conversations
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- WhatsApp messages
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.whatsapp_messages;
CREATE POLICY "tenant_isolation" ON public.whatsapp_messages
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- WhatsApp automation rules
ALTER TABLE public.whatsapp_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.whatsapp_automation_rules;
CREATE POLICY "tenant_isolation" ON public.whatsapp_automation_rules
  FOR ALL TO authenticated
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND public.is_tenant_member(tenant_id)
  );

-- Grants (fail closed: only what each role needs) -------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.whatsapp_accounts TO authenticated;
GRANT ALL ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_conversations TO authenticated;
GRANT ALL ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_automation_rules TO authenticated;
