import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initModels } from '@ecomanage/db';
import { createJobClient, type JobClient } from '../lib/jobs';
import { planIssues, provisionPlan, type ProvisionPlan } from '../modules/provisioning/plan';
import { ProvisionError, applyPlan } from '../modules/provisioning/service';

// Sets up sites and who has access to them, from a plan (docs/deploy/operations.md):
//
//   pnpm --filter @ecomanage/api provision --site "Maple Grove School" --tz America/Toronto \
//     --owner owner@example.com [--external-id crm-4711]
//   pnpm --filter @ecomanage/api provision --file plan.json      (or --file - to read stdin)
//
// Options: --dry-run (show the changes, make none), --prune (remove provisioned access the plan no
// longer lists), --print-links (show invite links instead of emailing them).
dotenv.config({ quiet: true });

const USAGE = `Usage:
  provision --site <name> --owner <email> [--tz <Area/City>] [--external-id <id>] [options]
  provision --file <plan.json | -> [options]
Options: --dry-run  --prune  --print-links`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const readPlan = (): unknown => {
  const file = value('file');
  if (file) return JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  const name = value('site');
  const owner = value('owner');
  if (!name || !owner) throw new ProvisionError(USAGE);
  const tz = value('tz');
  const externalId = value('external-id');
  return { sites: [{ name, ...(tz ? { tz } : {}), ...(externalId ? { externalId } : {}), members: [{ email: owner, role: 'owner' }] }] };
};

const main = async () => {
  const parsed = provisionPlan.safeParse(readPlan());
  if (!parsed.success) throw new ProvisionError(`The plan isn't valid:\n  ${planIssues(parsed.error).join('\n  ')}`);
  const plan: ProvisionPlan = parsed.data;

  const url = process.env.DATABASE_URL;
  if (!url) throw new ProvisionError('DATABASE_URL not set');
  const dryRun = flag('dry-run');
  const printLinks = flag('print-links');
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
  let jobs: JobClient | undefined;
  if (!dryRun && !printLinks) {
    if (!process.env.REDIS_URL) throw new ProvisionError('REDIS_URL is needed to email invites; set it, or use --print-links');
    jobs = createJobClient(process.env.REDIS_URL);
  }

  await mongoose.connect(url);
  await initModels();
  try {
    const changes = await applyPlan(plan, {
      dryRun,
      prune: flag('prune'),
      deliverInvite: async (inviteId, token) => {
        if (!jobs) return `${appUrl}/invite/${token}`;
        await jobs.sendInvite({ inviteId, token });
        return undefined;
      },
    });
    if (!changes.length) console.log('Nothing to change.');
    let site = '';
    for (const c of changes) {
      if (c.site !== site) console.log((site = c.site));
      console.log(`  ${c.detail}${c.link ? `\n    ${c.link}` : ''}`);
    }
    if (dryRun && changes.length) console.log('(dry run: nothing was changed)');
    else if (changes.some((c) => c.action === 'invite.create'))
      console.log(printLinks ? 'Give each person their link; it works once, for 7 days.' : 'Invites are on their way by email; each link works once, for 7 days.');
  } finally {
    await jobs?.close();
    await mongoose.disconnect();
  }
};

main().catch(async (err: Error) => {
  console.error(err instanceof ProvisionError || err instanceof SyntaxError ? err.message : err);
  await mongoose.disconnect();
  process.exit(1);
});
