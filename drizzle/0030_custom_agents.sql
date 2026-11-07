CREATE TABLE public.provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  provider_type text NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  secret_ciphertext text NOT NULL,
  key_hint text NOT NULL,
  configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT provider_configs_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT provider_configs_type_check CHECK (provider_type in ('nibie_router', 'openai_compatible')),
  CONSTRAINT provider_configs_name_length CHECK (char_length(name) between 1 and 80 and name = btrim(name)),
	CONSTRAINT provider_configs_base_url_length CHECK (char_length(base_url) between 8 and 300 and base_url = btrim(base_url) and base_url like 'https://%'),
	CONSTRAINT provider_configs_base_url_host CHECK (
		base_url !~* '@'
		and base_url !~* 'https://localhost([:/]|$)'
		and base_url !~* 'https://[^/]*\.local([:/]|$)'
		and base_url !~* 'https://[^/]*\.internal([:/]|$)'
		and base_url !~* 'https://(127|10|0)\.'
		and base_url !~* 'https://192\.168\.'
		and base_url !~* 'https://169\.254\.'
		and base_url !~* 'https://172\.(1[6-9]|2[0-9]|3[0-1])\.'
		and base_url !~* 'https://\[(::1|fe80:|f[cd][0-9a-f]{2}:)'
	),
  CONSTRAINT provider_configs_hint_length CHECK (char_length(key_hint) between 2 and 8),
  CONSTRAINT provider_configs_configuration_empty CHECK (configuration = '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  avatar text DEFAULT 'spark' NOT NULL,
  system_instructions text,
  provider_binding text NOT NULL,
  provider_config_id uuid,
  system_mode text,
  model text,
  temperature numeric(3,2),
  max_output_tokens integer,
  is_enabled boolean DEFAULT true NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agents_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT agents_name_length CHECK (char_length(name) between 1 and 80 and name = btrim(name)),
  CONSTRAINT agents_description_length CHECK (description is null or (char_length(description) between 1 and 500 and description = btrim(description))),
  CONSTRAINT agents_avatar_check CHECK (avatar in ('spark', 'code', 'search', 'write', 'book')),
  CONSTRAINT agents_instructions_length CHECK (system_instructions is null or (char_length(system_instructions) between 1 and 8000 and system_instructions = btrim(system_instructions))),
  CONSTRAINT agents_binding_check CHECK (provider_binding in ('system', 'explicit', 'default_provider')),
  CONSTRAINT agents_model_length CHECK (model is null or (char_length(model) between 1 and 128 and model = btrim(model))),
  CONSTRAINT agents_temperature_check CHECK (temperature is null or temperature between 0 and 2),
  CONSTRAINT agents_max_tokens_check CHECK (max_output_tokens is null or max_output_tokens between 1 and 8192),
  CONSTRAINT agents_route_shape CHECK (
    (provider_binding = 'system' AND provider_config_id IS NULL AND system_mode in ('Fast', 'Balanced', 'High') AND model IS NULL AND temperature IS NULL AND max_output_tokens IS NULL)
    OR (provider_binding = 'explicit' AND provider_config_id IS NOT NULL AND system_mode IS NULL AND model IS NOT NULL)
    OR (provider_binding = 'default_provider' AND provider_config_id IS NULL AND system_mode IS NULL AND model IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE public.provider_configs ADD CONSTRAINT provider_configs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.agents ADD CONSTRAINT agents_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.agents ADD CONSTRAINT agents_provider_owner_fk FOREIGN KEY (provider_config_id, user_id) REFERENCES public.provider_configs(id, user_id) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN agent_id uuid;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN agent_name_snapshot text;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN routing_kind text;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN system_mode_snapshot text;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN provider_config_id uuid;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN model_snapshot text;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN instructions_snapshot text;--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN temperature_snapshot numeric(3,2);--> statement-breakpoint
ALTER TABLE public.conversations ADD COLUMN max_output_tokens_snapshot integer;--> statement-breakpoint
ALTER TABLE public.conversations ADD CONSTRAINT conversations_agent_owner_fk FOREIGN KEY (agent_id, user_id) REFERENCES public.agents(id, user_id) ON DELETE SET NULL (agent_id) ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.conversations ADD CONSTRAINT conversations_provider_owner_fk FOREIGN KEY (provider_config_id, user_id) REFERENCES public.provider_configs(id, user_id) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.conversations ADD CONSTRAINT conversations_routing_shape CHECK (
  (routing_kind is null AND agent_id is null AND agent_name_snapshot is null AND system_mode_snapshot is null AND provider_config_id is null AND model_snapshot is null AND instructions_snapshot is null AND temperature_snapshot is null AND max_output_tokens_snapshot is null)
  OR (routing_kind = 'system_mode' AND system_mode_snapshot in ('Fast', 'Balanced', 'High') AND provider_config_id is null AND model_snapshot is null AND agent_name_snapshot is not null)
  OR (routing_kind = 'user_provider' AND system_mode_snapshot is null AND provider_config_id is not null AND model_snapshot is not null AND agent_name_snapshot is not null)
);--> statement-breakpoint
CREATE INDEX provider_configs_user_updated_idx ON public.provider_configs (user_id, updated_at);--> statement-breakpoint
CREATE UNIQUE INDEX provider_configs_one_default_idx ON public.provider_configs (user_id) WHERE is_default;--> statement-breakpoint
CREATE INDEX agents_user_updated_idx ON public.agents (user_id, updated_at);--> statement-breakpoint
CREATE UNIQUE INDEX agents_one_default_idx ON public.agents (user_id) WHERE is_default;--> statement-breakpoint
CREATE INDEX conversations_user_agent_idx ON public.conversations (user_id, agent_id);--> statement-breakpoint
ALTER TABLE public.provider_configs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.provider_configs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY provider_configs_select_own ON public.provider_configs FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY provider_configs_insert_own ON public.provider_configs FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY provider_configs_update_own ON public.provider_configs FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY provider_configs_delete_own ON public.provider_configs FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY agents_select_own ON public.agents FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY agents_insert_own ON public.agents FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY agents_update_own ON public.agents FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY agents_delete_own ON public.agents FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
-- Default privileges grant table SELECT to authenticated. A column revoke does not remove that. Clear it, then grant the safe columns only.
REVOKE ALL ON public.provider_configs FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT (id, user_id, provider_type, name, base_url, key_hint, configuration, is_default, created_at, updated_at), INSERT, UPDATE, DELETE ON public.provider_configs TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;--> statement-breakpoint
REVOKE ALL ON public.agents FROM anon;--> statement-breakpoint
CREATE FUNCTION public.read_own_provider_secret(p_config_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT secret_ciphertext FROM public.provider_configs WHERE id = p_config_id AND user_id = auth.uid() $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.read_own_provider_secret(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.read_own_provider_secret(uuid) TO authenticated;--> statement-breakpoint
CREATE FUNCTION public.enforce_owned_row_cap() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.user_id::text, 0));
  IF TG_TABLE_NAME = 'agents' THEN
    SELECT count(*) INTO n FROM public.agents WHERE user_id = NEW.user_id;
    IF n >= 20 THEN RAISE EXCEPTION 'agent cap' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT count(*) INTO n FROM public.provider_configs WHERE user_id = NEW.user_id;
    IF n >= 10 THEN RAISE EXCEPTION 'provider cap' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_owned_row_cap() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER provider_configs_cap BEFORE INSERT ON public.provider_configs FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_row_cap();--> statement-breakpoint
CREATE TRIGGER agents_cap BEFORE INSERT ON public.agents FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_row_cap();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_agents_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.updated_at = pg_catalog.clock_timestamp(); RETURN NEW; END; $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_agents_updated_at() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_agents_updated_at() TO authenticated;--> statement-breakpoint
CREATE TRIGGER provider_configs_set_updated_at BEFORE UPDATE ON public.provider_configs FOR EACH ROW EXECUTE FUNCTION public.set_agents_updated_at();--> statement-breakpoint
CREATE TRIGGER agents_set_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.set_agents_updated_at();--> statement-breakpoint
-- Recreate this user link last so account delete removes agents before provider configs. RESTRICT still blocks a direct provider delete.
ALTER TABLE public.provider_configs DROP CONSTRAINT provider_configs_user_id_users_id_fk;--> statement-breakpoint
ALTER TABLE public.provider_configs ADD CONSTRAINT provider_configs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action;
