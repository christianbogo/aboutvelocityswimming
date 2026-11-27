# Account sign-in setup

Any verified email can sign in or create an account using an email code and access Account, Times, Rankings, Records, and Standards. No approved-email list is required for those tools. All accounts land on Account after sign-in unless returning to an allowed destination. Admin appears for database-authorized staff. Data (including its views) is restricted to `christiancutter02@gmail.com`; staff authority alone does not unlock them. These restrictions apply to navigation, direct page requests, and backing endpoints. Workshare Tracking appears only when the signed-in email is associated with a Workshare account.

The Account page exposes Google linking, password setup, and passkeys behind **Manage Account**, beside Sign out. Google linking uses `auth.linkIdentity()` for the existing Supabase user. Apple and Microsoft sign-in and linking are not offered. Verified users can set or change an email/password sign-in using `auth.updateUser({ password })`; password fields are cleared after a confirmed save. Passkey creation uses `auth.registerPasskey()`; the login page uses `auth.signInWithPasskey()`. Provider linking and passkey registration never create local placeholder credentials.

For the hosted project:

1. Configure Google in Supabase Authentication → Sign In / Providers. Keep Apple and Azure (Microsoft) disabled. Enable **manual identity linking**.
2. Allow the site's `/auth/callback` URL in Authentication → URL Configuration. Successful linking returns to `/tools`; cancelled or failed linking returns there with an error.
3. Enable passkeys in Authentication → Passkeys. Set the display name to **Velocity Swimming**, the relying party ID to the site's bare domain, and the allowed origins to the exact HTTPS origins used by the app. Keep the relying party ID stable after registration begins.
4. Enable Google's login button with `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` and rebuild/redeploy the website. This public flag is embedded at build time. Email code sign-in remains available.

The installed Supabase SDK enables passkey methods by default; its old `experimental.passkey` flag is deprecated and unnecessary.

The local config enables manual linking and passkeys for `localhost`, with origins `http://localhost:3000` and `http://localhost:3001`. Restart the local Supabase stack after changing auth config, then open the app on **localhost** to register or use passkeys. An app opened at `127.0.0.1` can still use email sign-in, but will not match the configured passkey relying party. Provider credentials are still required for local OAuth linking.

References: [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys).

## Google brand verification

The public homepage describes the website and optional Google sign-in. Its footer links to both legal pages, and sign-in and account-linking disclosures link directly to the Google data section of the Privacy Policy. These routes are public and do not require a session.

After deploying the November 19, 2026 policy updates, use these exact values in Google Auth Platform → Branding for this site's production project:

| Field | Value |
| --- | --- |
| App name | Velocity Swimming |
| Application home page | https://aboutvelocityswimming.com |
| Application privacy policy | https://aboutvelocityswimming.com/privacy |
| Application terms of service | https://aboutvelocityswimming.com/terms |
| Authorized domain | aboutvelocityswimming.com |

Confirm the final public URLs after any canonical redirects and use the same host in Branding. Verify ownership of that domain in Google Search Console using an account that owns or edits the Cloud project. Keep the support email and project contacts monitored. In Data Access, request only `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/userinfo.profile`; this app does not implement Gmail, Drive, Contacts, or private Calendar access. The separate public team calendar does not require user OAuth scopes.

Keep the Supabase-provided Google callback URL in the Google OAuth client's authorized redirect URIs; it is distinct from the website's `/auth/callback` URL allowed in Supabase. Check that the production consent screen uses the same app name and policy URLs, and that anonymous visitors can open the homepage and legal pages, before resubmitting. Policy edits alone do not verify domain ownership or submit the Cloud project for review.

Account and Google data deletion requests go to `execboard@velocity-swimming.com`. The team must verify the requester and remove the authentication user and linked identities through its authorized account administration process, reviewing stored files and associated account data as needed. Do not treat Google access revocation or sign-out as deletion. Retain separate financial, safety, volunteer, or historical competition records only when justified by the purposes in the Privacy Policy.

References: [Google verification requirements](https://support.google.com/cloud/answer/13464321), [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Athlete following and Workshare accounts

Primary and favorite athlete selections are stored privately for each account, using canonical public athlete IDs. Selecting or removing an athlete saves automatically; writes are serialized so slower responses cannot replace newer edits. Failed saves preserve the selection and offer a retry. My Times uses these saved preferences, and athlete links open that athlete's results. The search/load/save functions enforce account ownership; following an athlete does not grant permission to edit their data.

Workshare Tracking reads real accounts associated with the verified signed-in email. The former sample Velocity Family card and its legacy family-membership lookup have been removed. Authentication is shared across the website through `src/features/auth`; Workshare is a consumer of that identity.

For local verification, run `npm run test:profile:database` and `npm run test:smoke:browser` with Node 24 and the seeded local app running on port 3001. The smoke check covers current account settings, athlete following, persistence, and sign-in/out. The former profile browser script depended on the removed sample-family UI and has been retired. `npm run test:passkey:browser` remains a targeted check using localhost and a virtual authenticator; it removes its test credential afterward. See [repository verification](verification.md) for the full CI coverage.
