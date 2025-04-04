import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { exec, spawn } from "node:child_process";

import { readAsReadable } from "./utils";
import { AUDIO_DIR, CWD } from "./constants";
import { elevenlabs, openai, zyphra } from "./ai";

import type { RedditStory, StreamSrc } from "./types";

async function processText(title: string, story: string) {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL!,
    messages: [
      {
        role: "system",
        content: `
You are provided with a story sourced from Reddit. Your task is to transform this narrative into a version that is fully appropriate for posting on platforms such as YouTube or TikTok. This involves a careful revision to remove, replace, or reframe any explicit, offensive, or sensitive content while maintaining the original narrative's story. The revised story should be engaging, clear, and suitable for a diverse, general audience and almost as long as the original story.

Please follow these guidelines in your transformation:
1. Remove or alter any content that may be deemed inappropriate, explicit, or offensive.
2. Adjust the tone to be engaging and lively, ensuring the language is family-friendly and accessible.
3. Maintain the coherence and flow of the original story while enhancing its appeal for a social media audience.
4. Ensure you respond with text only, without using things like emojis
5. Make the story moe suitable for text to speech generation
6. Replace the words AITA with Am I the asshole?
`,
      },
      { role: "user", content: story },
    ],
  });

  return (title + ".\n\n" + response.choices[0].message.content) as string;
}

async function generateAudioElevenLabs(story: RedditStory) {
  const AUDIO_SRC = path.join(AUDIO_DIR, `${story.name}.mp3`);
  const audio = await elevenlabs.textToSpeech.convert("cjVigY5qzO86Huf0OWal", {
    text: await processText(story.title, story.body),
  });

  const stream = fs.createWriteStream(AUDIO_SRC);
  audio.pipe(stream);

  return { src: AUDIO_SRC, stream: audio };
}

async function generateAudioOpenaAI(story: RedditStory) {
  const AUDIO_SRC = path.join(AUDIO_DIR, `${story.name}.mp3`);
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "onyx",
    input: await processText(story.title, story.body),
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  await fs.promises.writeFile(AUDIO_SRC, buffer);

  return { src: AUDIO_SRC, stream: Readable.from(buffer) };
}

async function generateAudioZyphra(story: RedditStory) {
  const AUDIO_SRC = path.join(AUDIO_DIR, `${story.name}.mp3`);
  const blob = await zyphra.audio.speech.create({
    text: await processText(story.title, story.body),
    speaking_rate: 15,
    speaker_audio: await fs.promises.readFile(
      path.join(AUDIO_DIR, "eleven.wav"),
      "base64"
    ),
    mime_type: "audio/mp3",
  });
  const buffer = Buffer.from(await blob.arrayBuffer());

  await fs.promises.writeFile(AUDIO_SRC, buffer);
  return { src: AUDIO_SRC, stream: Readable.from(buffer) };
}

function generateAudioLocal(story: RedditStory) {
  return new Promise<StreamSrc>(async (resolve, reject) => {
    const outputPath = path.join(CWD, "media/audios", `${story.name}.mp3`);
    const text = await processText(story.title, story.body);

    const proc = spawn(
      "python3",
      [path.join(CWD, "utils/main.py"), "audio", "-o", outputPath, text],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: "inherit",
      }
    );

    proc.on("error", reject);

    proc.on("exit", (message) => {
      resolve(readAsReadable({ filePath: outputPath }));
    });
  });
}

export async function generateAudio(story: RedditStory) {
  const outputPath = path.join(CWD, "media/audios", `${story.name}.mp3`);
  if (false && await fs.promises.exists(outputPath)) {
    return await readAsReadable({ filePath: outputPath });
  }

  if (process.env.AUDIO_GENERATOR === "elevenlabs") {
    return generateAudioElevenLabs(story);
  } else if (process.env.AUDIO_GENERATOR === "openai") {
    return generateAudioOpenaAI(story);
  } else if (process.env.AUDIO_GENERATOR === "zyphra") {
    return generateAudioZyphra(story);
  } else if (process.env.AUDIO_GENERATOR === "local") {
    return generateAudioLocal(story);
  } else {
    throw new Error(
      `Unsupported audio generator: ${process.env.AUDIO_GENERATOR}`
    );
  }
}
