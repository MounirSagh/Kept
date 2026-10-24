import { useSignUp } from "@clerk/react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { AuthError, AuthField, AuthLayout, Divider, PasswordField, SubmitButton, TextButton } from "@/components/auth/AuthLayout";
import { SocialButtons, type SocialStrategy } from "@/components/auth/SocialButtons";
import { errorText, useAuthLink, useFinishNavigation, useRedirectTarget } from "@/lib/auth";
import { CodeField, ResendButton } from "./SignInPage";

/** Name, email and password; then the code Clerk emails to confirm the address. */
export function SignUpPage() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const target = useRedirectTarget();
  const signInLink = useAuthLink("/sign-in");
  const navigate = useFinishNavigation(target);

  const [verifying, setVerifying] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [social, setSocial] = useState<SocialStrategy | null>(null);

  const pending = fetchStatus === "fetching";
  const globalError = errorText(errors.global?.[0]);

  async function onDetails(e: FormEvent) {
    e.preventDefault();
    const { error } = await signUp.password({
      emailAddress: email.trim(),
      password,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
    });
    if (error) return;
    if (signUp.status === "complete") return void (await signUp.finalize({ navigate }));
    const sent = await signUp.verifications.sendEmailCode();
    if (!sent.error) setVerifying(true);
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (!error && signUp.status === "complete") await signUp.finalize({ navigate });
  }

  async function onSocial(strategy: SocialStrategy) {
    setSocial(strategy);
    const { error } = await signUp.sso({
      strategy,
      redirectUrl: target,
      redirectCallbackUrl: `/sso-callback?redirect_url=${encodeURIComponent(target)}`,
    });
    if (error) setSocial(null);
  }

  if (verifying) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={<>We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>.</>}
      >
        <form onSubmit={onCode} className="space-y-5">
          {globalError && <AuthError>{globalError}</AuthError>}
          <CodeField value={code} onChange={setCode} error={errorText(errors.fields.code)} />
          <SubmitButton pending={pending}>{pending ? "Verifying…" : "Verify email"}</SubmitButton>
        </form>
        <ResendButton onResend={() => signUp.verifications.sendEmailCode()} disabled={pending} />
        <div className="mt-8 text-center">
          <TextButton onClick={() => { setCode(""); setVerifying(false); }}>Use a different email</TextButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start tracking every promise your team makes."
      footer={
        <>
          Already have an account?{" "}
          <Link to={signInLink} className="font-semibold text-ink hover:text-brand">
            Sign in
          </Link>
        </>
      }
    >
      <SocialButtons onSelect={onSocial} pending={social} />
      <Divider>or with email</Divider>
      <form onSubmit={onDetails} className="space-y-5">
        {globalError && <AuthError>{globalError}</AuthError>}
        <div className="grid grid-cols-2 gap-3">
          <AuthField
            id="first-name"
            label="First name"
            autoComplete="given-name"
            placeholder="Ada"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={errorText(errors.fields.firstName)}
          />
          <AuthField
            id="last-name"
            label="Last name"
            autoComplete="family-name"
            placeholder="Lovelace"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            error={errorText(errors.fields.lastName)}
          />
        </div>
        <AuthField
          id="email"
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errorText(errors.fields.emailAddress)}
        />
        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          placeholder="At least 15 characters"
          required
          minLength={15}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errorText(errors.fields.password)}
        />
        {/* Clerk renders its bot check here when CAPTCHA is enabled on the instance. */}
        <div id="clerk-captcha" />
        <div className="pt-3">
          <SubmitButton pending={pending}>{pending ? "Creating account…" : "Create account"}</SubmitButton>
        </div>
      </form>
    </AuthLayout>
  );
}
