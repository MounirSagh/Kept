import { useSignIn } from "@clerk/react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { AuthError, AuthField, AuthLayout, Divider, PasswordField, SubmitButton, TextButton } from "@/components/auth/AuthLayout";
import { SocialButtons, type SocialStrategy } from "@/components/auth/SocialButtons";
import { errorText, useAuthLink, useFinishNavigation, useRedirectTarget } from "@/lib/auth";

/**
 * - credentials: email + password (or Google / Microsoft)
 * - second-factor: a code from an authenticator app or email, for MFA or a new device
 * - reset-code / reset-password: "Forgot password?", by emailed code
 */
type Step = "credentials" | "second-factor" | "reset-code" | "reset-password";
type SecondFactor = "totp" | "email_code";

export function SignInPage() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const target = useRedirectTarget();
  const signUpLink = useAuthLink("/sign-up");
  const navigate = useFinishNavigation(target);

  const [step, setStep] = useState<Step>("credentials");
  const [secondFactor, setSecondFactor] = useState<SecondFactor>("email_code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [social, setSocial] = useState<SocialStrategy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pending = fetchStatus === "fetching";
  const globalError = errorText(errors.global?.[0]);

  async function finish() {
    await signIn.finalize({ navigate });
  }

  /** After a password is accepted: done, or ask for the second factor Clerk wants. */
  async function continueAfterPassword() {
    if (signIn.status === "complete") return finish();
    if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
      const usesTotp = signIn.supportedSecondFactors.some((f) => f.strategy === "totp");
      // Device trust is always confirmed by email; MFA prefers the authenticator app when one is set up.
      const factor: SecondFactor = usesTotp && signIn.status === "needs_second_factor" ? "totp" : "email_code";
      if (factor === "email_code") {
        const { error } = await signIn.mfa.sendEmailCode();
        if (error) return;
      }
      setSecondFactor(factor);
      setCode("");
      setStep("second-factor");
    }
  }

  async function onCredentials(e: FormEvent) {
    e.preventDefault();
    const { error } = await signIn.password({ identifier: email.trim(), password });
    if (!error) await continueAfterPassword();
  }

  async function onSecondFactor(e: FormEvent) {
    e.preventDefault();
    const { error } =
      secondFactor === "totp"
        ? await signIn.mfa.verifyTOTP({ code: code.trim() })
        : await signIn.mfa.verifyEmailCode({ code: code.trim() });
    if (!error && signIn.status === "complete") await finish();
  }

  async function onForgotPassword() {
    if (!email.trim()) {
      setNotice("Enter your email first, then choose Forgot password.");
      return;
    }
    setNotice(null);
    const created = await signIn.create({ identifier: email.trim() });
    if (created.error) return;
    const { error } = await signIn.resetPasswordEmailCode.sendCode();
    if (error) return;
    setCode("");
    setStep("reset-code");
  }

  async function onResetCode(e: FormEvent) {
    e.preventDefault();
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
    if (!error) setStep("reset-password");
  }

  async function onNewPassword(e: FormEvent) {
    e.preventDefault();
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password: newPassword });
    if (!error) await continueAfterPassword();
  }

  async function onSocial(strategy: SocialStrategy) {
    setSocial(strategy);
    const { error } = await signIn.sso({
      strategy,
      redirectUrl: target,
      redirectCallbackUrl: `/sso-callback?redirect_url=${encodeURIComponent(target)}`,
    });
    if (error) setSocial(null);
  }

  async function startOver() {
    await signIn.reset();
    setCode("");
    setNewPassword("");
    setStep("credentials");
  }

  const back = (
    <div className="mt-8 text-center">
      <TextButton onClick={startOver}>Back to sign in</TextButton>
    </div>
  );

  if (step === "second-factor") {
    return (
      <AuthLayout
        title={secondFactor === "totp" ? "Enter your authenticator code" : "Check your email"}
        subtitle={
          secondFactor === "totp"
            ? "Open your authenticator app and enter the 6-digit code for Kept."
            : <>We sent a 6-digit code to <span className="font-medium text-ink">{email}</span> to confirm it's you.</>
        }
      >
        <form onSubmit={onSecondFactor} className="space-y-5">
          {globalError && <AuthError>{globalError}</AuthError>}
          <CodeField value={code} onChange={setCode} error={errorText(errors.fields.code)} />
          <SubmitButton pending={pending}>{pending ? "Verifying…" : "Continue"}</SubmitButton>
        </form>
        {secondFactor === "email_code" && (
          <ResendButton onResend={() => signIn.mfa.sendEmailCode()} disabled={pending} />
        )}
        {back}
      </AuthLayout>
    );
  }

  if (step === "reset-code") {
    return (
      <AuthLayout
        title="Reset your password"
        subtitle={<>We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>.</>}
      >
        <form onSubmit={onResetCode} className="space-y-5">
          {globalError && <AuthError>{globalError}</AuthError>}
          <CodeField value={code} onChange={setCode} error={errorText(errors.fields.code)} />
          <SubmitButton pending={pending}>{pending ? "Verifying…" : "Continue"}</SubmitButton>
        </form>
        <ResendButton onResend={() => signIn.resetPasswordEmailCode.sendCode()} disabled={pending} />
        {back}
      </AuthLayout>
    );
  }

  if (step === "reset-password") {
    return (
      <AuthLayout title="Choose a new password" subtitle="Use at least 15 characters.">
        <form onSubmit={onNewPassword} className="space-y-5">
          {globalError && <AuthError>{globalError}</AuthError>}
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            required
            autoFocus
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={errorText(errors.fields.password)}
          />
          <SubmitButton pending={pending}>{pending ? "Saving…" : "Save and sign in"}</SubmitButton>
        </form>
        {back}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in with your work email and password."
      footer={
        <>
          New to Kept?{" "}
          <Link to={signUpLink} className="font-semibold text-ink hover:text-brand">
            Create an account
          </Link>
        </>
      }
    >
      <SocialButtons onSelect={onSocial} pending={social} />
      <Divider>or with email</Divider>
      <form onSubmit={onCredentials} className="space-y-5">
        {globalError && <AuthError>{globalError}</AuthError>}
        {notice && <AuthError>{notice}</AuthError>}
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errorText(errors.fields.identifier)}
        />
        <div className="space-y-3">
          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errorText(errors.fields.password)}
          />
          <div className="flex justify-end">
            <TextButton onClick={onForgotPassword} disabled={pending}>Forgot password?</TextButton>
          </div>
        </div>
        <div className="pt-3">
          <SubmitButton pending={pending}>{pending ? "Signing in…" : "Sign in"}</SubmitButton>
        </div>
      </form>
    </AuthLayout>
  );
}

/** A one-time code input: digits only, filled by the OS from email or SMS where supported. */
export function CodeField({ value, onChange, error }: { value: string; onChange(v: string): void; error: string | null }) {
  return (
    <AuthField
      id="code"
      label="Code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      required
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      error={error}
      className="w-full rounded-lg border border-transparent bg-hover px-4 py-3 text-center font-mono text-lg tracking-[0.5em] text-ink hover:border-line-strong focus:border-brand focus:bg-canvas aria-invalid:border-danger"
    />
  );
}

/** "Resend code", with a short confirmation so a second click isn't the only feedback. */
export function ResendButton({ onResend, disabled }: { onResend(): Promise<{ error: unknown }>; disabled: boolean }) {
  const [sent, setSent] = useState(false);
  return (
    <p className="mt-5 text-center text-sm text-ink-muted">
      Didn't get it?{" "}
      <button
        type="button"
        disabled={disabled}
        className="font-medium text-brand hover:text-brand-hover disabled:opacity-60"
        onClick={async () => {
          const { error } = await onResend();
          setSent(!error);
        }}
      >
        Resend code
      </button>
      {sent && <span className="ml-2 text-ink-faint">Sent.</span>}
    </p>
  );
}
