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
        const metaLen = readVlq();
        const start = pos;
        if ((type === 0x7F || type === 0x01) && metaLen >= 10) {
          if (
            bytes[start] === 0x57 &&
            bytes[start + 1] === 0x53 &&
            bytes[start + 2] === 0x54 &&
            bytes[start + 3] === 0x52
          ) {
            const payload = bytes.slice(start, start + metaLen);
            payload.isCarrier = true;
            return payload;
          }
        }
        pos = start + metaLen;
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

  const result = new Uint8Array(collected);
  result.isCarrier =
    result.length >= 10 &&
    result[0] === 0x57 &&
    result[1] === 0x53 &&
    result[2] === 0x54 &&
    result[3] === 0x52;
  return result;
}

export const GM_INSTRUMENTS = Object.freeze([
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavi',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
]);

export const NOTE_NAMES = Object.freeze([
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
]);

export function pitchToName(pitch) {
  const octave = Math.floor(pitch / 12) - 1;
  const name = NOTE_NAMES[pitch % 12];
  return `${name}${octave}`;
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectMidiKey(notes) {
  if (!notes || notes.length === 0) return 'Undetermined';
  const pitchCounts = new Array(12).fill(0);
  for (const n of notes) {
    const pitchClass = n.pitch % 12;
    pitchCounts[pitchClass] += (n.duration || 0.2) * (n.velocity || 64);
  }

  function correlation(profile, counts, shift) {
    let sumP = 0, sumC = 0, sumPC = 0, sumP2 = 0, sumC2 = 0;
    for (let i = 0; i < 12; i++) {
      const p = profile[i];
      const c = counts[(i + shift) % 12];
      sumP += p; sumC += c;
      sumPC += p * c;
      sumP2 += p * p; sumC2 += c * c;
    }
    const n = 12;
    const num = n * sumPC - sumP * sumC;
    const den = Math.sqrt((n * sumP2 - sumP * sumP) * (n * sumC2 - sumC * sumC));
    return den === 0 ? 0 : num / den;
  }

  let bestKey = 'C Major';
  let bestScore = -Infinity;

  for (let shift = 0; shift < 12; shift++) {
    const rMaj = correlation(MAJOR_PROFILE, pitchCounts, shift);
    if (rMaj > bestScore) {
      bestScore = rMaj;
      bestKey = `${NOTE_NAMES[shift]} Major`;
    }
    const rMin = correlation(MINOR_PROFILE, pitchCounts, shift);
    if (rMin > bestScore) {
      bestScore = rMin;
      bestKey = `${NOTE_NAMES[shift]} Minor`;
    }
  }

  return bestKey;
}

export function convertMidiToCsv(parsed) {
  const lines = ['Track,TimeSec,Pitch,NoteName,Velocity,DurationSec,Channel'];
  for (const n of parsed.notes) {
    const t = n.time.toFixed(3);
    const p = n.pitch;
    const name = pitchToName(p);
    const v = n.velocity;
    const d = (n.duration || 0.15).toFixed(3);
    const ch = n.channel !== undefined ? n.channel + 1 : 1;
    lines.push(`1,${t},${p},${name},${v},${d},${ch}`);
  }
  return lines.join('\n');
}

export function convertMidiToJson(parsed) {
  return JSON.stringify(
    {
      format: parsed.format,
      numTracks: parsed.numTracks,
      division: parsed.ppq,
      bpm: parsed.bpm,
      duration: Number(parsed.totalDuration.toFixed(2)),
      key: parsed.key,
      instruments: parsed.instruments,
      trackNames: parsed.trackNames,
      polyphonyPeak: parsed.polyphonyPeak,
      totalNotes: parsed.notes.length,
      pitchRange: `${parsed.pitchMinName} to ${parsed.pitchMaxName}`,
      notes: parsed.notes.map((n) => ({
        time: Number(n.time.toFixed(3)),
        pitch: n.pitch,
        name: pitchToName(n.pitch),
        velocity: n.velocity,
        duration: Number((n.duration || 0.15).toFixed(3)),
        channel: n.channel !== undefined ? n.channel + 1 : 1,
      })),
    },
    null,
    2
  );
}

export function parseMidiFile(midiFileBytes) {
  const bytes = midiFileBytes instanceof Uint8Array ? midiFileBytes : new Uint8Array(midiFileBytes);
  if (bytes.length < 14) throw new Error('File too short for MIDI header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, false) !== 0x4D546864) {
    throw new Error('Invalid MIDI file: missing MThd chunk');
  }

  const format = view.getUint16(8, false);
  const numTracks = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  const ppq = (division & 0x8000) === 0 ? division : 480;

  let pos = 8 + view.getUint32(4, false);
  const trackNames = [];
  const lyrics = [];
  const instrumentsUsed = new Set();
  const activeNotes = new Map();
  const notes = [];
  const channelPrograms = new Uint8Array(16); // ponytail: Tracks active GM program per MIDI channel (0-15)
  let embeddedPayload = null;

  let usPerQuarter = 375000;
  let secondsPerTick = usPerQuarter / (1000000 * ppq);

  for (let t = 0; t < numTracks && pos + 8 <= bytes.length; t++) {
    const chunkType = view.getUint32(pos, false);
    const chunkLen = view.getUint32(pos + 4, false);
    const chunkEnd = pos + 8 + chunkLen;
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

    let currentTime = 0;
    let runningStatus = 0;

    while (pos < chunkEnd) {
      const deltaTicks = readVlq();
      currentTime += deltaTicks * secondsPerTick;
      if (pos >= chunkEnd) break;

      let status = bytes[pos];
      if (status >= 0x80) {
        pos++;
        runningStatus = status < 0xF0 ? status : 0;
      } else {
        status = runningStatus;
      }

      if (status === 0xFF) {
        const type = bytes[pos++];
        const metaLen = readVlq();
        const start = pos;
        if (type === 0x03) {
          const str = new TextDecoder().decode(bytes.subarray(start, start + metaLen));
          if (str.trim()) trackNames.push(str.trim());
        } else if (type === 0x05) {
          const lyricStr = new TextDecoder().decode(bytes.subarray(start, start + metaLen));
          if (lyricStr.trim()) lyrics.push(lyricStr.trim());
        } else if (type === 0x51 && metaLen === 3) {
          usPerQuarter = (bytes[start] << 16) | (bytes[start + 1] << 8) | bytes[start + 2];
          secondsPerTick = usPerQuarter / (1000000 * ppq);
        } else if ((type === 0x7F || type === 0x01) && metaLen >= 10) {
          if (
            bytes[start] === 0x57 &&
            bytes[start + 1] === 0x53 &&
            bytes[start + 2] === 0x54 &&
            bytes[start + 3] === 0x52
          ) {
            embeddedPayload = bytes.slice(start, start + metaLen);
          }
        }
        pos = start + metaLen;
        if (type === 0x2F) break;
      } else if (status === 0xF0 || status === 0xF7) {
        pos += readVlq();
      } else {
        const high = status & 0xF0;
        const channel = status & 0x0F;
        if (high === 0x90 || high === 0x80) {
          const pitch = bytes[pos++];
          const velocity = bytes[pos++];
          const isNoteOn = high === 0x90 && velocity > 0;
          const key = (channel << 8) | pitch;

          if (isNoteOn) {
            const noteObj = {
              index: notes.length,
              pitch,
              velocity,
              channel,
              program: channel === 9 ? 128 : (channelPrograms[channel] || 0),
              time: currentTime,
              duration: 0.15,
            };
            notes.push(noteObj);
            activeNotes.set(key, noteObj);
          } else {
            const active = activeNotes.get(key);
            if (active) {
              active.duration = Math.max(0.04, currentTime - active.time);
              activeNotes.delete(key);
            }
          }
        } else if (high === 0xC0) {
          const prog = bytes[pos++];
          channelPrograms[channel] = prog;
          if (channel === 9) {
            instrumentsUsed.add('Standard Drum Kit');
          } else {
            instrumentsUsed.add(GM_INSTRUMENTS[prog] || `Instrument ${prog}`);
          }
        } else if (high === 0xA0 || high === 0xB0 || high === 0xE0) {
          pos += 2;
        } else if (high === 0xD0) {
          pos += 1;
        }
      }
    }
    pos = chunkEnd;
  }

  notes.sort((a, b) => a.time - b.time);
  notes.forEach((n, idx) => {
    n.index = idx;
  });

  let totalDuration = 0;
  let pitchMin = 127;
  let pitchMax = 0;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const endTime = n.time + (n.duration || 0.15);
    if (endTime > totalDuration) totalDuration = endTime;
    if (n.pitch < pitchMin) pitchMin = n.pitch;
    if (n.pitch > pitchMax) pitchMax = n.pitch;
  }
  if (notes.length === 0) {
    pitchMin = 0;
    pitchMax = 0;
  }

  const bpm = Math.round(60000000 / usPerQuarter);

  // Calculate polyphony peak
  let polyphonyPeak = 0;
  let activeCount = 0;
  const events = [];
  const polySampleLimit = Math.min(notes.length, 50000);
  for (let i = 0; i < polySampleLimit; i++) {
    const n = notes[i];
    events.push({ time: n.time, type: 1 });
    events.push({ time: n.time + n.duration, type: -1 });
  }
  events.sort((a, b) => a.time - b.time || a.type - b.type);
  for (let i = 0; i < events.length; i++) {
    activeCount += events[i].type;
    if (activeCount > polyphonyPeak) polyphonyPeak = activeCount;
  }

  const pitchMinName = notes.length > 0 ? pitchToName(pitchMin) : 'None';
  const pitchMaxName = notes.length > 0 ? pitchToName(pitchMax) : 'None';
  const detectedKey = detectMidiKey(notes);
  const instruments = instrumentsUsed.size > 0 ? Array.from(instrumentsUsed) : ['Acoustic Grand Piano'];

  return {
    format,
    numTracks,
    ppq,
    bpm,
    totalDuration,
    trackNames,
    lyrics,
    notes,
    hasPayload: !!embeddedPayload,
    payload: embeddedPayload,
    key: detectedKey,
    instruments,
    polyphonyPeak,
    pitchMin,
    pitchMax,
    pitchMinName,
    pitchMaxName,
  };
}

