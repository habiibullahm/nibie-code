-- Tighten action_runs INSERT ownership: room and message must belong to the same owner/conversation.
-- Additive policy replace only — no table rewrite.

DROP POLICY IF EXISTS action_runs_insert_own ON public.action_runs;--> statement-breakpoint
CREATE POLICY action_runs_insert_own ON public.action_runs FOR INSERT TO authenticated
	WITH CHECK (
		user_id = (SELECT auth.uid())
		AND EXISTS (
			SELECT 1 FROM public.conversations c
			WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
		)
		AND (
			room_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.rooms r
				WHERE r.id = room_id AND r.user_id = (SELECT auth.uid())
			)
		)
		AND (
			message_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.messages m
				WHERE m.id = message_id
					AND m.conversation_id = conversation_id
					AND m.user_id = (SELECT auth.uid())
			)
		)
	);
