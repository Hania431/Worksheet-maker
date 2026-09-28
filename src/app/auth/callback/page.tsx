"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function completeSignIn() {
      const params = new URLSearchParams(window.location.search);
      const callbackError = params.get("error_description") ?? params.get("error");
      if (callbackError) {
        setError(callbackError);
        return;
      }

      const code = params.get("code");
      const supabase = getSupabaseClient();
      if (!code || !supabase) {
        setError(!supabase ? "Supabase is not configured." : "The sign-in link is missing its authorization code.");
        return;
      }

      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
        router.replace("/");
        router.refresh();
      } catch (exchangeError) {
        setError(exchangeError instanceof Error ? exchangeError.message : "Google sign-in could not be completed.");
      }
    }

    void completeSignIn();
  }, [router]);

  if (error) {
    return (
      <main className="loading-page">
        <section className="auth-modal" role="alert">
          <h1>Sign-in failed</h1>
          <p className="form-error">{error}</p>
          <Link className="button button-primary" href="/">Return to Classkit</Link>
        </section>
      </main>
    );
  }

  return <main className="loading-page"><span>Completing sign-in…</span></main>;
}
