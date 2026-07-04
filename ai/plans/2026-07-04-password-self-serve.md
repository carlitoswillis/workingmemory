# Self-serve password recovery (no operator in the loop)

_Planned 2026-07-04. NOT built — awaiting owner green-light (plan-before-building)._

## Problem
Multiple-accounts v1 shipped with **no forgot-password path**: change-password on
`/login` works only if you know the current password; a forgotten password today
means the owner edits the hosted DB by hand. The owner explicitly does not want
to be that helpdesk. Signup collects no email, and the project deliberately has
no hosted dependencies, so the classic email-reset flow isn't free.

## Recommendation: recovery codes (v1), optional email reset later (v2)

### v1 — one-time recovery codes (build this)
The Bitwarden/1Password "recovery kit" pattern, sized down:

- **Signup** generates ~8 one-time codes (crypto-random, grouped base32 like
  `Q7RD-2MHK-XW4P`), shown **once** on a post-signup interstitial with a
  "download as .txt" button. Stored scrypt-hashed — same hashing already used
  for passwords, **no new deps**.
- **`/reset`**: username + one code → set a new password; the code is consumed.
  Response is identical for unknown-username and wrong-code (no enumeration).
  New per-IP bucket in middleware (burst 3, like `/signup`).
- **Signed-in (`/login` account section)**: "Regenerate recovery codes" —
  invalidates all old codes, shows a fresh kit once. This is also how the
  migrated `owner` account (bootstrapped with no codes) gets its kit.

**Why this fits the project:**
- Zero external services, zero PII, zero background processes — consistent with
  the one-SQLite-file, no-cloud ethos.
- Fully self-serve: nobody ever asks the operator.
- **Future-proof for the encryption backlog item**: with password-derived keys,
  a plain email reset would destroy data; recovery codes can each wrap the
  account data key, so the same kit later becomes the key-recovery mechanism.
  Building this first makes encryption *easier*, not harder.
- Honest failure mode: lose the password AND the kit → gone. The signup page
  already says "write it down"; this upgrades "no reset, period" to "reset if
  you kept your kit".

**Implementation sketch (small — reuses v1 auth machinery):**
- Schema (additive, via `migrateDb`): `recovery_codes (id, user_id → users,
  code_hash, created_at, used_at)`. No touch to items/history/triggers.
- `lib/users.ts`: `generateRecoveryCodes(db, userId)` (returns plaintext once,
  replaces existing), `consumeRecoveryCode(db, username, code)` (scrypt-verify
  against the user's unused codes; constant-shaped result).
- UI: signup interstitial; "Forgot password?" link on `/login` → `/reset`;
  regenerate section when signed in.
- Tests (plain node, alongside `lib/users.test.ts`): generate → consume →
  single-use; regenerate invalidates; unknown user == wrong code; reset actually
  changes the hash.

### v2 — optional email reset (only if real users ask)
- Optional email field (account page, never required), verified by a send.
- Tokenized reset link; sender = **Resend** free tier (100/day) or any SMTP —
  lighter than reintroducing Supabase just for auth emails (Supabase stays in
  reserve per the multiple-accounts decision, committed nowhere).
- Costs: PII storage, deliverability ops, an external dependency, and a
  conflict with the future encryption item (email reset can't recover a
  password-derived key — it would have to lean on the v1 codes anyway).
- Verdict: defer; v1 codes remove the operator from the loop on their own.

### Rejected
- **Supabase Auth**: reintroduces a hosted platform + user-table split for one
  feature; conflicts with the single-replicated-SQLite-file design.
- **Security questions**: weak, guessable, extra PII.
- **Operator reset CLI/endpoint**: still puts the owner in the loop — the exact
  thing this plan exists to remove (though `/api/import` of a backup remains the
  disaster-recovery backstop regardless).

## Rollout
1. Build + test locally (flag-off mode inert, as with all account features).
2. Deploy; sign in as `owner` → regenerate codes → store the kit somewhere real
   (password manager / printed).
3. Update `/signup` + `/login` copy ("no reset" → "use a recovery code").
4. `PROJECT_STATE.md` + `ARCHITECTURE.md` pass.
