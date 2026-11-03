/**
 * Header (10 bytes, Big-Endian):
 *   [0..3] ASCII "WSTR" (0x57535452)
 *   [4]    Flags (0 = uncompressed, 1 = deflate-raw)
 *   [5]    Filename length (0..255)
 *   [6..9] Payload length (Uint32)
 */

export function stripFolderSlashes(name) {
  const s = String(name ?? 'payload.bin').replace(/[/\\]+$/, '');
  return s.replace(/^.*[/\\]/, '') || 'payload.bin';
}

function sha256Sync(bytes) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const l = bytes.length;
  const bitLen = l * 8;
  const newLen = ((l + 9 + 63) >> 6) << 6;
  const b = new Uint8Array(newLen);
  b.set(bytes);
  b[l] = 0x80;
  const view = new DataView(b.buffer);
  view.setUint32(newLen - 4, bitLen, false);

  const w = new Int32Array(64);
  for (let i = 0; i < newLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = H[0], b0 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b0) ^ (a & c) ^ (b0 & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b0;
      b0 = a;
      a = (temp1 + temp2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b0) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export async function computeSha256(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return sha256Sync(bytes);
}

export async function compressDeflateRaw(data) {
  const stream = new Response(data).body.pipeThrough(new CompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function decompressDeflateRaw(data) {
  const stream = new Response(data).body.pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function packFile(name, uint8Array) {
  const data = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);
  const hash = await computeSha256(data);

  const cleanName = stripFolderSlashes(name);
  const filenameBytes = new TextEncoder().encode(cleanName);
  if (filenameBytes.length > 255) {
    throw new RangeError(`Filename exceeds 255 bytes: ${filenameBytes.length}`);
  }

  let compressed = null;
  try {
    compressed = await compressDeflateRaw(data);
  } catch (err) {
    // If browser lacks deflate-raw or compression fails, fall back cleanly to uncompressed
    compressed = null;
  }

  const isCompressed = compressed && compressed.length < data.length;
  const payload = isCompressed ? compressed : data;
  const flags = isCompressed ? 1 : 0;

  if (payload.length > 0xffffffff) {
    throw new RangeError(`Payload size exceeds 4GB limit for Uint32 header: ${payload.length}`);
  }

  const packed = new Uint8Array(10 + filenameBytes.length + payload.length);
  const view = new DataView(packed.buffer, packed.byteOffset, 10);

  view.setUint32(0, 0x57535452, false);
  view.setUint8(4, flags);
  view.setUint8(5, filenameBytes.length);
  view.setUint32(6, payload.length, false);

  packed.set(filenameBytes, 10);
  packed.set(payload, 10 + filenameBytes.length);

  packed.hash = hash;
  return packed;
}

export async function unpackBlob(uint8Array) {
  const bytes = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);

  if (bytes.length < 10) {
    throw new Error(`Buffer too small for header: ${bytes.length} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x57535452) {
    throw new Error('Invalid magic header: expected "WSTR"');
  }

  const flags = view.getUint8(4);
  const filenameLen = view.getUint8(5);
  const payloadLen = view.getUint32(6, false);
  const payloadStart = 10 + filenameLen;
  const payloadEnd = payloadStart + payloadLen;

  if (bytes.length < payloadEnd) {
    throw new Error(
      `Truncated payload: expected ${payloadEnd} bytes, received ${bytes.length}`
    );
  }

  const filenameBytes = bytes.subarray(10, payloadStart);
  const rawFilename = new TextDecoder().decode(filenameBytes);
  const filename = stripFolderSlashes(rawFilename);

  const rawPayload = bytes.slice(payloadStart, payloadEnd);
  const data = flags === 1 ? await decompressDeflateRaw(rawPayload) : rawPayload;
  const hash = await computeSha256(data);

  return { filename, data, hash };
}

export async function testCodec() {
  const originalData = new Uint8Array(1024);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(originalData);
  } else {
    for (let i = 0; i < 1024; i++) originalData[i] = (i * 37) & 0xff;
  }

  const filename = 'sample/path/test-payload.bin';
  const packed = await packFile(filename, originalData);

  const padded = new Uint8Array(packed.length + 256);
  padded.set(packed, 0);

  const unpacked = await unpackBlob(padded);

  console.log(`Original hash:  ${packed.hash}`);
  console.log(`Recovered hash: ${unpacked.hash}`);
  console.log(`Hashes match:   ${packed.hash === unpacked.hash}`);

  if (packed.hash !== unpacked.hash) {
    throw new Error('Hash mismatch between packed and unpacked data');
  }

  return { packed, unpacked };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('codec.js')) {
  testCodec().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
