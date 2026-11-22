import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { connectDB, disconnectDB } from '../db/connect';
import { User } from '../models';
import { passwordProblem } from '../utils/password';

// Emergency recovery for the Super Admin (there is no "forgot password" email yet).
//   SUPER_ADMIN_NEW_PASSWORD="a long new password" npm run admin:reset
// Sets the password for SUPER_ADMIN_EMAIL (from backend/.env), turns two-step verification off so the next
// sign-in re-enrols it, signs out every session, and unlocks the account.
async function main() {
  const email = env.superAdminEmail.toLowerCase();
  const password = process.env.SUPER_ADMIN_NEW_PASSWORD ?? '';
  if (!email) throw new Error('SUPER_ADMIN_EMAIL is not set in backend/.env');
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(`SUPER_ADMIN_NEW_PASSWORD: ${problem}`);

  await connectDB();
  const user = await User.findOne({ email, isSuperAdmin: true });
  if (!user) throw new Error(`No Super Admin with the email ${email}`);
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(), status: 'active', mfaEnabled: false, mfaLastStep: 0, mfaFailures: 0, recoveryCodes: [], refreshTokens: [] },
      $unset: { mfaSecret: 1, mfaLockedUntil: 1 },
    },
  );
  console.log(`Password reset for ${email}. Two-step verification is off: sign in and set it up again.`);
}

main()
  .catch((err: Error) => {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
