import { packFile, unpackBlob } from './codec.js?v=2';
import {
  encodeBytesToMidi,
  decodeMidiToBytes,
  parseMidiFile,
  convertMidiToJson,
  convertMidiToCsv,
  pitchToName,
} from './midi.js?v=2';
import { MidiVisualizerPlayer, renderNotesToWav } from './player.js?v=2';

const state = {
  originalFile: null,
  originalBytes: null,
  packedBytes: null,
  midiBytes: null,
  originalHash: null,
  recoveredData: null,
  recoveredFilename: null,
  recoveredHash: null,
  parsedMidiSong: null,
  activeMidiFilename: 'song.mid',
  player: null,
};

const $ = (id) => document.getElementById(id);

const PLAY_ICON_SRC = 'icons/play_arrow.svg';
const PAUSE_ICON_SRC = 'icons/pause.svg';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${bytes.toLocaleString()} B (${kb.toFixed(2)} KB)`;
  return `${bytes.toLocaleString()} B (${(kb / 1024).toFixed(2)} MB)`;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function downloadBlob(data, filename, mimeType = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createHexDump(bytes, maxBytes = 256) {
  const limit = Math.min(bytes.length, maxBytes);
  const lines = [];

  for (let i = 0; i < limit; i += 16) {
    const chunk = bytes.subarray(i, Math.min(i + 16, limit));
    const offset = i.toString(16).padStart(4, '0').toUpperCase();
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const ascii = Array.from(chunk, (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset}  ${hex.padEnd(48, ' ')}  |${ascii}|`);
  }

  if (bytes.length > limit) {
    lines.push(`... (+${(bytes.length - limit).toLocaleString()} more bytes)`);
  }
  return lines.join('\n');
}

async function processEncodeFile(file) {
  try {
    state.originalFile = file;
    const arrayBuffer = await file.arrayBuffer();
    state.originalBytes = new Uint8Array(arrayBuffer);

    $('enc-filename').textContent = file.name;
    $('enc-filesize').textContent = formatBytes(state.originalBytes.length);
    $('encode-file-pill').classList.remove('hidden');

    state.packedBytes = await packFile(file.name, state.originalBytes);
    state.originalHash = state.packedBytes.hash;
    state.midiBytes = encodeBytesToMidi(state.packedBytes);

    const origLen = state.originalBytes.length;
    const packedLen = state.packedBytes.length;
    const isCompressed = state.packedBytes[4] === 1;
    const compressionRatio = ((packedLen / origLen) * 100).toFixed(1);
    const songDurationSeconds = state.packedBytes.length * 0.055;

    $('enc-orig-size').textContent = formatBytes(origLen);
    $('enc-comp-size').textContent = isCompressed
      ? `${formatBytes(packedLen)} (${compressionRatio}% • Deflate)`
      : `${formatBytes(packedLen)} (Uncompressed)`;
    $('enc-note-count').textContent = `${state.packedBytes.length.toLocaleString()} notes`;
    $('enc-duration').textContent = `${formatTime(songDurationSeconds)} @ 1x`;
    $('enc-hash-display').textContent = state.originalHash;

    $('btn-copy-enc-hash').disabled = false;
    $('btn-download-mid').disabled = false;
    $('btn-play-encoded').disabled = false;
    $('btn-send-to-decoder').disabled = false;

    state.player.load(state.packedBytes);
    updatePlayerUI();
  } catch (err) {
    console.error('File encoding error:', err);
    alert('Encoding error: ' + err.message);
  }
}

