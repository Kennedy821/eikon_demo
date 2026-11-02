"use client";

import { useState } from "react";
import Link from "next/link";
import { registerUser } from "@/lib/api";

/** Ports the Streamlit registration form (eikon_registration_form.py). */

const PAGE_BACKGROUND = {
  // Same treatment as /login so the two pages read as one flow.
  backgroundImage:
    "linear-gradient(180deg, rgba(4, 14, 32, 0.42) 0%, rgba(4, 14, 32, 0.42) 100%), url('/industrial_image_dark.png')",
  backgroundColor: "#000000",
  backgroundSize: "contain",
  backgroundPosition: "center center",
  backgroundRepeat: "no-repeat",
} as const;

const TEXT_SHADOW = { textShadow: "0 1px 2px rgba(0,0,0,0.45)" } as const;

const FIELD_CLASS =
  "w-full rounded border border-white/20 bg-white/90 px-3 py-2 text-gray-900";

export default function SignUpPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountType, setAccountType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);

  const emailMismatch = Boolean(confirmEmail) && email.trim() !== confirmEmail.trim();
  const passwordMismatch = Boolean(confirmPassword) && password !== confirmPassword;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (emailMismatch) return setError("Your email addresses don't match");
    if (passwordMismatch) return setError("Your passwords don't match");
    if (!accountType) return setError("Choose what you'll use the account for");

    setBusy(true);
    try {
      await registerUser({
        firstName,
        lastName,
        email: email.trim(),
        password,
        accountType,
      });
      setRegistered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (registered) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6" style={PAGE_BACKGROUND}>
        <div className="w-full max-w-md space-y-4 rounded-lg border border-white/10 bg-black/50 p-8 text-center shadow-xl backdrop-blur-sm">
          <h1 className="text-3xl font-bold text-white" style={TEXT_SHADOW}>
            Welcome to EIKON, {firstName}
          </h1>
          <p className="text-sm text-white/80" style={TEXT_SHADOW}>
            Your account is registered with a £5 starting credit balance.
          </p>
          <Link
            href="/login"
            className="block w-full rounded bg-eikon-accent py-2 font-medium text-white"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6" style={PAGE_BACKGROUND}>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-lg border border-white/10 bg-black/50 p-8 shadow-xl backdrop-blur-sm"
      >
        <h1 className="text-4xl font-bold text-white" style={TEXT_SHADOW}>
          EIKON
        </h1>
        <p className="text-sm text-white/80" style={TEXT_SHADOW}>
          Create an account
        </p>

        <div className="flex gap-3">
          <input
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={FIELD_CLASS}
            autoComplete="given-name"
            required
          />
          <input
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={FIELD_CLASS}
            autoComplete="family-name"
            required
          />
        </div>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD_CLASS}
          autoComplete="email"
          required
        />
        <div className="space-y-1">
          <input
            type="email"
            placeholder="Confirm email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            className={FIELD_CLASS}
            autoComplete="email"
            required
          />
          {emailMismatch && (
            <p className="text-sm text-red-300">Your email addresses don&apos;t match</p>
          )}
        </div>

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD_CLASS}
          autoComplete="new-password"
          required
        />
        <div className="space-y-1">
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={FIELD_CLASS}
            autoComplete="new-password"
            required
          />
          {passwordMismatch && (
            <p className="text-sm text-red-300">Your passwords don&apos;t match</p>
          )}
        </div>

        <select
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
          className={FIELD_CLASS}
          required
        >
          <option value="">Account type</option>
          <option value="student">Student</option>
          <option value="commercial">Commercial</option>
        </select>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-eikon-accent py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Registering…" : "Register"}
        </button>

        <p className="text-center text-sm text-white/70" style={TEXT_SHADOW}>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-white underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
