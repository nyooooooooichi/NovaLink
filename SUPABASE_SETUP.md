# NovaLink authentication setup

NovaLink uses Supabase Auth for Apple, Discord, Google, and email/password authentication.

## 1. Create a Supabase project

1. Create a project at https://supabase.com/dashboard.
2. Open Project Settings > API.
3. Copy the Project URL and the publishable/anon public key.

## 2. Configure Render environment variables

In the NovaLink Render Web Service, open Environment and add:

- `SUPABASE_URL`: the Project URL
- `SUPABASE_ANON_KEY`: the publishable/anon public key

Do not put a service-role key in either variable. The browser is allowed to receive the publishable/anon key; the service-role key must remain secret and is not used by this app.

Save the changes and redeploy the service.

## 3. Configure Supabase Auth URLs

In Supabase Dashboard > Authentication > URL Configuration:

- Set Site URL to the deployed NovaLink origin, for example `https://novalink-tnfy.onrender.com`.
- Add that same origin to the Redirect URLs allowlist.
- For local development, also allow `http://localhost:3000/**`.

## 4. Enable email/password

In Authentication > Sign In / Providers, enable Email. Configure email confirmation according to your preference. When confirmation is enabled, users must open the confirmation email before their account becomes an active session.

## 5. Enable Google, Discord, and Apple

In Authentication > Sign In / Providers, enable each provider and enter the OAuth credentials obtained from that provider's developer console.

Supabase displays a provider callback URL in its provider settings. Register that exact callback URL with Google, Discord, and Apple. Do not use the NovaLink website URL as the provider callback URL; NovaLink is supplied as the post-login redirect URL.

Apple also requires an Apple Developer account and the Sign in with Apple service configuration. Google and Discord require their own OAuth application credentials.

## 6. Create the avatar bucket and policies

Open Supabase Dashboard > SQL Editor and run the complete contents of `supabase/setup.sql`.

This creates a public-read `avatars` bucket. Authenticated users can upload or replace only the avatar stored under their own user ID. Uploaded images are resized in the browser and stored as JPEG.

## 7. Verify

After Render redeploys and the provider setup is complete:

1. Open NovaLink and select Login / Register.
2. Test email registration and login.
3. Test Google, Discord, and Apple separately.
4. Open My Account, change the username, upload an icon, and save.

## Notes

- Room joining remains available without an account; accounts are currently optional.
- The profile name is used to prefill the meeting display name, which can still be changed.
- Provider login cannot work until that provider's OAuth credentials are configured in Supabase.
