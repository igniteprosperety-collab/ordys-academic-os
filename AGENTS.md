- App source is imported selectively from the official GitHub main; never overwrite `src/integrations/*`, `src/start.ts`, `src/server.ts` or `.env` with the repo's copies — they carry the Lovable preview session and Cloud wiring.
- Web Google sign-in uses the Lovable broker (`@/integrations/lovable`), loaded dynamically in `native-auth.ts`; Android keeps the native Capacitor flow — managed Cloud Google has no raw Supabase OAuth credentials.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Asaas billing from PR #320 lives as an archive under `ports/asaas-pr320/` (Edge Functions cannot be created in this TanStack project); port handlers to server routes before enabling. Why: keeps the official source intact without deploying anything.
