import { describe, expect, it } from 'vitest';
import {
  LANGUAGES,
  clientMessageSchema,
  createRoomSchema,
  findLanguage,
  joinRoomSchema,
} from '../src/index.js';

describe('language configuration', () => {
  it('includes the required Hindi and Indonesian entries with consistent codes', () => {
    expect(findLanguage('hi-IN')).toMatchObject({
      translationCode: 'hi',
      ttsVoice: 'hi-IN-Neural2-A',
    });
    expect(findLanguage('id-ID')).toMatchObject({
      translationCode: 'id',
      ttsVoice: 'id-ID-Wavenet-A',
    });
    for (const l of LANGUAGES) {
      expect(l.code).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(l.ttsVoice.startsWith(l.code)).toBe(true);
      expect(l.code.startsWith(l.translationCode)).toBe(true);
    }
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });
});

describe('request schemas', () => {
  it('validate untrusted input', () => {
    const room = {
      callType: 'voice',
      hostLanguage: 'hi-IN',
      hostOutputLanguage: 'hi-IN',
      guestLanguage: 'id-ID',
      guestOutputLanguage: 'id-ID',
    };
    expect(createRoomSchema.parse(room).expiresInMinutes).toBe(60);
    expect(createRoomSchema.safeParse({ ...room, hostName: ' '.repeat(3) }).success).toBe(false);
    expect(
      joinRoomSchema.safeParse({
        inviteToken: 'short',
        displayName: 'A',
        spokenLanguage: 'id-ID',
        outputLanguage: 'id-ID',
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        type: 'signal',
        description: { type: 'offer', sdp: 'x'.repeat(200_000) },
      }).success,
    ).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});
