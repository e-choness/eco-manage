import bcrypt from 'bcrypt';

/**
 * Hashes the password using bcrypt algorithm
 * @param password - The password to hash
 * @returns Password hash
 */
export const generatePasswordHash = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt();
  const hash = await bcrypt.hash(password, salt);
  return hash;
};

/**
 * Validates the password against the hash
 * @param password - The password to verify
 * @param hash - Password hash to verify against
 * @returns True if the password matches the hash, false otherwise
 */
export const validatePassword = async (password: string, hash: string): Promise<boolean> => {
  const result = await bcrypt.compare(password, hash);
  return result;
};

/**
 * Checks that the hash has a valid format
 * @param hash - Hash to check format for
 * @returns True if passed string seems like valid hash, false otherwise
 */
export const isPasswordHash = (hash: string): boolean => {
  if (!hash || hash.length !== 60) return false;
  try {
    bcrypt.getRounds(hash);
    return true;
  } catch {
    return false;
  }
};
