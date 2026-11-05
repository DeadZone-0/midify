import { PITCH_TABLE, VELOCITY_TABLE } from './midi.js';

// Acoustic velocity intensity ramp: pianissimo (deep amber) through fortissimo (radiant ivory)
export const VELOCITY_COLORS = Object.freeze([
  '#b45309', '#d97706', '#f59e0b', '#fbbf24',
  '#fcd34d', '#fde68a', '#fef08a', '#ffffff',
]);

const PITCH_SCALE = ['C', 'D', 'E', 'G', 'A'];
export const PITCH_NAMES = Object.freeze(
  Array.from({ length: 32 }, (_, i) => `${PITCH_SCALE[i % 5]}${1 + Math.floor(i / 5)}`)
);

function drawPill(ctx, x, y, w, h, r = 3) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

// Cache a 1-second white noise buffer on the AudioContext for drum/percussion synthesis.
function getNoiseBuffer(ctx) {
  if (ctx._noiseBuffer) return ctx._noiseBuffer;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < ctx.sampleRate; i++) data[i] = Math.random() * 2 - 1;
  ctx._noiseBuffer = buffer;
  return buffer;
}

// Synthesize 128 GM instruments into 8 native oscillator/filter profiles with zero audio files.
export function playSynthVoice(ctx, dest, pitch, velocity, program = 0, channel = 0, duration = 0.2, now = ctx.currentTime) {
  const isDrum = channel === 9 || program === 128;
  const peak = Math.max(0.01, (velocity / 128) * 0.22);
  const dur = Math.max(0.04, Math.min(2.5, duration || 0.2));

  if (isDrum) {
    if (pitch <= 36) {
      // Kick drum: rapid pitch-drop sine wave
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(36, now + 0.08);
      gain.gain.setValueAtTime(peak * 1.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.13);
      return;
    }
    if (pitch === 38 || pitch === 40) {
      // Snare drum: body transient + noise burst
      const osc = ctx.createOscillator();
      const oGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.06);
      oGain.gain.setValueAtTime(peak * 0.7, now);
      oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(oGain);
      oGain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.09);

      const noise = ctx.createBufferSource();
      noise.buffer = getNoiseBuffer(ctx);
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.setValueAtTime(1200, now);
      nFilter.Q.setValueAtTime(1.2, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(peak * 0.9, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(dest);
      noise.start(now);
      noise.stop(now + 0.15);
      return;
    }
    // Hi-hat / Cymbals: high-pass filtered noise
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(pitch >= 49 ? 5000 : 7000, now);
    const gain = ctx.createGain();
    const hatDur = pitch === 46 || pitch >= 49 ? 0.22 : 0.05;
    gain.gain.setValueAtTime(peak * 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + hatDur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(now);
    noise.stop(now + hatDur + 0.01);
    return;
  }

  const freq = 440 * 2 ** ((pitch - 69) / 12);
  let type1 = 'triangle', type2 = 'sine';
  let filterFreq = Math.min(freq * 3.5, 3600);
  let filterQ = 1.0;
  let attack = 0.004, decay = dur, detune2 = 0;
  let sweepFilter = false;

  if (program >= 16 && program <= 23) {
    // Organs: additive dual sine (fundamental + octave)
    type1 = 'sine'; type2 = 'sine';
    detune2 = 1200;
    filterFreq = 4800;
    attack = 0.002;
  } else if (program >= 24 && program <= 39) {
    // Guitars / Basses: plucked resonant lowpass
    type1 = 'sawtooth'; type2 = 'triangle';
    filterFreq = Math.min(freq * 4.5, 4200);
    filterQ = 2.2;
    attack = 0.002; decay = Math.min(dur, 0.6);
    sweepFilter = true;
  } else if ((program >= 40 && program <= 55) || (program >= 88 && program <= 95)) {
    // Strings & Pads: chorus detuned dual sawtooth with soft attack
    type1 = 'sawtooth'; type2 = 'sawtooth';
    detune2 = 7;
    filterFreq = Math.min(freq * 2.2, 2600);
    attack = 0.04;
  } else if (program >= 56 && program <= 63) {
    // Brass: sawtooth + square with horn bite
    type1 = 'sawtooth'; type2 = 'square';
    filterFreq = Math.min(freq * 3.8, 3800);
    filterQ = 2.0;
    attack = 0.015;
    sweepFilter = true;
  } else if (program >= 64 && program <= 79) {
    // Reeds & Pipes: hollow square + sine
    type1 = 'square'; type2 = 'sine';
    filterFreq = Math.min(freq * 2.8, 3000);
    attack = 0.012;
  } else if ((program >= 80 && program <= 87) || (program >= 96 && program <= 103)) {
    // Synth Leads & FX: resonant sawtooth + square
    type1 = 'sawtooth'; type2 = 'square';
    filterFreq = Math.min(freq * 4.0, 5000);
    filterQ = 3.0;
    attack = 0.003;
  }

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = type1;
  osc2.type = type2;
  osc1.frequency.setValueAtTime(freq, now);
  osc2.frequency.setValueAtTime(freq, now);
  if (detune2 !== 0) osc2.detune.setValueAtTime(detune2, now);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.setValueAtTime(filterQ, now);
  filter.frequency.setValueAtTime(filterFreq, now);
  if (sweepFilter) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 1.4), now + Math.min(decay, 0.25));
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + decay + 0.01);
  osc2.stop(now + decay + 0.01);
}

