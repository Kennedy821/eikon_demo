"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

/** Replaces render_login_page() in eikon_demo_app_beta.py. */
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await login(email, password);
    setBusy(false);
    if (ok) router.replace("/chat");
    else setError("Authentication failed. Check your credentials.");
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        // Dark overlay over the industrial background image, on a black
        // backdrop — mirrors _get_login_page_css in eikon_demo_app_beta.py.
        backgroundImage:
          "linear-gradient(180deg, rgba(4, 14, 32, 0.42) 0%, rgba(4, 14, 32, 0.42) 100%), url('/industrial_image_dark.png')",
        backgroundColor: "#000000",
        backgroundSize: "contain",
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-white/10 bg-black/50 p-8 shadow-xl backdrop-blur-sm"
      >
        <h1
          className="text-4xl font-bold text-white"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
        >
          EIKON
        </h1>
        <p className="text-sm text-white/80" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}>
          Geospatial intelligence platform
        </p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-white/20 bg-white/90 px-3 py-2 text-gray-900"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-white/20 bg-white/90 px-3 py-2 text-gray-900"
          required
        />

        {error && <p className="text-sm text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-eikon-orange py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
