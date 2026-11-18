# Account sign-in setup

The Account page exposes Google linking, password setup, and passkeys behind **Account Sign-in Settings**, beside Sign out. Google linking uses `auth.linkIdentity()` for the existing Supabase user. Apple and Microsoft sign-in and linking are not offered. Verified users can set or change an email/password sign-in using `auth.updateUser({ password })`; password fields are cleared after a confirmed save. Passkey creation uses `auth.registerPasskey()`; the login page uses `auth.signInWithPasskey()`. Provider linking and passkey registration never create local placeholder credentials.

For the hosted project:

1. Configure Google in Supabase Authentication → Sign In / Providers. Keep Apple and Azure (Microsoft) disabled. Enable **manual identity linking**.
2. Allow the site's `/auth/callback` URL in Authentication → URL Configuration. Successful linking returns to `/tools`; cancelled or failed linking returns there with an error.
3. Enable passkeys in Authentication → Passkeys. Set the display name to **Velocity Swimming**, the relying party ID to the site's bare domain, and the allowed origins to the exact HTTPS origins used by the app. Keep the relying party ID stable after registration begins.
4. Enable Google's login button with `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` and rebuild/redeploy the website. This public flag is embedded at build time. Email code sign-in remains available.

The installed Supabase SDK enables passkey methods by default; its old `experimental.passkey` flag is deprecated and unnecessary.

The local config enables manual linking and passkeys for `localhost`, with origins `http://localhost:3000` and `http://localhost:3001`. Restart the local Supabase stack after changing auth config, then open the app on **localhost** to register or use passkeys. An app opened at `127.0.0.1` can still use email sign-in, but will not match the configured passkey relying party. Provider credentials are still required for local OAuth linking.

References: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys).

## Athlete following and family preview

Apply `supabase/migrations/20261116194519_account_followed_athletes.sql` before deploying this account page. Primary and favorite athlete selections are stored privately for each account, using canonical public athlete IDs. Selecting or removing an athlete saves automatically; writes are serialized so slower responses cannot replace newer edits. Failed saves preserve the selection and offer a retry. The search/load/save functions enforce account ownership; they do not grant ownership of an athlete or change Velocity Times yet.

Velocity Family appears only when the signed-in email has a family membership. Its additional accounts are labeled sample content until the family account backend is ready. Admin client previews do not change which family appears on the Account page.

For local verification, run `npm run test:profile:database`, `npm run test:profile:browser`, and `npm run test:passkey:browser` with Node 24 and the local app running on port 3001. The passkey check uses a virtual authenticator and removes its test credential afterward.
