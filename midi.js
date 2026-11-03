/**
 * midi.js - Binary-to-MIDI steganography codec (SMF Format 0, 480 PPQ)
 */

export const PITCH_TABLE = Object.freeze([
  24, 26, 28, 31, 33, 36, 38, 40, 43, 45, 48, 50, 52, 55, 57, 60,
  62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98,
]);

export const VELOCITY_TABLE = Object.freeze([
  48, 58, 68, 78, 88, 98, 108, 118,
]);

export function encodeBytesToMidi(packetBytes) {
  const bytes = packetBytes instanceof Uint8Array ? packetBytes : new Uint8Array(packetBytes);
  const numBytes = bytes.length;
  const pedalToggles = numBytes > 64 ? Math.floor((numBytes - 1) / 64) : 0;
  const trackDataLen = 14 + (pedalToggles * 8) + (numBytes * 8) + 4;
  const totalLen = 22 + trackDataLen;
  const midi = new Uint8Array(totalLen);
  const view = new DataView(midi.buffer);

  // MThd: Format 0, 1 track, 480 PPQ
  view.setUint32(0, 0x4D546864, false);
  view.setUint32(4, 6, false);
  view.setUint16(8, 0, false);
  view.setUint16(10, 1, false);
  view.setUint16(12, 480, false);

  // MTrk
  view.setUint32(14, 0x4D54726B, false);
  view.setUint32(18, trackDataLen, false);

  let p = 22;

  // 160 BPM tempo (375,000 µs/qn)
  midi.set([0x00, 0xFF, 0x51, 0x03, 0x05, 0xB8, 0xD8], p);
  p += 7;

  // Acoustic Grand Piano (0x00) & Sustain ON (CC 64 = 127)
  midi.set([0x00, 0xC0, 0x00, 0x00, 0xB0, 0x40, 0x7F], p);
  p += 7;

  for (let i = 0; i < numBytes; i++) {
    if (i > 0 && i % 64 === 0) {
      midi.set([0x00, 0xB0, 0x40, 0x00, 0x00, 0xB0, 0x40, 0x7F], p);
      p += 8;
    }

    const b = bytes[i];
    const pitch = PITCH_TABLE[(b >> 3) & 0x1F];
    const velocity = VELOCITY_TABLE[b & 0x07];

    midi.set([0x00, 0x90, pitch, velocity, 0x1E, 0x80, pitch, 0x00], p);
    p += 8;
  }

  // End of Track
  midi.set([0x00, 0xFF, 0x2F, 0x00], p);

  return midi;
}

export function decodeMidiToBytes(midiFileBytes) {
  const bytes = midiFileBytes instanceof Uint8Array ? midiFileBytes : new Uint8Array(midiFileBytes);
  if (bytes.length < 22) throw new Error('File too small to be a MIDI file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, false) !== 0x4D546864) {
    throw new Error('Invalid MIDI file: missing MThd chunk');
  }

  let pos = 8 + view.getUint32(4, false);
  const collected = [];

  while (pos + 8 <= bytes.length) {
    const chunkType = view.getUint32(pos, false);
    const chunkEnd = pos + 8 + view.getUint32(pos + 4, false);
    pos += 8;

    if (chunkType !== 0x4D54726B) {
      pos = chunkEnd;
      continue;
    }

    const readVlq = () => {
      let val = 0;
      while (pos < chunkEnd) {
        const b = bytes[pos++];
        val = (val << 7) | (b & 0x7f);
        if ((b & 0x80) === 0) break;
      }
      return val;
    };

    let runningStatus = 0;

    while (pos < chunkEnd) {
      readVlq();
      if (pos >= chunkEnd) break;

      let status = bytes[pos];
      if (status >= 0x80) {
        pos++;
        runningStatus = status < 0xF0 ? status : 0;
      } else {
        if (!runningStatus) throw new Error(`Missing running status at offset ${pos}`);
        status = runningStatus;
      }

      if (status === 0xFF) {
        const type = bytes[pos++];
        pos += readVlq();
        if (type === 0x2F) break;
      } else if (status === 0xF0 || status === 0xF7) {
        pos += readVlq();
      } else {
        const high = status & 0xF0;
        if (high === 0x90) {
          const pitch = bytes[pos++];
          const velocity = bytes[pos++];
          if (velocity > 0) {
            const pitchIndex = PITCH_TABLE.indexOf(pitch);
            const velIndex = VELOCITY_TABLE.indexOf(velocity);
            if (pitchIndex !== -1 && velIndex !== -1) {
              collected.push((pitchIndex << 3) | velIndex);
            }
          }
        } else if (high === 0x80 || high === 0xA0 || high === 0xB0 || high === 0xE0) {
          pos += 2;
        } else if (high === 0xC0 || high === 0xD0) {
          pos += 1;
        }
      }
    }
  }

  return new Uint8Array(collected);
}

export function testMidiRoundTrip(byteCount = 1024) {
  const original = new Uint8Array(byteCount);
  crypto.getRandomValues(original);

  const midi = encodeBytesToMidi(original);
  const recovered = decodeMidiToBytes(midi);

  const match = original.length === recovered.length && original.every((b, i) => b === recovered[i]);

  console.log(`Original bytes:  ${original.length}`);
  console.log(`MIDI file bytes: ${midi.length}`);
  console.log(`Recovered bytes: ${recovered.length}`);
  console.log(`Roundtrip match: ${match}`);

  if (!match) {
    throw new Error('MIDI roundtrip verification failed');
  }

  return { original, midi, recovered, success: true };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('midi.js')) {
  testMidiRoundTrip();
}