async function processDecodeMidi(midiFileBytes, filename = 'carrier.mid') {
  state.activeMidiFilename = filename;
  $('dec-pill-name').textContent = filename;
  $('dec-pill-size').textContent = formatBytes(midiFileBytes.length);
  $('decode-file-pill').classList.remove('hidden');

  try {
    const parsed = parseMidiFile(midiFileBytes);
    state.parsedMidiSong = parsed;

    const extractedBytes = decodeMidiToBytes(midiFileBytes);
    if (extractedBytes.isCarrier) {
      $('badge-musical-midi')?.classList.add('hidden');
      $('btn-play-song')?.classList.add('hidden');

      const unpacked = await unpackBlob(extractedBytes);

      state.recoveredData = unpacked.data;
      state.recoveredFilename = unpacked.filename;
      state.recoveredHash = unpacked.hash;

      if ($('dec-filename')) $('dec-filename').textContent = unpacked.filename;
      if ($('dec-size')) $('dec-size').textContent = formatBytes(unpacked.data.length);
      if ($('dec-key')) $('dec-key').textContent = `${parsed.key} (Carrier)`;
      if ($('dec-instruments')) $('dec-instruments').textContent = 'Carrier Synth (Ch 1)';
      if ($('dec-polyphony')) $('dec-polyphony').textContent = '1 Voice Monophonic';
      if ($('dec-hash-display')) $('dec-hash-display').textContent = unpacked.hash;

      if ($('btn-copy-dec-hash')) $('btn-copy-dec-hash').disabled = false;
      if ($('btn-download-recovered')) $('btn-download-recovered').disabled = false;

      if (state.originalHash && state.originalHash.toLowerCase() === unpacked.hash.toLowerCase()) {
        $('badge-match')?.classList.remove('hidden');
      } else {
        $('badge-match')?.classList.add('hidden');
      }

      renderPayloadPreview(unpacked.filename, unpacked.data);
    } else {
      $('badge-match')?.classList.add('hidden');
      $('badge-musical-midi')?.classList.remove('hidden');

      const trackTitle = parsed.trackNames[0] || filename;
      const instrumentsDisplay = parsed.instruments.length > 0
        ? parsed.instruments.slice(0, 3).join(', ') + (parsed.instruments.length > 3 ? ` (+${parsed.instruments.length - 3})` : '')
        : 'Acoustic Grand Piano';

      if ($('dec-filename')) $('dec-filename').textContent = `${trackTitle} (${parsed.notes.length.toLocaleString()} notes)`;
      if ($('dec-size')) $('dec-size').textContent = `${formatTime(parsed.totalDuration)} @ ${parsed.bpm} BPM (SMF ${parsed.format})`;
      if ($('dec-key')) $('dec-key').textContent = parsed.key;
      if ($('dec-instruments')) $('dec-instruments').textContent = instrumentsDisplay;
      if ($('dec-polyphony')) $('dec-polyphony').textContent = `${parsed.polyphonyPeak} voice(s) peak`;
      if ($('dec-hash-display')) $('dec-hash-display').textContent = `${parsed.numTracks} track(s) • ${parsed.ppq} PPQ • ${parsed.notes.length} total events`;

      if ($('btn-copy-dec-hash')) $('btn-copy-dec-hash').disabled = true;
      if ($('btn-download-recovered')) $('btn-download-recovered').disabled = true;
      $('btn-play-song')?.classList.remove('hidden');

      renderMusicalMidiPreview(filename, parsed);
    }

    // Enable format conversion for any valid MIDI loaded
    if (parsed.notes.length > 0) {
      if ($('btn-export-wav')) $('btn-export-wav').disabled = false;
      if ($('btn-export-json')) $('btn-export-json').disabled = false;
      if ($('btn-export-csv')) $('btn-export-csv').disabled = false;
      if ($('conversion-status')) {
        $('conversion-status').textContent = `${parsed.notes.length.toLocaleString()} NOTES READY`;
        $('conversion-status').classList.add('active');
      }
    } else {
      if ($('btn-export-wav')) $('btn-export-wav').disabled = true;
      if ($('btn-export-json')) $('btn-export-json').disabled = true;
      if ($('btn-export-csv')) $('btn-export-csv').disabled = true;
      if ($('conversion-status')) {
        $('conversion-status').textContent = 'NO NOTES DETECTED';
        $('conversion-status').classList.remove('active');
      }
    }
  } catch (err) {
    console.error('Decoding failed:', err);
    alert(`Failed to decode MIDI carrier: ${err.message}`);
  }
}

function renderMusicalMidiPreview(filename, parsed) {
  $('preview-empty').classList.add('hidden');
  $('preview-image').classList.add('hidden');
  $('preview-hex').classList.add('hidden');

  const pitchMin = parsed.pitchMin ?? 0;
  const pitchMax = parsed.pitchMax ?? 0;
  const tracksList = parsed.trackNames.length > 0 ? parsed.trackNames.join(', ') : 'Track 1';
  const instrumentsList = parsed.instruments.length > 0 ? parsed.instruments.join(', ') : 'Acoustic Grand Piano';

  const previewNotes = parsed.notes.slice(0, 8).map((n, i) => {
    return `  [${i + 1}] t=${n.time.toFixed(2)}s | ${pitchToName(n.pitch).padEnd(4, ' ')} (MIDI ${n.pitch.toString().padStart(3, ' ')}) | vel=${n.velocity.toString().padStart(3, ' ')} | dur=${(n.duration || 0.15).toFixed(2)}s`;
  }).join('\n');

  const lyricsSection = parsed.lyrics && parsed.lyrics.length > 0
    ? `\nLyrics Stream:\n"${parsed.lyrics.slice(0, 10).join(' ')}..."\n`
    : '';

  const summary = [
    `File: ${filename}`,
    `Standard: SMF Format ${parsed.format}`,
    `Detected Key: ${parsed.key}`,
    `Peak Polyphony: ${parsed.polyphonyPeak} simultaneous voices`,
    `Tracks (${parsed.numTracks}): ${tracksList}`,
    `General MIDI Instruments: ${instrumentsList}`,
    `Timing: ${parsed.bpm} BPM | ${parsed.ppq} PPQ`,
    `Duration: ${formatTime(parsed.totalDuration)} (${parsed.totalDuration.toFixed(2)}s)`,
    `Total Note Events: ${parsed.notes.length.toLocaleString()}`,
    `Pitch Span: ${pitchToName(pitchMin)} (${pitchMin}) to ${pitchToName(pitchMax)} (${pitchMax})`,
    lyricsSection,
    `Chronological Event Ledger (first 8 notes):`,
    previewNotes,
    '',
    `Available exports: 16-bit .WAV audio, .JSON, and .CSV.`
  ].filter(line => line !== undefined).join('\n');

  $('preview-text').textContent = summary;
  $('preview-text').classList.remove('hidden');
  $('preview-type').textContent = 'STANDARD MIDI SONG';
}