export class MidiVisualizerPlayer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext ? canvas.getContext('2d') : null;
    this.speed = 1.0;
    this.isPlaying = false;
    this.currentTime = 0;
    this.playedIndex = 0;
    this.currentNote = null;
    this.noteInterval = options.noteInterval || 0.055;
    this.notes = [];
    this.totalDuration = 0;
    this.activeKeys = new Array(32).fill(null);
    this.lastFrameTime = null;
    this.animId = null;

    this.audioCtx = null;
    this.masterGain = null;

    this._loop = this._loop.bind(this);
    if (typeof requestAnimationFrame !== 'undefined') {
      this.animId = requestAnimationFrame(this._loop);
    }
  }

  _ensureAudio() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.setValueAtTime(0.7, this.audioCtx.currentTime);
        this.masterGain.connect(this.audioCtx.destination);
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  load(packetBytes) {
    const bytes = packetBytes instanceof Uint8Array ? packetBytes : new Uint8Array(packetBytes);
    this.notes = new Array(bytes.length);

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      const pitchIndex = (b >> 3) & 0x1f;
      const velocityIndex = b & 0x07;
      this.notes[i] = {
        index: i,
        byte: b,
        pitchIndex,
        velocityIndex,
        pitch: PITCH_TABLE[pitchIndex],
        velocity: VELOCITY_TABLE[velocityIndex],
        time: i * this.noteInterval,
      };
    }

    this.totalDuration = this.notes.length * this.noteInterval;
    this.stop();
  }

  loadMidiSong(parsedMidi) {
    if (!parsedMidi || !parsedMidi.notes) return;
    this.notes = parsedMidi.notes.map((n, i) => {
      const pitchIndex = Math.min(31, Math.max(0, Math.floor(((n.pitch - 21) / 88) * 32)));
      const velocityIndex = Math.min(7, Math.max(0, Math.floor((n.velocity / 128) * 8)));
      return {
        index: i,
        byte: n.pitch,
        pitchIndex,
        velocityIndex,
        pitch: n.pitch,
        velocity: n.velocity,
        channel: n.channel !== undefined ? n.channel : 0,
        program: n.program !== undefined ? n.program : (n.channel === 9 ? 128 : 0),
        time: n.time,
        duration: n.duration || 0.15,
      };
    });
    this.totalDuration =
      parsedMidi.totalDuration ||
      (this.notes.length > 0 ? this.notes[this.notes.length - 1].time + 0.5 : 0);
    this.stop();
  }

  play() {
    if (this.notes.length === 0) return;
    this._ensureAudio();
    this.isPlaying = true;
    this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  pause() {
    this.isPlaying = false;
  }

  stop() {
    this.isPlaying = false;
    this.currentTime = 0;
    this.playedIndex = 0;
    this.currentNote = null;
    this.activeKeys.fill(null);
  }

  seek(ratio) {
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    this.currentTime = clamped * this.totalDuration;
    let idx = 0;
    while (idx < this.notes.length && this.notes[idx].time < this.currentTime) {
      idx++;
    }
    this.playedIndex = idx;
    this.currentNote = this.notes[this.playedIndex] || null;
    this.activeKeys.fill(null);
  }

  setSpeed(multiplier) {
    if (typeof multiplier === 'string') {
      multiplier = parseFloat(multiplier.replace(/[^0-9.]/g, ''));
    }
    this.speed = Math.max(0.1, Math.min(50, Number(multiplier) || 1.0));
  }

  destroy() {
    this.stop();
    if (this.animId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animId);
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }

  _playTone(pitch, velocity, program = 0, channel = 0, duration = 0.2) {
    if (!this.audioCtx) return;
    const dur = Math.max(0.04, (duration || 0.35) / Math.sqrt(this.speed));
    playSynthVoice(this.audioCtx, this.masterGain, pitch, velocity, program, channel, dur, this.audioCtx.currentTime);
  }

  _loop(now) {
    const dt = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = now;

    if (this.isPlaying && this.notes.length > 0) {
      this.currentTime += dt * this.speed;

      while (
        this.playedIndex < this.notes.length &&
        this.notes[this.playedIndex].time <= this.currentTime
      ) {
        const note = this.notes[this.playedIndex];
        this._playTone(note.pitch, note.velocity, note.program, note.channel, note.duration);
        this.activeKeys[note.pitchIndex] = {
          velocityIndex: note.velocityIndex,
          time: now,
        };
        this.currentNote = note;
        this.playedIndex++;
      }

      if (this.currentTime >= this.totalDuration + 0.5) {
        this.stop();
      }
    }

    if (this.ctx) {
      this._render(now);
    }

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animId = requestAnimationFrame(this._loop);
    }
  }

  _render(now) {
    const { canvas, ctx } = this;
    const { width, height } = canvas;
    const keyHeight = Math.min(80, Math.max(40, height * 0.15));
    const keyY = height - keyHeight;
    const keyWidth = width / 32;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 32; i++) {
      const x = Math.round(i * keyWidth);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, keyY);
      ctx.stroke();
    }

    const scrollSpeed = 280;
    const minTime = this.currentTime - 0.1;
    const maxTime = this.currentTime + keyY / scrollSpeed;

    let low = 0;
    let high = this.notes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.notes[mid].time < minTime) low = mid + 1;
      else high = mid;
    }
    const startIndex = low;

    low = startIndex;
    high = this.notes.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.notes[mid].time <= maxTime) low = mid + 1;
      else high = mid;
    }
    const endIndex = low;

    for (let i = startIndex; i < endIndex; i++) {
      const note = this.notes[i];
      const y = keyY - (note.time - this.currentTime) * scrollSpeed - 12;
      if (y + 12 < 0 || y > keyY + 10) continue;

      const x = note.pitchIndex * keyWidth + 2;
      const w = Math.max(2, keyWidth - 4);
      ctx.fillStyle = VELOCITY_COLORS[note.velocityIndex];
      drawPill(ctx, x, y, w, 12, 6);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x + 1, y, w - 2, 2);
    }

    if (keyWidth >= 16) {
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
    }

    for (let i = 0; i < 32; i++) {
      const x = i * keyWidth;
      const active = this.activeKeys[i];
      const activeAlpha = active ? Math.max(0, 1 - (now - active.time) / 180) : 0;
      const color = active ? VELOCITY_COLORS[active.velocityIndex] : '#ffffff';

      ctx.fillStyle = '#14151a';
      ctx.fillRect(x + 1, keyY, keyWidth - 2, keyHeight);

      if (activeAlpha > 0) {
        ctx.fillStyle = color;
        ctx.globalAlpha = activeAlpha * 0.85;
        ctx.fillRect(x + 1, keyY, keyWidth - 2, keyHeight);

        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = activeAlpha;
        ctx.fillRect(x, keyY - 2, keyWidth, 3);
        ctx.globalAlpha = 1.0;
      }

      ctx.strokeStyle = activeAlpha > 0 ? color : '#242732';
      ctx.strokeRect(x + 0.5, keyY + 0.5, keyWidth - 1, keyHeight - 1);

      if (keyWidth >= 16) {
        ctx.fillStyle = activeAlpha > 0 ? '#ffffff' : '#737887';
        ctx.fillText(PITCH_NAMES[i], x + keyWidth / 2, keyY + keyHeight - 8);
      }
    }
  }

  _drawHUD(_ctx) {
    // Canvas HUD removed in favor of integrated hardware transport monitor in DOM.
  }
}

