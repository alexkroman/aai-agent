import { Agent, z } from "@aai/sdk";

export const agent = new Agent({
  name: "Night Owl",
  instructions:
    `You are Night Owl, a cozy evening companion. You help people wind down,
recommend entertainment, and share interesting facts about the night sky.
Keep your tone warm and relaxed. Use short, conversational responses.`,
  greeting:
    "Hey there, night owl. What are we getting into tonight — a movie, some music, or just chatting under the stars?",
  voice: "dan",
  prompt:
    "Transcribe movie titles, music artists, book names, and times accurately. Listen for genres like horror, comedy, sci-fi, jazz, ambient, and mood words like chill, intense, cozy, spooky.",
})
  .tool("sleep_calculator", {
    description:
      "Calculate optimal bedtime based on wake time and number of 90-minute sleep cycles. Most adults need 5-6 cycles.",
    parameters: z.object({
      wake_hour: z
        .number()
        .describe("Hour to wake up (0-23, 24-hour format)"),
      wake_minute: z.number().describe("Minute to wake up (0-59)"),
      cycles: z
        .number()
        .describe("Number of sleep cycles (typically 4-6, default 5)"),
    }),
    handler: ({ wake_hour, wake_minute, cycles }) => {
      const c = Math.min(Math.max(Math.round(cycles), 1), 8);
      const sleepMinutes = c * 90 + 15; // 15 min to fall asleep
      const wakeTotal = wake_hour * 60 + wake_minute;
      let bedTotal = wakeTotal - sleepMinutes;
      if (bedTotal < 0) bedTotal += 24 * 60;
      const bedHour = Math.floor(bedTotal / 60);
      const bedMin = bedTotal % 60;
      const pad = (n: number) => n.toString().padStart(2, "0");
      return {
        wake_time: `${pad(wake_hour)}:${pad(wake_minute)}`,
        bedtime: `${pad(bedHour)}:${pad(bedMin)}`,
        cycles: c,
        sleep_hours: (c * 90) / 60,
        note: "Includes 15 minutes to fall asleep",
      };
    },
  })
  .tool("recommend", {
    description:
      "Get curated recommendations for movies, music, or books based on mood.",
    parameters: z.object({
      category: z
        .enum(["movie", "music", "book"])
        .describe("Type of recommendation"),
      mood: z
        .enum(["chill", "intense", "cozy", "spooky", "funny"])
        .describe("Current mood"),
    }),
    handler: ({ category, mood }) => {
      const picks: Record<string, Record<string, string[]>> = {
        movie: {
          chill: [
            "Lost in Translation",
            "The Grand Budapest Hotel",
            "Amelie",
          ],
          intense: ["Inception", "Interstellar", "The Dark Knight"],
          cozy: ["When Harry Met Sally", "The Holiday", "Paddington 2"],
          spooky: ["The Shining", "Get Out", "Hereditary"],
          funny: ["The Big Lebowski", "Airplane!", "Superbad"],
        },
        music: {
          chill: [
            "Khruangbin — Con Todo El Mundo",
            "Tycho — Dive",
            "Bonobo — Migration",
          ],
          intense: [
            "Radiohead — OK Computer",
            "Tool — Lateralus",
            "Deftones — White Pony",
          ],
          cozy: [
            "Norah Jones — Come Away with Me",
            "Iron & Wine — Our Endless Numbered Days",
            "Bon Iver — For Emma, Forever Ago",
          ],
          spooky: [
            "Portishead — Dummy",
            "Massive Attack — Mezzanine",
            "Boards of Canada — Music Has the Right to Children",
          ],
          funny: [
            "Weird Al — Running with Scissors",
            "Flight of the Conchords — S/T",
            "Tenacious D — S/T",
          ],
        },
        book: {
          chill: [
            "Norwegian Wood — Murakami",
            "The Alchemist — Coelho",
            "Siddhartha — Hesse",
          ],
          intense: [
            "Blood Meridian — McCarthy",
            "House of Leaves — Danielewski",
            "Neuromancer — Gibson",
          ],
          cozy: [
            "The House in the Cerulean Sea — Klune",
            "A Man Called Ove — Backman",
            "Anxious People — Backman",
          ],
          spooky: [
            "The Haunting of Hill House — Jackson",
            "Mexican Gothic — Moreno-Garcia",
            "The Turn of the Screw — James",
          ],
          funny: [
            "Good Omens — Pratchett & Gaiman",
            "Hitchhiker's Guide — Adams",
            "Catch-22 — Heller",
          ],
        },
      };
      const list = picks[category]?.[mood] ?? ["No picks for that combo"];
      return { category, mood, picks: list };
    },
  });
