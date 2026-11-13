-- Remove the untracked trigger discovered on auth.users that marks every new
-- email address as confirmed before Auth can enforce ownership verification.
--
-- DEPLOYMENT PRECONDITION:
-- First verify that Lovable Cloud's default Auth sender delivers a signup
-- confirmation to an ordinary Gmail address while Auto-confirm email is off.
-- The paid custom-domain Emails feature is not required merely to use the
-- default Auth sender. If the default sender cannot deliver and no alternative
-- delivery path is configured, do not apply this migration: new email/password
-- signups would remain unconfirmed and unable to sign in.
--
-- The production catalog confirmed the trigger's function is
-- public.ordys_auto_confirm_email() and that the trigger is attached to auth.users.
DROP TRIGGER IF EXISTS ordys_auto_confirm_email_trigger ON auth.users;
DROP FUNCTION IF EXISTS public.ordys_auto_confirm_email();
