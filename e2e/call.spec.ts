import { type Browser, type Page, expect, test } from '@playwright/test';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../playwright.config';

async function createRoom(page: Page, type: 'voice' | 'video'): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: type === 'voice' ? 'Start a Voice Call' : 'Start a Video Call' }).click();
  await expect(page.getByRole('heading', { name: 'Create a room' })).toBeVisible();
  await expect(page.getByLabel('I speak')).toHaveValue(/Hindi/);
  await expect(page.getByLabel('They speak')).toHaveValue(/Indonesian/);
  await page.getByLabel('Your name (optional)').fill('Asha');
  await page.getByRole('button', { name: 'Create room' }).click();
  const link = page.getByLabel('Invitation link');
  await expect(link).toHaveValue(/\/join\/[\w-]{22}#[\w-]{43}$/);
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Invitation link copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await link.inputValue());
  return copied;
}

async function joinAsGuest(browser: Browser, url: string, name = 'Budi'): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /Asha invited you to a (voice|video) call/ })).toBeVisible();
  // The secret is removed from the address bar once read.
  expect(page.url()).not.toContain('#');
  await page.getByLabel('Your name').fill(name);
  await expect(page.getByLabel('I speak')).toHaveValue(/Indonesian/);
  await page.getByRole('button', { name: 'Join call' }).click();
  return page;
}

const connected = /Good connection|Fair connection|Poor connection|Connected/;

/** Peak level of a remote audio element's stream over a short window. */
async function peakLevel(page: Page, label: string): Promise<number> {
  return page.evaluate(async (label) => {
    const el = document.querySelector<HTMLAudioElement>(`audio[aria-label="${label}"]`);
    const stream = el?.srcObject as MediaStream | null;
    if (!stream || stream.getAudioTracks().length === 0) return -1;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    const until = performance.now() + 4000;
    while (performance.now() < until) {
      analyser.getFloatTimeDomainData(data);
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      await new Promise((r) => setTimeout(r, 50));
    }
    await ctx.close();
    return peak;
  }, label);
}

for (const type of ['voice', 'video'] as const) {
  test(`${type} call: create, invite, join, translate, mute, end`, async ({ page: host, browser }) => {
    const url = await createRoom(host, type);
    await expect(host.getByText('Waiting for guest')).toBeVisible();
    const guest = await joinAsGuest(browser, url);

    // Both sides reach a connected WebRTC session.
    await expect(host.getByText(connected).first()).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText(connected).first()).toBeVisible({ timeout: 30_000 });
    await expect(host.getByText('Budi speaks Indonesian')).toBeVisible();
    await expect(guest.getByText('Asha speaks Hindi')).toBeVisible();

    // Original audio flows peer to peer.
    expect(await peakLevel(guest, "Other person's voice")).toBeGreaterThan(0.01);
    if (type === 'video') {
      await expect
        .poll(() => guest.evaluate(() => Math.max(...[...document.querySelectorAll('video')].map((v) => v.videoWidth))))
        .toBeGreaterThan(0);
    }

    // Both directions are recognized, translated and shown to both people.
    await expect(guest.getByText('[id] test utterance', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(host.getByText('[hi] test utterance', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(host.getByText(/in hi-IN$/).first()).toBeVisible();

    // Synthesized speech arrives on the dedicated translation track, not the voice track.
    expect(await peakLevel(guest, 'Translated voice')).toBeGreaterThan(0.05);
    expect(await peakLevel(host, 'Translated voice')).toBeGreaterThan(0.05);

    // Mute is reflected on the other side, and unmute clears it.
    await host.getByRole('button', { name: 'Mute microphone' }).click();
    await expect(guest.getByLabel('Muted')).toBeVisible();
    await host.getByRole('button', { name: 'Unmute microphone' }).click();
    await expect(guest.getByLabel('Muted')).toHaveCount(0);
    await guest.getByRole('button', { name: 'Mute microphone' }).click();
    await expect(host.getByLabel('Muted')).toBeVisible();
    await guest.getByRole('button', { name: 'Unmute microphone' }).click();

    if (type === 'video') {
      await guest.getByRole('button', { name: 'Turn camera off' }).click();
      await expect(guest.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
    }

    // A third person cannot use the same invitation.
    const intruder = await (await browser.newContext()).newPage();
    await intruder.goto(url);
    await expect(intruder.getByRole('heading', { name: 'This call is full' })).toBeVisible();

    // Ending the call ends it for both.
    await guest.getByRole('button', { name: 'End call' }).click();
    await expect(guest.getByRole('heading', { name: 'Call ended' })).toBeVisible();
    await expect(host.getByRole('heading', { name: 'Call ended' })).toBeVisible();
  });
}

test('invalid, revoked and expired invitations fail safely', async ({ page, browser }) => {
  await page.goto('/join/AAAAAAAAAAAAAAAAAAAAAA#BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  await expect(page.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible();

  await page.goto('/join/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible();

  const host = await (await browser.newContext()).newPage();
  const url = await createRoom(host, 'voice');
  await host.getByRole('button', { name: 'Revoke link' }).click();
  await expect(host.getByText('You revoked the invitation')).toBeVisible();
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  await expect(guest.getByRole('heading', { name: 'This invitation was revoked' })).toBeVisible();

  const host2 = await (await browser.newContext()).newPage();
  const url2 = await createRoom(host2, 'voice');
  const roomId = new URL(url2).pathname.split('/').pop()!;
  const db = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  await db.query(`UPDATE rooms SET expires_at = now() - interval '1 minute' WHERE id = $1`, [roomId]);
  await db.end();
  const guest2 = await (await browser.newContext()).newPage();
  await guest2.goto(url2);
  await expect(guest2.getByRole('heading', { name: 'This invitation has expired' })).toBeVisible();

  // Someone with only the room URL (no token) is not let in.
  const outsider = await (await browser.newContext()).newPage();
  await outsider.goto(`/room/${roomId}`);
  await expect(outsider.getByRole('heading', { name: 'You’re not part of this call' })).toBeVisible();
});

test('host can cancel a room before anyone joins', async ({ page }) => {
  await createRoom(page, 'voice');
  await page.getByRole('button', { name: 'Cancel call' }).click();
  await expect(page.getByRole('heading', { name: 'Call ended' })).toBeVisible();
  await expect(page.getByText('The host cancelled this call')).toBeVisible();
});
