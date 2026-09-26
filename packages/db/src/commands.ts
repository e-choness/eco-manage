import { Command, type CommandDoc } from './models';

// Reverts (plan P3-04): undoing a command is a command of its own (revertOf), sent and tracked
// like any other by the rules service. Used at revertAt, on cancel, and after a failed verify.

const REVERT_EXPIRES_MS = 5 * 60_000;

/** Creates the revert for a command once; returns null if it already has one. */
export const createRevertCommand = async (c: CommandDoc, now: Date): Promise<CommandDoc | null> => {
  if (await Command.exists({ revertOf: c._id })) return null;
  const params = (c.revertParams as Record<string, unknown> | null) ?? null;
  const [child] = await Command.create([
    {
      siteId: c.siteId,
      deviceId: c.deviceId,
      action: params ? c.action : 'revert', // e.g. set_reserve back to the reserve it had before
      params: params ?? {},
      revertOf: c._id,
      expiresAt: new Date(now.getTime() + REVERT_EXPIRES_MS),
      revertAt: null,
      status: 'created',
    },
  ]);
  return child.toObject() as CommandDoc;
};