export function audioBufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = audioBuffer.length;
  const dataByteLength = length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataByteLength, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  view.setUint32(12, 0x666D7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataByteLength, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

export async function renderNotesToWav(notes, totalDuration, options = {}) {
  const sampleRate = options.sampleRate || 44100;
  const duration = Math.min(600, Math.max(0.5, totalDuration || 1));
  const length = Math.ceil(duration * sampleRate);

  const OfflineCtx = typeof window !== 'undefined'
    ? (window.OfflineAudioContext || window.webkitOfflineAudioContext)
    : null;
  if (!OfflineCtx) throw new Error('OfflineAudioContext is not supported in this browser');

  const actx = new OfflineCtx(2, length, sampleRate);
  const master = actx.createGain();
  master.gain.setValueAtTime(0.7, 0);
  master.connect(actx.destination);

  const maxRenderNotes = options.maxNotes || 30000;
  const notesToRender = notes.length > maxRenderNotes ? notes.slice(0, maxRenderNotes) : notes;

  for (const n of notesToRender) {
    if (n.time >= duration) continue;
    playSynthVoice(actx, master, n.pitch, n.velocity, n.program, n.channel, n.duration, n.time);
  }

  const renderedBuffer = await actx.startRendering();
  return audioBufferToWav(renderedBuffer);
}
