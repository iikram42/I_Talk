# Privacy, data handling and retention

This describes what the application itself does. If you deploy it, your privacy notice must
also cover your hosting provider and your Google Cloud configuration.

## What is processed

| Data                                                                                     | Where it goes                                                                         | Stored?                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Camera video                                                                             | Directly between the two browsers over WebRTC (DTLS-SRTP), or through your TURN relay | Never                                                              |
| Microphone audio (the call itself)                                                       | Same as video                                                                         | Never                                                              |
| Microphone audio (for translation)                                                       | Browser → this server (WebSocket) → Google Speech-to-Text                             | Not by this app                                                    |
| Recognized text                                                                          | Server → Google Cloud Translation; shown to both participants                         | Not by this app                                                    |
| Translated text                                                                          | Server → Google Text-to-Speech; shown to both participants                            | Not by this app                                                    |
| Synthesized audio                                                                        | Server → the speaker's browser → the other participant over WebRTC                    | Never                                                              |
| Room metadata: id, call type, title, language choices, display names, timestamps, status | PostgreSQL                                                                            | Yes, deleted `ROOM_RETENTION_DAYS` (default 7) after the room ends |
| Invitation and session tokens                                                            | PostgreSQL                                                                            | Only SHA-256 hashes, deleted with the room                         |

Transcripts and translations exist only in server memory while being processed and in the
participants' browser tabs. Closing the tab discards them. There is no recording feature.

## What is and isn't encrypted

- WebRTC media is always encrypted in transit (DTLS-SRTP). A TURN relay forwards encrypted
  packets it cannot read.
- Audio sent for translation is encrypted in transit (WSS to this server, TLS to Google), but
  **it is not end-to-end encrypted**: this server and Google process it in the clear. Do not
  describe the product as end-to-end encrypted.
- Peer-to-peer connections can reveal each participant's IP address to the other. Forcing all
  traffic through TURN (`iceTransportPolicy: 'relay'`) would hide it at the cost of latency;
  this is not enabled by default.

## Google Cloud

Audio and text are sent to Google Cloud Speech-to-Text, Cloud Translation and Text-to-Speech
under your Google Cloud agreement. Check your project's data-logging settings and Google
Cloud's current data-processing terms before making any claim about provider-side storage.
This app never asks Google to store data.

## Logs

Server logs (JSON, stdout) contain request ids, routes, status codes, room ids, end reasons,
error messages and per-utterance latency numbers. They never contain audio, transcripts,
translations, tokens or `Authorization` headers. Invitation secrets never reach the server in
URLs because they live in the URL fragment.

## Deletion

- Ended rooms and their participant rows are deleted automatically after `ROOM_RETENTION_DAYS`.
  Set it to `0` to delete them at the next sweep (within a minute) after the call ends.
- Rooms that were never joined expire at their invitation expiry; calls end after
  `MAX_ROOM_DURATION_MINUTES` at the latest.
