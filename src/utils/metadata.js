const MAX_TAG_BYTES = 24 * 1024 * 1024;
let parseLyrics = (source) => source ? [{ time: null, text: source }] : [];

export function setLyricsParser(parser) {
  if (typeof parser === 'function') parseLyrics = parser;
}

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  try { return decodeURIComponent(binary.split('').map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')); }
  catch { return binary; }
}

function decodeLatin1(bytes) {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) output += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return output;
}

function decodeBase64(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, '');
  const output = [];
  let bits = 0;
  let buffer = 0;
  for (const char of clean) {
    if (char === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

export function bytesFromDataUrl(value) {
  const separator = value.indexOf(',');
  return decodeBase64(separator >= 0 ? value.slice(separator + 1) : value);
}

function decodeUtf16(bytes, littleEndian) {
  let offset = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { littleEndian = true; offset = 2; }
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { littleEndian = false; offset = 2; }
  if (typeof TextDecoder !== 'undefined') return new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(offset));
  let output = '';
  for (; offset + 1 < bytes.length; offset += 2) {
    const code = littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
    output += String.fromCharCode(code);
  }
  return output;
}

const UTF8 = { decode: decodeUtf8 };
const LATIN1 = { decode: decodeLatin1 };

  function readSynchsafe(bytes, offset) {
    return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
  }

  function decodeText(bytes, encoding = 3) {
    try {
      const text = encoding === 0 ? LATIN1.decode(bytes) : encoding === 1 ? decodeUtf16(bytes, true) : encoding === 2 ? decodeUtf16(bytes, false) : UTF8.decode(bytes);
      return text.replace(/\0+$/g, '').trim();
    }
    catch { return UTF8.decode(bytes).replace(/\0+$/g, '').trim(); }
  }

  function findStringEnd(bytes, start, encoding) {
    const step = encoding === 1 || encoding === 2 ? 2 : 1;
    for (let index = start; index + step <= bytes.length; index += step) {
      if (bytes[index] === 0 && (step === 1 || bytes[index + 1] === 0)) return index;
    }
    return bytes.length;
  }

  function readEncodedString(bytes, start, encoding) {
    const end = findStringEnd(bytes, start, encoding);
    return { text: decodeText(bytes.subarray(start, end), encoding), next: Math.min(bytes.length, end + (encoding === 1 || encoding === 2 ? 2 : 1)) };
  }

  function removeUnsynchronisation(bytes) {
    const output = [];
    for (let index = 0; index < bytes.length; index += 1) {
      output.push(bytes[index]);
      if (bytes[index] === 0xff && bytes[index + 1] === 0) index += 1;
    }
    return new Uint8Array(output);
  }

  function parseID3Picture(frame, version) {
    if (frame.length < 5) return null;
    const encoding = frame[0];
    const oldFormat = version === 2;
    const mimeEnd = oldFormat ? 4 : frame.indexOf(0, 1);
    if (mimeEnd < 0 || mimeEnd + 2 >= frame.length) return null;
    const format = oldFormat ? LATIN1.decode(frame.subarray(1, 4)).toLowerCase() : '';
    const mime = oldFormat ? (format === 'png' ? 'image/png' : 'image/jpeg') : LATIN1.decode(frame.subarray(1, mimeEnd)).toLowerCase();
    if (mime === '-->') return null;
    const pictureTypeOffset = oldFormat ? 4 : mimeEnd + 1;
    const pictureType = frame[pictureTypeOffset];
    const description = readEncodedString(frame, pictureTypeOffset + 1, encoding);
    const data = frame.subarray(description.next);
    if (!data.length) return null;
    return { data, mime: mime.startsWith('image/') ? mime : 'image/jpeg', pictureType };
  }

  function parseID3Lyrics(frame) {
    if (frame.length < 5) return '';
    const description = readEncodedString(frame, 4, frame[0]);
    return decodeText(frame.subarray(description.next), frame[0]);
  }

  function parseID3SynchronizedLyrics(frame) {
    if (frame.length < 10) return [];
    const encoding = frame[0];
    const timestampFormat = frame[4];
    const contentType = frame[5];
    if (contentType !== 1) return [];
    let position = readEncodedString(frame, 6, encoding).next;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const lyrics = [];
    while (position < frame.length) {
      const item = readEncodedString(frame, position, encoding);
      if (item.next + 4 > frame.length) break;
      const stamp = view.getUint32(item.next, false);
      lyrics.push({ text: item.text, time: timestampFormat === 2 ? stamp / 1000 : null });
      position = item.next + 4;
    }
    return lyrics.filter((line) => line.text);
  }

  function parseID3(bytes) {
    if (bytes.length < 10 || LATIN1.decode(bytes.subarray(0, 3)) !== 'ID3') return {};
    const version = bytes[3];
    if (version < 2 || version > 4) return {};
    const totalSize = 10 + readSynchsafe(bytes, 6);
    if (totalSize > bytes.length || totalSize > MAX_TAG_BYTES) return {};
    let body = bytes.subarray(10, totalSize);
    const headerFlags = bytes[5];
    if (headerFlags & 0x80) body = removeUnsynchronisation(body);
    let position = 0;
    if (version === 2 && (headerFlags & 0x40)) return {};
    if (version >= 3 && (headerFlags & 0x40)) {
      if (body.length < 4) return {};
      const extendedSize = version === 4 ? readSynchsafe(body, 0) : new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, false);
      position = version === 4 ? extendedSize : extendedSize + 4;
    }
    const result = { lyrics: [], pictures: [], synchronizedLyrics: [] };
    const idLength = version === 2 ? 3 : 4;
    const frameHeaderLength = version === 2 ? 6 : 10;
    while (position + frameHeaderLength <= body.length) {
      const id = LATIN1.decode(body.subarray(position, position + idLength));
      if (!new RegExp(`^[A-Z0-9]{${idLength}}$`).test(id)) break;
      const size = version === 2
        ? (body[position + 3] << 16) | (body[position + 4] << 8) | body[position + 5]
        : version === 4 ? readSynchsafe(body, position + 4) : new DataView(body.buffer, body.byteOffset + position + 4, 4).getUint32(0, false);
      if (!size) break;
      const end = position + frameHeaderLength + size;
      if (end > body.length) break;
      const formatFlags = version === 2 ? 0 : body[position + 9];
      let frame = body.subarray(position + frameHeaderLength, end);
      position = end;
      if ((version === 3 && (formatFlags & 0xc0)) || (version === 4 && (formatFlags & 0x0c))) continue;
      if (version === 4 && (formatFlags & 0x02)) frame = removeUnsynchronisation(frame);
      if (version === 4 && (formatFlags & 0x01)) frame = frame.subarray(4);
      if (version === 3 && (formatFlags & 0x20)) frame = frame.subarray(1);
      if (id[0] === 'T' && !['TXXX', 'TXX'].includes(id) && frame.length > 1) {
        const value = decodeText(frame.subarray(1), frame[0]).split('\0')[0];
        if (id === 'TIT2' || id === 'TT2') result.title = value;
        if (id === 'TPE1' || id === 'TP1') result.artist = value;
        if (id === 'TALB' || id === 'TAL') result.album = value;
      } else if (id === 'TXXX' || id === 'TXX') {
        const description = readEncodedString(frame, 1, frame[0]).text.toUpperCase();
        if (/^(LYRICS?|UNSYNCEDLYRICS|LYRICS_UNSYNCED|LYRICS_LRC|SYNCEDLYRICS|LYRICS_SYNCED)$/.test(description)) {
          const valueStart = readEncodedString(frame, 1, frame[0]).next;
          result.lyricText ||= decodeText(frame.subarray(valueStart), frame[0]);
        }
      } else if (id === 'APIC' || id === 'PIC') {
        const picture = parseID3Picture(frame, version);
        if (picture) result.pictures.push(picture);
      } else if ((id === 'USLT' || id === 'ULT') && !result.lyricText) {
        result.lyricText = parseID3Lyrics(frame);
      } else if (id === 'SYLT' && !result.synchronizedLyrics.length) {
        result.synchronizedLyrics = parseID3SynchronizedLyrics(frame);
      }
    }
    const cover = result.pictures.find((picture) => picture.pictureType === 3) || result.pictures[0];
    result.coverData = cover?.data || null;
    result.coverMime = cover?.mime || '';
    result.lyrics = result.synchronizedLyrics.some((line) => line.time !== null)
      ? result.synchronizedLyrics
      : result.lyricText ? parseLyrics(result.lyricText) : [];
    delete result.pictures;
    delete result.synchronizedLyrics;
    delete result.lyricText;
    return result;
  }

  function readU32(bytes, offset, littleEndian = false) {
    if (offset + 4 > bytes.length) return 0;
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian);
  }

  function parseFlacPicture(bytes) {
    try {
      let position = 0;
      const pictureType = readU32(bytes, position); position += 4;
      const mimeLength = readU32(bytes, position); position += 4;
      const mime = UTF8.decode(bytes.subarray(position, position + mimeLength)); position += mimeLength;
      const descriptionLength = readU32(bytes, position); position += 4 + descriptionLength;
      position += 16;
      const imageLength = readU32(bytes, position); position += 4;
      if (imageLength <= 0 || position + imageLength > bytes.length) return null;
      return { data: bytes.subarray(position, position + imageLength), mime: mime || 'image/jpeg', pictureType };
    } catch { return null; }
  }

  function parseVorbisComments(bytes, position = 0) {
    const comments = {};
    try {
      let cursor = position;
      const vendorLength = readU32(bytes, cursor, true); cursor += 4 + vendorLength;
      const count = Math.min(readU32(bytes, cursor, true), 10000); cursor += 4;
      for (let index = 0; index < count && cursor + 4 <= bytes.length; index += 1) {
        const length = readU32(bytes, cursor, true); cursor += 4;
        if (length > bytes.length - cursor) break;
        const item = UTF8.decode(bytes.subarray(cursor, cursor + length)); cursor += length;
        const split = item.indexOf('=');
        if (split > 0) comments[item.slice(0, split).toUpperCase()] = item.slice(split + 1);
      }
    } catch { /* Ignore malformed optional tags. */ }
    return comments;
  }

  function metadataFromComments(comments) {
    const result = {
      title: comments.TITLE || comments.TIT2 || '',
      artist: comments.ARTIST || comments.PERFORMER || comments.TPE1 || '',
      album: comments.ALBUM || comments.TALB || '',
      lyrics: [], coverData: null, coverMime: '',
    };
    const lyricText = comments.LYRICS_LRC || comments.SYNCEDLYRICS || comments.LYRICS || comments.UNSYNCEDLYRICS || comments.LYRIC || '';
    if (lyricText) result.lyrics = parseLyrics(lyricText);
    const pictureTag = comments.METADATA_BLOCK_PICTURE;
    if (pictureTag) {
      try {
        const picture = parseFlacPicture(decodeBase64(pictureTag));
        if (picture) { result.coverData = picture.data; result.coverMime = picture.mime; }
      } catch { result.coverData = null; }
    }
    if (!result.coverData && comments.COVERART) {
      try {
        result.coverMime = comments.COVERARTMIME || 'image/jpeg';
        result.coverData = decodeBase64(comments.COVERART);
      } catch { result.coverData = null; }
    }
    return result;
  }

  function parseFlac(bytes) {
    if (LATIN1.decode(bytes.subarray(0, 4)) !== 'fLaC') return {};
    let position = 4;
    let comments = {};
    const pictures = [];
    while (position + 4 <= bytes.length) {
      const header = bytes[position];
      const blockType = header & 0x7f;
      const length = (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3];
      position += 4;
      if (length > bytes.length - position) break;
      const block = bytes.subarray(position, position + length);
      if (blockType === 4) comments = parseVorbisComments(block);
      if (blockType === 6) {
        const picture = parseFlacPicture(block);
        if (picture) pictures.push(picture);
      }
      position += length;
      if (header & 0x80) break;
    }
    const result = metadataFromComments(comments);
    const cover = pictures.find((picture) => picture.pictureType === 3) || pictures[0];
    result.coverData ||= cover?.data || null;
    result.coverMime ||= cover?.mime || '';
    return result;
  }

  function parseOgg(bytes) {
    if (LATIN1.decode(bytes.subarray(0, 4)) !== 'OggS') return {};
    let position = 0;
    let packetParts = [];
    let comments = {};
    while (position + 27 <= bytes.length) {
      if (LATIN1.decode(bytes.subarray(position, position + 4)) !== 'OggS') { position += 1; continue; }
      const segments = bytes[position + 26];
      const tableStart = position + 27;
      const bodyStart = tableStart + segments;
      if (bodyStart > bytes.length) break;
      let bodyPosition = bodyStart;
      for (let index = 0; index < segments; index += 1) {
        const segmentLength = bytes[tableStart + index];
        if (bodyPosition + segmentLength > bytes.length) return metadataFromComments(comments);
        packetParts.push(bytes.subarray(bodyPosition, bodyPosition + segmentLength));
        bodyPosition += segmentLength;
        if (segmentLength < 255) {
          const packetLength = packetParts.reduce((sum, part) => sum + part.length, 0);
          const packet = new Uint8Array(packetLength);
          let cursor = 0;
          packetParts.forEach((part) => { packet.set(part, cursor); cursor += part.length; });
          packetParts = [];
          if (LATIN1.decode(packet.subarray(0, 7)) === '\x03vorbis') comments = parseVorbisComments(packet, 7);
          else if (LATIN1.decode(packet.subarray(0, 8)) === 'OpusTags') comments = parseVorbisComments(packet, 8);
          const parsed = metadataFromComments(comments);
          if (parsed.title || parsed.artist || parsed.coverData || parsed.lyrics.length) return parsed;
        }
      }
      position = bodyPosition;
    }
    return metadataFromComments(comments);
  }

  function boxType(bytes, offset) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
  }

  function forEachBox(bytes, start, end, callback) {
    let position = start;
    while (position + 8 <= end) {
      let size = readU32(bytes, position, false);
      const type = boxType(bytes, position + 4);
      let headerSize = 8;
      if (size === 1) {
        if (position + 16 > end) break;
        size = readU32(bytes, position + 8, false) * 0x100000000 + readU32(bytes, position + 12, false);
        headerSize = 16;
      } else if (size === 0) size = end - position;
      if (size < headerSize || position + size > end) break;
      callback(type, position + headerSize, position + size);
      position += size;
    }
  }

  function parseMp4Item(bytes, type, start, end, result) {
    forEachBox(bytes, start, end, (childType, childStart, childEnd) => {
      if (childType !== 'data' || childStart + 8 > childEnd) return;
      const valueType = readU32(bytes, childStart, false) & 0xffffff;
      const data = bytes.subarray(childStart + 8, childEnd);
      if (type === 'covr') {
        const mime = valueType === 14 ? 'image/png' : 'image/jpeg';
        if (!result.coverData) { result.coverData = data; result.coverMime = mime; }
      } else {
        const value = decodeText(data, valueType === 2 ? 2 : 3);
        if (type === '\xa9nam') result.title ||= value;
        if (type === '\xa9ART' || type === 'aART') result.artist ||= value;
        if (type === '\xa9alb') result.album ||= value;
        if (type === '\xa9lyr' && value) result.lyrics = parseLyrics(value);
      }
    });
  }

  function parseMp4(bytes) {
    const result = { lyrics: [], coverData: null, coverMime: '' };
    function walk(start, end, depth = 0) {
      if (depth > 8) return;
      forEachBox(bytes, start, end, (type, payloadStart, payloadEnd) => {
        if (type === 'meta') walk(payloadStart + 4, payloadEnd, depth + 1);
        else if (type === 'ilst') {
          forEachBox(bytes, payloadStart, payloadEnd, (itemType, itemStart, itemEnd) => parseMp4Item(bytes, itemType, itemStart, itemEnd, result));
        } else if (type === 'moov' || type === 'udta') walk(payloadStart, payloadEnd, depth + 1);
      });
    }
    walk(0, bytes.length);
    if (!result.title && !result.artist && !result.coverData && !result.lyrics.length) {
      for (let position = 4; position + 4 <= bytes.length; position += 1) {
        if (boxType(bytes, position) !== 'moov') continue;
        const start = position - 4;
        const size = readU32(bytes, start, false);
        if (size >= 8 && start + size <= bytes.length) { walk(start, start + size); break; }
      }
    }
    return result;
  }