function renderPayloadPreview(filename, data) {
  $('preview-empty').classList.add('hidden');
  $('preview-image').classList.add('hidden');
  $('preview-text').classList.add('hidden');
  $('preview-hex').classList.add('hidden');

  const ext = filename.split('.').pop().toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const textExts = ['txt', 'json', 'md', 'js', 'html', 'css', 'ts', 'xml', 'csv', 'yaml', 'yml'];

  if (imageExts.includes(ext)) {
    const blob = new Blob([data], { type: `image/${ext === 'svg' ? 'svg+xml' : ext}` });
    const url = URL.createObjectURL(blob);
    $('preview-image').src = url;
    $('preview-image').onload = () => URL.revokeObjectURL(url);
    $('preview-image').classList.remove('hidden');
    $('preview-type').textContent = `IMAGE (${ext.toUpperCase()})`;
  } else if (textExts.includes(ext)) {
    $('preview-text').textContent = new TextDecoder('utf-8').decode(data);
    $('preview-text').classList.remove('hidden');
    $('preview-type').textContent = `TEXT (${ext.toUpperCase()})`;
  } else {
    $('preview-hex').textContent = createHexDump(data);
    $('preview-hex').classList.remove('hidden');
    $('preview-type').textContent = 'HEX DUMP';
  }
}

function updatePlayerUI() {
  const p = state.player;
  if (!p) return;

  const currentSec = p.currentTime;
  const totalSec = p.totalDuration;
  const progressRatio = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0;

  $('time-current').textContent = formatTime(currentSec);
  $('time-total').textContent = formatTime(totalSec);
  $('progress-bar-fill').style.width = `${progressRatio * 100}%`;

  const playPauseIcon = $('play-pause-icon');
  if (p.isPlaying) {
    $('playback-dot').classList.add('playing');
    $('playback-status').textContent = 'PLAYING';
    if (playPauseIcon && !playPauseIcon.src.endsWith(PAUSE_ICON_SRC)) {
      playPauseIcon.src = PAUSE_ICON_SRC;
    }
    $('play-pause-text').textContent = 'Pause';
  } else if (p.notes.length > 0) {
    $('playback-dot').classList.remove('playing');
    $('playback-status').textContent = p.currentTime > 0 ? 'PAUSED' : 'READY';
    if (playPauseIcon && !playPauseIcon.src.endsWith(PLAY_ICON_SRC)) {
      playPauseIcon.src = PLAY_ICON_SRC;
    }
    $('play-pause-text').textContent = 'Play';
  } else {
    $('playback-dot').classList.remove('playing');
    $('playback-status').textContent = 'IDLE';
    if (playPauseIcon && !playPauseIcon.src.endsWith(PLAY_ICON_SRC)) {
      playPauseIcon.src = PLAY_ICON_SRC;
    }
    $('play-pause-text').textContent = 'Play';
  }

  $('btn-play-pause').disabled = p.notes.length === 0;
  $('btn-stop').disabled = p.notes.length === 0 || p.currentTime === 0;
}

function setupDropzone(dropzoneEl, fileInputEl, onFileSelected) {
  dropzoneEl.addEventListener('click', (e) => {
    if (!e.target.closest('button')) {
      fileInputEl.click();
    }
  });

  dropzoneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputEl.click();
    }
  });

  fileInputEl.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      fileInputEl.value = '';
    }
  });

  dropzoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzoneEl.classList.add('dragover');
  });

  dropzoneEl.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove('dragover');
  });

  dropzoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove('dragover');
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  });
}

