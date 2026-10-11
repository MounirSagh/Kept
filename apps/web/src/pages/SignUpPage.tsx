import { SignUp } from "@clerk/react";

export function SignUpPage() {
  return (
    <div className="flex justify-center px-4 py-16">
      <SignUp routing="path" path="/sign-up" />
    </div>
  );
}
