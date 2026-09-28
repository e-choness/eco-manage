import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Gateway, initModels } from '@ecomanage/db';
import { GATEWAY_SERIAL, claimCodeFrom, formatClaimCode, gatewayQr } from '@ecomanage/shared';
import { claimKey } from '@ecomanage/shared/claim-proof';

// Factory step for a gateway (P5-04): `pnpm --filter @ecomanage/api gateway:register <serial> [--out factory.json]`.
// Makes a one-time claim code, keeps only its claim key, and prints the QR text for the label.
// `--out` writes the gateway's factory file (serial and code), which goes on its SD card.
dotenv.config();

const main = async () => {
  const [serialArg, ...rest] = process.argv.slice(2);
  const serial = (serialArg ?? '').toUpperCase();
  if (!GATEWAY_SERIAL.test(serial)) throw new Error('Usage: gateway:register <SERIAL> [--out factory.json] (A–Z, 0–9 and -, 4 to 40 characters)');
  const out = rest[0] === '--out' ? rest[1] : undefined;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  await mongoose.connect(url);
  await initModels();
  if (await Gateway.exists({ serial })) throw new Error(`Gateway ${serial} is already registered`);
  const code = claimCodeFrom(randomBytes(16));
  // The file first: a registration whose code was never written down couldn't be claimed.
  if (out) writeFileSync(out, `${JSON.stringify({ serial, claimCode: code }, null, 2)}\n`, { mode: 0o600 });
  try {
    await Gateway.create({ serial, claimKey: claimKey(code) });
  } catch (err) {
    if (out) rmSync(out, { force: true });
    throw err;
  }
  console.log(`Registered ${serial}\n  claim code: ${formatClaimCode(code)}\n  QR text:    ${gatewayQr(serial, code)}${out ? `\n  factory file: ${out}` : ''}`);
  await mongoose.disconnect();
};

main().catch(async (err: Error) => {
  console.error(err.message);
  await mongoose.disconnect();
  process.exit(1);
});
