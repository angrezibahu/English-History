#!/usr/bin/env node
/**
 * Generate short placeholder lecture audio (WAV) with zero dependencies, so the
 * sample course has a real, playable audio file per week. Replace these with the
 * actual lecture recordings (any browser-playable format: .mp3, .m4a, .ogg, .wav).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function wav(seconds, freq) {
  const sampleRate = 8000; // small files; speech-band placeholder tone
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    // Gentle fade in/out so it isn't jarring.
    const env = Math.min(1, i / 400, (numSamples - i) / 400);
    const s = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.25 * env;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

const files = [
  { path: "course/term-1/week-01/lecture.wav", freq: 220 },
  { path: "course/term-1/week-02/lecture.wav", freq: 247 },
  { path: "course/term-1/week-03/lecture.wav", freq: 262 },
  { path: "course/term-2/week-01/lecture.wav", freq: 294 },
];

for (const f of files) {
  await writeFile(path.join(ROOT, f.path), wav(3, f.freq));
  console.log(`Wrote ${f.path}`);
}
