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

export async function computeSha256(data) {
  const digestBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digestBuffer), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
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

  const compressed = await compressDeflateRaw(data);
  const isCompressed = compressed.length < data.length;
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
  crypto.getRandomValues(originalData);

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
