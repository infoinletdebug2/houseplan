import { EmailForm } from '../src/account/EmailForm';

/** Create account: your name, email, a 12+ character password, the Terms tick. A 6-digit code follows. */
export default function Register() {
  return <EmailForm initialMode="signup" />;
}
