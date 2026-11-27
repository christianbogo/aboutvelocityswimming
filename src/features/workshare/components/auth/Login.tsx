import { withUpdateHold } from "@/lib/update-safety";
import { useUpdateBlocker } from "@/hooks/useUpdateBlocker";
import { errorCode, errorMessage } from "../../lib/errors";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { signInWithEmailAndPassword } from "@/lib/auth";
import { browserClient } from "@/lib/supabase/client";
import {
  accountSecurityError,
  configuredSignInProviders,
  signInWithAccountPasskey,
  signInWithAccountProvider,
  type AccountProvider,
} from "@/lib/account-security";
import { auth } from "../../lib/backend";
import { useAuth } from "@/features/auth/context";
import { getToolsHome } from "@/lib/tools-access";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";
import {
  Mail,
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  KeyRound,
} from "lucide-react";

export function Login() {
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [usePasswordFallback, setUsePasswordFallback] = useState(false);
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] =
    useState<AccountProvider | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const otpInputRef = useRef<HTMLInputElement>(null);
  const passkeyRequest = useRef<AbortController | null>(null);
  const { user, loading: authLoading, logout } = useAuth();
  useUpdateBlocker(
    authLoading || loading || providerLoading !== null || passkeyLoading,
  );
  const toolsHome = getToolsHome(user);
  const canOpenTools = toolsHome !== "/login";

  useEffect(() => () => passkeyRequest.current?.abort(), []);

  useEffect(() => {
    if (!authLoading && canOpenTools) {
      // A signed-out prefetch may have cached a redirect back to login.
      window.location.replace(toolsHome);
    }
  }, [authLoading, canOpenTools, toolsHome]);

  useEffect(() => {
    if (step === "code" && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [step]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) return;

    setError("");
    setSuccessMessage("");
    setLoading(true);

    try {
      const { error } = await withUpdateHold(() =>
        browserClient().auth.signInWithOtp({ email: email.trim() }),
      );
      if (error) throw error;
      setStep("code");
      setCountdown(60);
      setSuccessMessage(`We sent an 8-digit code to ${email.trim()}`);
    } catch (err: unknown) {
      console.error("OTP send error:", err);
      if (
        errorCode(err) === "functions/not-found" ||
        errorCode(err) === "not-found"
      ) {
        setError(
          "Email sign-in is temporarily unavailable. Please try again shortly.",
        );
      } else {
        setError(
          errorMessage(err) ||
            "Failed to send verification code. Please check your email.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = otpCode.replace(/\D/g, "");
    if (cleanCode.length !== 8) {
      setError("Please enter all 8 digits of your verification code.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const { error } = await withUpdateHold(() =>
        browserClient().auth.verifyOtp({
          email: email.trim(),
          token: cleanCode,
          type: "email",
        }),
      );
      if (error) throw error;
    } catch (err: unknown) {
      console.error("OTP verify error:", err);
      setError(
        errorMessage(err) || "Invalid or expired code. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: unknown) {
      setError(errorMessage(err) || "Failed to log in with password.");
    } finally {
      setLoading(false);
    }
  };

  const handleProviderLogin = async (provider: AccountProvider) => {
    if (loading || providerLoading || passkeyLoading) return;
    setError("");
    setSuccessMessage("");
    setProviderLoading(provider);
    try {
      await signInWithAccountProvider(provider);
    } catch (err: unknown) {
      setError(
        accountSecurityError(
          err,
          "Sign-in could not be completed. Please try again or use your email code.",
        ),
      );
      setProviderLoading(null);
    }
  };

  const handlePasskeyLogin = async () => {
    if (loading || providerLoading !== null || passkeyLoading) return;
    const controller = new AbortController();
    passkeyRequest.current = controller;
    setError("");
    setSuccessMessage("");
    setPasskeyLoading(true);
    try {
      await signInWithAccountPasskey(controller.signal);
    } catch (err: unknown) {
      if (!controller.signal.aborted)
        setError(
          accountSecurityError(
            err,
            "Passkey sign-in could not be completed. Please try again or use your email code.",
          ),
        );
    } finally {
      if (!controller.signal.aborted) setPasskeyLoading(false);
      if (passkeyRequest.current === controller) passkeyRequest.current = null;
    }
  };

  const handleOtpChange = (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 8);
    setOtpCode(cleaned);
    setError("");
  };

  return (
    <div className="min-h-[calc(100svh-var(--site-header-height))] bg-bg flex flex-col items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-md flex flex-col items-center">
        <Card className="w-full bg-surface shadow-sm border border-border p-6 sm:p-8">
          <h2 className="text-2xl font-bold mb-1 text-text-primary text-center">
            {step === "code" ? "Enter Verification Code" : "Sign In to Portal"}
          </h2>
          <p className="text-xs text-slate-500 text-center mb-6">
            {step === "code"
              ? "Check your email for the 8-digit code"
              : "Sign in or create an account with your email"}
          </p>

          <p className="text-sm text-center mb-5">
            Sign in with any email to access Account, Times, Rankings, Records,
            and Standards.
          </p>
          {user && !authLoading && !canOpenTools && (
            <div className="text-sm text-center mb-5 space-y-2" role="status">
              <p>This account does not have access to the tools.</p>
              <button
                type="button"
                className="underline"
                onClick={async () => {
                  try {
                    await logout();
                  } catch {
                    setError("Could not sign out. Please try again.");
                  }
                }}
              >
                Sign out to switch accounts
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3.5 mb-5 text-sm font-medium text-error-text bg-error-bg border border-error-border rounded-xl"
            >
              {error}
            </div>
          )}

          {successMessage && step === "code" && (
            <div
              role="status"
              className="p-3.5 mb-5 text-sm font-medium text-success-text bg-success-bg border border-success-border rounded-xl flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Passwordless OTP Flow */}
          {!usePasswordFallback && (
            <>
              {step === "email" ? (
                <form onSubmit={handleSendCode} className="space-y-4">
                  <div>
                    <label
                      htmlFor="login-email"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <Input
                        id="login-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="family@example.com"
                        autoComplete="email"
                        className="pl-10"
                      />
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-full mt-2"
                    disabled={
                      loading ||
                      providerLoading !== null ||
                      passkeyLoading ||
                      !email.trim()
                    }
                  >
                    {loading ? "Sending Code..." : "Send 8-Digit Code"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleVerifyCode} className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label
                        htmlFor="login-code"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                      >
                        8-Digit Code
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setStep("email");
                          setOtpCode("");
                          setError("");
                        }}
                        className="text-xs text-brand-accent hover:text-brand-accent-hover font-medium inline-flex items-center gap-1"
                      >
                        <ArrowLeft className="w-3 h-3" /> Change email
                      </button>
                    </div>

                    <Input
                      id="login-code"
                      ref={otpInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      required
                      value={otpCode}
                      onChange={(e) => handleOtpChange(e.target.value)}
                      placeholder="12345678"
                      className="text-center font-mono text-2xl tracking-[0.4em] h-14 bg-bg font-bold"
                      autoComplete="one-time-code"
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="w-full"
                    disabled={loading || passkeyLoading || otpCode.length !== 8}
                  >
                    {loading ? "Verifying..." : "Verify & Sign In"}
                  </Button>

                  <div className="text-center pt-1">
                    {countdown > 0 ? (
                      <p className="text-xs text-slate-400">
                        Resend code in{" "}
                        <span className="font-semibold text-slate-600">
                          {countdown}s
                        </span>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendCode()}
                        disabled={loading}
                        className="text-xs font-semibold text-brand-accent hover:text-brand-accent-hover transition-colors"
                      >
                        Didn&apos;t get a code? Resend
                      </button>
                    )}
                  </div>
                </form>
              )}
            </>
          )}

          {/* Password Fallback Form */}
          {usePasswordFallback && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Email Address
                </label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="family@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Password
                </label>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full mt-2"
                disabled={loading || providerLoading !== null || passkeyLoading}
              >
                {loading ? "Signing in..." : "Sign In with Password"}
              </Button>
              <p className="text-xs leading-relaxed text-text-secondary">
                To set or reset your password, sign in with an email code or
                Google, then open Manage Account on your Account page.
              </p>
            </form>
          )}

          {/* Password Fallback Toggle */}
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setUsePasswordFallback(!usePasswordFallback);
                setError("");
              }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors inline-flex items-center gap-1"
            >
              <KeyRound className="w-3 h-3" />
              {usePasswordFallback
                ? "Use 8-digit email code instead"
                : "Sign in with password instead"}
            </button>
          </div>

          <div className="mt-4 text-center">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loading || providerLoading !== null || passkeyLoading}
              onClick={() => void handlePasskeyLogin()}
            >
              <Fingerprint className="mr-2 size-4" aria-hidden="true" />
              {passkeyLoading
                ? "Waiting for your passkey…"
                : "Sign in with passkey"}
            </Button>
          </div>

          {/* Show OAuth only after each provider is configured in Supabase. */}
          {configuredSignInProviders.length > 0 && (
            <div className="mt-2 space-y-2 text-center">
              {configuredSignInProviders.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void handleProviderLogin(provider.id)}
                  disabled={
                    loading || providerLoading !== null || passkeyLoading
                  }
                >
                  {provider.id === "google" && (
                    <svg
                      className="mr-2 size-4 shrink-0"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        fill="#4285F4"
                        d="M21.6 12.227c0-.709-.064-1.391-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.996 3.018v2.509h3.232c1.891-1.741 2.982-4.305 2.982-7.35Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 22c2.7 0 4.964-.895 6.618-2.423l-3.232-2.509c-.895.6-2.041.955-3.386.955-2.605 0-4.809-1.759-5.595-4.123H3.064v2.591A9.996 9.996 0 0 0 12 22Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M6.405 13.9A6.01 6.01 0 0 1 6.091 12c0-.659.114-1.3.314-1.9V7.509H3.064A9.996 9.996 0 0 0 2 12c0 1.614.386 3.141 1.064 4.491L6.405 13.9Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C16.959 2.991 14.695 2 12 2a9.996 9.996 0 0 0-8.936 5.509L6.405 10.1C7.191 7.736 9.395 5.977 12 5.977Z"
                      />
                    </svg>
                  )}
                  {providerLoading === provider.id
                    ? `Connecting to ${provider.name}…`
                    : `Sign in with ${provider.name}`}
                </Button>
              ))}
              <p className="text-xs leading-relaxed text-text-secondary">
                Google shares your basic profile and email to create or connect
                your Velocity Swimming account.{" "}
                <Link href="/privacy#google-user-data" className="underline">
                  How we use Google data
                </Link>
                .
              </p>
            </div>
          )}
          <p className="mt-4 text-center text-xs leading-relaxed text-text-secondary">
            By using your account, you agree to our{" "}
            <Link href="/terms" className="underline">
              Terms of Service
            </Link>
            . Read our{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>{" "}
            for information about your data and deletion requests.
          </p>
        </Card>
        <p className="mt-4 text-center text-sm text-slate-500">
          <a href="/tools" className="hover:underline">
            ← Back to Account
          </a>
        </p>
      </div>
    </div>
  );
}
