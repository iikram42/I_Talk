import { useState } from 'react';
import type { RoomView } from '@parley/shared';
import { Button } from '../components/ui/Button';
import { CopyIcon } from '../components/icons';
import { useToast } from '../components/ui/Toast';
import { inviteUrl } from '../lib/session';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Shown to the host until the guest joins. */
export function InvitePanel({
  room,
  inviteToken,
  onRevoke,
  onCancel,
}: {
  room: RoomView;
  inviteToken: string | undefined;
  onRevoke: () => Promise<void>;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);
  const url = inviteToken ? inviteUrl(room.id, inviteToken) : null;
  const expires = new Date(room.expiresAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-6 text-ink shadow-2xl">
      <h2 className="text-lg font-semibold">Waiting for the other person</h2>
      {room.inviteRevoked ? (
        <p className="mt-2 text-sm text-danger">
          You revoked the invitation. Nobody else can join this room.
        </p>
      ) : url ? (
        <>
          <p className="mt-1 text-sm text-muted">
            Send them this private link. It works once and expires at {expires}.
          </p>
          <div className="mt-4 flex gap-2">
            <input
              readOnly
              value={url}
              aria-label="Invitation link"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 text-sm text-muted"
              onFocus={(e) => e.target.select()}
            />
            <Button
              icon={<CopyIcon className="size-4" />}
              onClick={async () =>
                toast(
                  (await copyText(url))
                    ? 'Invitation link copied'
                    : 'Copy failed — select the link and copy it manually',
                )
              }
            >
              Copy
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          The invitation link is only shown in the tab where you created the room.
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {!room.inviteRevoked && url && (
          <Button
            variant="ghost"
            loading={revoking}
            onClick={async () => {
              setRevoking(true);
              try {
                await onRevoke();
                toast('Invitation revoked');
              } finally {
                setRevoking(false);
              }
            }}
          >
            Revoke link
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          Cancel call
        </Button>
      </div>
    </div>
  );
}
