# Fix the sign-in redirect loop

## Cause
The login itself succeeds (`/token` returned 200). The loop is a client-side race:

- `auth.tsx` navigates to `/reports` immediately after `signInWithPassword()`.
- `AuthProvider` updates its `user` state asynchronously through `onAuthStateChange()`.
- `/reports` can therefore mount while `_app.tsx` still sees the previous `user = null` state and sends the browser back to `/auth`.
- The auth page separately calls `getSession()` and sends it to `/reports` again, creating the rapid back-and-forth.

The repeated `trackevents` requests shown in DevTools originate from browser extensions and are not the app’s authentication failure.

## Implementation
1. Make `AuthProvider` the single source of truth for post-login session state.
2. Update the auth page to navigate to `/reports` only after `useAuth()` reports that authentication has finished and a user exists.
3. Remove the auth page’s duplicate `getSession()` redirect and the immediate navigation after password sign-in.
4. Keep the protected app shell’s unauthenticated redirect, but use history replacement so `/reports` is not retained as a stale back-navigation entry.
5. Verify one successful login produces a single `/auth` → `/reports` transition and that signed-out access to `/reports` still returns to `/auth` without oscillation.