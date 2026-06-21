import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

/**
 * A throwaway bcrypt hash computed once at startup. On the login path where the
 * email is unknown, we still run `verifyPassword(input, DUMMY_PASSWORD_HASH)` so the
 * response takes ~the same time as a real (found-user) comparison — closing the
 * timing side-channel that would otherwise reveal whether an email exists.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('emg-cms-timing-equalizer', ROUNDS);
