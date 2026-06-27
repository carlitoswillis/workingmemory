"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card-in w-full max-w-sm">
        <div className="mb-1 flex items-center gap-2.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--now)" }}
            aria-hidden
          />
          <h1 className="font-display text-3xl font-medium tracking-tight text-[var(--text-hi)]">
            Working Memory
          </h1>
        </div>
        <p className="mb-7 font-display text-sm italic text-[var(--text-lo)]">
          {mode === "signin"
            ? "Pick up where your mind left off."
            : "A place for what's on your mind — and what used to be."}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-[var(--veil-soft)] bg-[rgba(8,10,18,0.6)] px-3.5 py-2.5 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-[var(--veil-soft)] bg-[rgba(8,10,18,0.6)] px-3.5 py-2.5 text-sm text-[var(--text-hi)] placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
          />

          {error && <p className="text-sm text-[#e88f7a]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--bg-0)] transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--now)" }}
          >
            {loading ? "…" : mode === "signin" ? "Sign in" : "Create your board"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="mt-5 text-xs text-[var(--text-lo)] transition-colors hover:text-[var(--text-mid)]"
        >
          {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
