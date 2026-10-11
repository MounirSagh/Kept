import { SignIn } from "@clerk/react";

export function SignInPage() {
  return (
    <div className="flex justify-center px-4 py-16">
      <SignIn routing="path" path="/sign-in" />
    </div>
  );
}