function init() {
  state.player = new MidiVisualizerPlayer($('midi-canvas'));

  function uiLoop() {
    updatePlayerUI();
    requestAnimationFrame(uiLoop);
  }
  requestAnimationFrame(uiLoop);

  // Deck A: File Drop and Encoders
  setupDropzone($('encode-dropzone'), $('encode-file-input'), processEncodeFile);

  $('btn-copy-enc-hash').addEventListener('click', () => {
    if (state.originalHash) {
      navigator.clipboard.writeText(state.originalHash);
      const label = $('btn-copy-enc-hash').querySelector('.btn-copy-label');
      if (label) {
        label.textContent = 'Copied';
        setTimeout(() => (label.textContent = 'Copy'), 1500);
      }
    }
  });

  $('btn-download-mid').addEventListener('click', () => {
    if (state.midiBytes) {
      const base = state.originalFile?.name ? state.originalFile.name.replace(/\.[^/.]+$/, '') : 'carrier';
      downloadBlob(state.midiBytes, `${base}.mid`, 'audio/midi');
    }
  });

  $('btn-play-encoded').addEventListener('click', () => {
    if (state.packedBytes) {
      state.player.load(state.packedBytes);
      state.player.play();
    }
  });

  $('btn-send-to-decoder').addEventListener('click', () => {
    if (state.midiBytes) {
      const base = state.originalFile?.name ? state.originalFile.name.replace(/\.[^/.]+$/, '') : 'carrier';
      processDecodeMidi(state.midiBytes, `${base}.mid`);
    }
  });

  // Transport Controls
  $('btn-play-pause').addEventListener('click', () => {
    if (state.player.isPlaying) {
      state.player.pause();
    } else {
      state.player.play();
    }
    updatePlayerUI();
  });

  $('btn-stop').addEventListener('click', () => {
    state.player.stop();
    updatePlayerUI();
  });

  document.querySelectorAll('.btn-speed').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-speed').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.player.setSpeed(btn.getAttribute('data-speed'));
    });
  });

  $('progress-bar-container').addEventListener('click', (e) => {
    const rect = $('progress-bar-container').getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.player.seek(ratio);
    updatePlayerUI();
  });

  // Deck B: File Drop and Decoders
  $('btn-play-song')?.addEventListener('click', () => {
    if (state.parsedMidiSong) {
      state.player.loadMidiSong(state.parsedMidiSong);
      state.player.play();
      updatePlayerUI();
    }
  });

  setupDropzone($('decode-dropzone'), $('decode-file-input'), async (file) => {
    try {
      const buf = await file.arrayBuffer();
      await processDecodeMidi(new Uint8Array(buf), file.name);
    } catch (err) {
      console.error('Failed to decode dropped file:', err);
      alert('Failed to read file: ' + err.message);
    }
  });

  $('btn-copy-dec-hash').addEventListener('click', () => {
    if (state.recoveredHash) {
      navigator.clipboard.writeText(state.recoveredHash);
      const label = $('btn-copy-dec-hash').querySelector('.btn-copy-label');
      if (label) {
        label.textContent = 'Copied';
        setTimeout(() => (label.textContent = 'Copy'), 1500);
      }
    }
  });

  $('btn-download-recovered').addEventListener('click', () => {
    if (state.recoveredData && state.recoveredFilename) {
      downloadBlob(state.recoveredData, state.recoveredFilename);
    }
  });

  // Format Conversion Actions
  $('btn-export-wav')?.addEventListener('click', async () => {
    if (!state.parsedMidiSong || state.parsedMidiSong.notes.length === 0) return;
    const btn = $('btn-export-wav');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<img src="icons/audio_file.svg" class="icon icon-sm" alt=""><span>Rendering WAV...</span>`;
    try {
      const wavBytes = await renderNotesToWav(
        state.parsedMidiSong.notes,
        state.parsedMidiSong.totalDuration
      );
      const base = (state.activeMidiFilename || 'converted_audio').replace(/\.[^/.]+$/, '');
      downloadBlob(wavBytes, `${base}.wav`, 'audio/wav');
    } catch (err) {
      console.error('WAV render failed:', err);
      alert('WAV conversion failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  $('btn-export-json')?.addEventListener('click', () => {
    if (!state.parsedMidiSong) return;
    try {
      const jsonStr = convertMidiToJson(state.parsedMidiSong);
      const base = (state.activeMidiFilename || 'midi_events').replace(/\.[^/.]+$/, '');
      downloadBlob(jsonStr, `${base}.json`, 'application/json');
    } catch (err) {
      console.error('JSON export failed:', err);
      alert('JSON conversion failed: ' + err.message);
    }
  });

  $('btn-export-csv')?.addEventListener('click', () => {
    if (!state.parsedMidiSong) return;
    try {
      const csvStr = convertMidiToCsv(state.parsedMidiSong);
      const base = (state.activeMidiFilename || 'note_ledger').replace(/\.[^/.]+$/, '');
      downloadBlob(csvStr, `${base}.csv`, 'text/csv');
    } catch (err) {
      console.error('CSV export failed:', err);
      alert('CSV conversion failed: ' + err.message);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