export function embedPayloadInMidi(originalMidiBytes, payloadBytes) {
  const m = originalMidiBytes instanceof Uint8Array ? originalMidiBytes : new Uint8Array(originalMidiBytes);
  const p = payloadBytes instanceof Uint8Array ? payloadBytes : new Uint8Array(payloadBytes);
  const view = new DataView(m.buffer, m.byteOffset, m.byteLength);

  if (view.getUint32(0, false) !== 0x4D546864) throw new Error('Input is not a valid MIDI file');
  const numTracks = view.getUint16(10, false);

  const vlqBytes = [];
  let len = p.length;
  vlqBytes.push(len & 0x7f);
  while ((len >>= 7)) {
    vlqBytes.push((len & 0x7f) | 0x80);
  }
  vlqBytes.reverse();

  const trackDataLen = 3 + vlqBytes.length + p.length + 4;
  const newTrack = new Uint8Array(8 + trackDataLen);
  const tView = new DataView(newTrack.buffer);
  tView.setUint32(0, 0x4D54726B, false);
  tView.setUint32(4, trackDataLen, false);

  let pos = 8;
  newTrack.set([0x00, 0xFF, 0x7F], pos);
  pos += 3;
  newTrack.set(vlqBytes, pos);
  pos += vlqBytes.length;
  newTrack.set(p, pos);
  pos += p.length;
  newTrack.set([0x00, 0xFF, 0x2F, 0x00], pos);

  const combined = new Uint8Array(m.length + newTrack.length);
  combined.set(m, 0);
  combined.set(newTrack, m.length);
  const cView = new DataView(combined.buffer);
  cView.setUint16(8, 1, false);
  cView.setUint16(10, numTracks + 1, false);

  return combined;
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
