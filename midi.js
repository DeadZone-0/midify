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

  // 160 BPM tempo 
  midi.set([0x00, 0xFF, 0x51, 0x03, 0x05, 0xB8, 0xD8], p);
  p += 7;

  // Acoustic Grand Piano 
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

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('midi.js')) {
  const sample = new Uint8Array([0x00, 0x42, 0xFF]);
  const out = encodeBytesToMidi(sample);
  console.log(`Encoded ${sample.length} bytes into ${out.length} MIDI bytes.`);
}