function getSourceSize(source) {
  if (typeof ArrayBuffer !== 'undefined' && source instanceof ArrayBuffer) return source.byteLength;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(source)) return source.byteLength;
  return Number(source?.size) || 0;
}

async function readSourceBytes(source, start, end) {
  if (typeof ArrayBuffer !== 'undefined' && source instanceof ArrayBuffer) return new Uint8Array(source, start, Math.max(0, end - start));
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset + start, Math.max(0, end - start));
  const slice = source.slice(start, end);
  if (slice instanceof ArrayBuffer) return new Uint8Array(slice);
  return new Uint8Array(await slice.arrayBuffer());
}

export async function readEmbeddedAudioMetadata(source) {
  try {
    const size = getSourceSize(source);
    const header = await readSourceBytes(source, 0, Math.min(12, size));
    if (LATIN1.decode(header.subarray(0, 3)) === 'ID3') {
      const tagSize = Math.min(readSynchsafe(header, 6) + 10, MAX_TAG_BYTES, size);
      return parseID3(await readSourceBytes(source, 0, tagSize));
    }
    if (LATIN1.decode(header.subarray(0, 4)) === 'fLaC') return parseFlac(await readSourceBytes(source, 0, Math.min(size, MAX_TAG_BYTES)));
    if (LATIN1.decode(header.subarray(0, 4)) === 'OggS') return parseOgg(await readSourceBytes(source, 0, Math.min(size, MAX_TAG_BYTES)));
    if (header.length >= 8 && LATIN1.decode(header.subarray(4, 8)) === 'ftyp') {
      const head = await readSourceBytes(source, 0, Math.min(size, 8 * 1024 * 1024));
      let metadata = parseMp4(head);
      if ((!metadata.coverData || !metadata.lyrics.length) && size > head.length) {
        const tail = await readSourceBytes(source, Math.max(head.length, size - 16 * 1024 * 1024), size);
        const tailMetadata = parseMp4(tail);
        metadata = { ...metadata, ...Object.fromEntries(Object.entries(tailMetadata).filter(([key, value]) => value && (!Array.isArray(value) || value.length))) };
      }
      return metadata;
    }
  } catch (error) { console.warn('音频内嵌标签解析失败', error); }
  return {};
}
