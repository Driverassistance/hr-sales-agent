// ===============================
//  HR / SALES AGENT — AYNA MURATOVNA
//  ПОЛНАЯ "ЖИВАЯ" ВЕРСИЯ
// ===============================

import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import fetch from "node-fetch";
import pkg from "pg";
import { sendMessage, sendTyping } from "./utils/telegram.js";
import { sleep, humanDelay, busyDelay } from "./core/delays.js";
import { getSession, incInvalid, resetInvalid } from "./core/session.js";
import { isGarbage, strictReply } from "./core/guards.js";
import { isSalesTrigger, handleSales } from "./flows/sales.js";


const fastify = Fastify({ logger: true });

// DB
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------------------------------
// UTILS: Telegram helpers
// ---------------------------------


async function sendHuman(chatId, text) {
  await sendTyping(chatId);

  const delay = humanDelay(text);
  await new Promise(res => setTimeout(res, delay));

  await sendMsg(chatId, text);
}

async function sendMsg(chatId, text) {
  await sendTyping(process.env.TG_BOT_TOKEN, chatId);
  await humanDelay(text);
  await sendMessage(process.env.TG_BOT_TOKEN, chatId, text);
}


// ---------------------------------
// Tone check
// ---------------------------------

function isRude(text = "") {
  const rude = [
    "нах", "иди на", "пошел", "пошёл", "долбо", "тупая",
    "дура", "идиот", "ебан", "глупая", "отстань", "заткнись",
  ];
  const t = text.toLowerCase();
  return rude.some(w => t.includes(w));
}

function looksLikeJoke(text = "") {
  const t = text.toLowerCase();

  if (t.includes("ахах") || t.includes("кек") || t.includes("лол")) return true;
  if (/^[\p{Emoji}|\p{Extended_Pictographic}]+$/u.test(t)) return true;
  if (t.length <= 3 && !/[а-яa-z]/i.test(t)) return true;

  const letters = t.replace(/[^a-zа-яё]/gi, "");
  if (letters && letters.length >= 4) {
    const vowels = letters.match(/[аеёиоуыэюяaeiou]/gi) || [];
    if (vowels.length / letters.length < 0.2) return true;
  }

  return false;
}

async function toneGuard(chatId, text) {
  if (isRude(text)) {
    await sendHuman(
      chatId,
      "Такой тон *недопустим*.\n\n" +
      "Я фиксирую это как случай неуважительного обращения.\n" +
      "Информация будет передана вашему руководителю.\n\n" +
      "Давайте продолжим в рабочем формате."
    );
    return "rude";
  }

  if (looksLikeJoke(text)) {
    await sendHuman(
      chatId,
      "Давайте без шуточек. Мы сейчас работаем над вашей профессиональной программой развития. Ответьте корректно, пожалуйста."
    );
    return "joke";
  }

  return "ok";
}

// ---------------------------------
// Validators
// ---------------------------------

function validateFullName(t = "") {
  t = t.trim();
  if (t.length < 5) return false;
  if (/\d/.test(t)) return false;

  const parts = t.split(/\s+/);
  if (parts.length < 2) return false;

  return true;
}

function validateBirthday(t = "") {
  t = t.trim();
  const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return false;

  const [_, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);

  if (year < 1950 || year > 2007) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  return true;
}

function validatePosition(t = "") {
  t = t.trim();
  if (t.length < 3) return false;
  if (!/[a-zа-яё]/i.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  return true;
}

function normalizeExperience(t = "") {
  t = t.toLowerCase().trim();
  const variants = [
    { keys: ["новичок"], out: "новичок" },
    { keys: ["1"], out: "1 год" },
    { keys: ["2"], out: "2 года" },
    { keys: ["3", "3+"], out: "3+ лет" },
    { keys: ["5", "5+", "больше"], out: "5+ лет" },
  ];

  const n = parseInt(t.replace(/\D/g, ""), 10);
  if (!isNaN(n)) {
    if (n === 0) return "менее года";
    if (n === 1) return "1 год";
    if (n === 2) return "2 года";
    if (n === 3 || n === 4) return "3+ лет";
    if (n >= 5) return "5+ лет";
  }

  return null;
}

// ---------------------------------
//  RANDOM "busy" behavior
// ---------------------------------

function randomBusy() {
  // 15% шанс включить "занята"
  return Math.random() < 0.15;
}

async function sendBusy(chatId) {
  const variants = [
    "Я сейчас немного занята, дайте мне пару минут, я вернусь 🙏",
    "Секунду… заканчиваю консультацию.",
    "Спасибо, что написали. Одну минутку, пожалуйста.",
    "Ненадолго отвлеклась, сейчас отвечу.",
  ];

  const msg = variants[Math.floor(Math.random() * variants.length)];
  await sendHuman(chatId, msg);
}

// ---------------------------------
//  MAIN WEBHOOK
// ---------------------------------

fastify.post("/webhook", async (req, reply) => {
  try {
    const body = req.body;
    if (!body.message) return { ok: true };

    const chatId = body.message.chat.id;
    const text = (body.message.text || "").trim();
	const session = getSession(chatId);

if (isGarbage(text)) {
  const count = incInvalid(session);
  await sendMsg(chatId, strictReply(count));
  return { ok: true };
} else {
  resetInvalid(session);
}
    // === SALES FLOW ===
    if (isSalesTrigger(text)) {
      session.lastTopic = "sales";
      const handled = await handleSales({ sendMsg, chatId, session, text });
      if (handled) return { ok: true };
    }

    console.log("🔥 RAW UPDATE:", JSON.stringify(req.body, null, 2));

    const r1 = await pool.query("SELECT * FROM employees WHERE tg_id = $1", [chatId]);
    let user = r1.rows[0];

    // ---------------------------------
    // NEW USER
    // ---------------------------------
    if (!user) {
      await pool.query(
        "INSERT INTO employees (tg_id, registration_state) VALUES ($1, $2)",
        [chatId, "await_fullname"]
      );

      await sendHuman(
        chatId,
        "Здравствуйте 👋\nМеня зовут *Айна Муратовна*. Давайте начнём с простого — напишите, пожалуйста, ваше *ФИО полностью*."
      );

      return { ok: true };
    }

    const state = user.registration_state;

    // sometimes simulate "busy"
    if (randomBusy()) {
      await sendBusy(chatId);
    }

    // ---------------------------------
    // FULLNAME
    // ---------------------------------
    if (state === "await_fullname") {
      const tone = await toneGuard(chatId, text);
      if (tone !== "ok") return { ok: true };

      if (!validateFullName(text)) {
        await sendHuman(
          chatId,
          "ФИО выглядит некорректно. Укажите, пожалуйста, фамилию и имя."
        );
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET full_name = $1, registration_state = 'await_birthday' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendHuman(
        chatId,
        "Спасибо 🙌\nТеперь напишите, пожалуйста, вашу *дату рождения* в формате ДД.ММ.ГГГГ."
      );

      return { ok: true };
    }

    // ---------------------------------
    // BIRTHDAY
    // ---------------------------------
    if (state === "await_birthday") {
      const tone = await toneGuard(chatId, text);
      if (tone !== "ok") return { ok: true };

      if (!validateBirthday(text)) {
        await sendHuman(chatId, "Дата рождения неверна. Укажите в формате *ДД.MM.ГГГГ*.");
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET birthday = $1, registration_state = 'await_position' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendHuman(
        chatId,
        "Хорошо 👍\nТеперь напишите вашу *должность*."
      );

      return { ok: true };
    }

    // ---------------------------------
    // POSITION
    // ---------------------------------
    if (state === "await_position") {
      const tone = await toneGuard(chatId, text);
      if (tone !== "ok") return { ok: true };

      if (!validatePosition(text)) {
        await sendHuman(chatId, "Должность указана некорректно. Напишите реальную должность.");
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET position = $1, registration_state = 'await_exp' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendHuman(
        chatId,
        "Хорошо. Теперь напишите ваш *опыт работы* — например: новичок, 1 год, 3+ лет."
      );

      return { ok: true };
    }

    // ---------------------------------
    // EXPERIENCE
    // ---------------------------------
    if (state === "await_exp") {
      const tone = await toneGuard(chatId, text);
      if (tone !== "ok") return { ok: true };

      const exp = normalizeExperience(text);
      if (!exp) {
        await sendHuman(
          chatId,
          "Опыт не распознан. Напишите: новичок / 1 год / 2 года / 3+ лет / 5+ лет."
        );
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET experience = $1, registration_state = 'complete' WHERE tg_id = $2",
        [exp, chatId]
      );

      // ---------------------------------
      // 4-СООБЩЕНИЯ ПРИВЕТСТВИЯ ПОСЛЕ РЕГИСТРАЦИИ
      // ---------------------------------

      await sendHuman(
        chatId,
        "Спасибо 🙏\nРегистрация завершена. Дайте мне минутку…"
      );

      await sendHuman(
        chatId,
        "Я — *Айна Муратовна*: корпоративный психолог, адаптолог и бизнес-тренер с 15-летним опытом. " +
        "Буду сопровождать вас, помогать развиваться и усиливать результаты."
      );

      await sendHuman(
        chatId,
        "Мы будем работать над:\n" +
        "• продажами и переговорами\n" +
        "• дисциплиной\n" +
        "• стрессоустойчивостью\n" +
        "• уверенностью и мотивацией\n" +
        "• вашим личным развитием"
      );

      await sendHuman(
        chatId,
        "Всё, что вы пишете — *конфиденциально*. " +
        "Руководству передаются только результаты тестов и факты нарушения деловой этики."
      );

      await sendHuman(
        chatId,
        "Можете писать в любое время. Что сейчас актуально?"
      );

      return { ok: true };
    }

    // ---------------------------------
    // AFTER REGISTRATION
    // ---------------------------------

    if (state === "complete") {

  // 1. Анти-флуд / анти-личное
  const nonWork = [
    "как дела", "что делаешь", "чем занимаешься",
    "скучаешь", "поболтаем", "поговорим",
    "кофе", "чай", "любишь", "нравится",
    "ты кто", "кто ты", "расскажи о себе",
    "давай просто", "ничего не хочу", "не хочу работать"
  ];

  const lower = text.toLowerCase();
  if (nonWork.some(w => lower.includes(w))) {
    await sendHuman(
      chatId,
      "Я здесь исключительно для рабочих вопросов: продажи, клиенты, дисциплина, мотивация, стресс, эффективность.\n" +
      "Давайте вернёмся к делу."
    );
    return { ok: true };
  }

  // 2. Определение темы
  if (lower.includes("продаж") || lower.includes("клиент") || lower.includes("выручк")) {
    await sendHuman(chatId,
      "Поняла. Давайте перейдём к продажам.\n" +
      "Опишите, пожалуйста, что именно сейчас вызывает трудности: клиент, возражение, отсутствие мотивации, или что-то ещё?"
    );
    return { ok: true };
  }

  if (lower.includes("мотивац") || lower.includes("не хочу") || lower.includes("устал")) {
    await sendHuman(chatId,
      "Поняла. Давайте разберём вашу мотивацию.\n" +
      "Что именно ощущаете сейчас: усталость, потеря интереса, эмоциональное выгорание, давление?",
    );
    return { ok: true };
  }

  if (lower.includes("стресс") || lower.includes("нерв") || lower.includes("тревог")) {
    await sendHuman(chatId,
      "Хорошо. Разберём стресс.\n" +
      "Что стало причиной: клиенты, коллектив, личная ситуация или перегруз?"
    );
    return { ok: true };
  }

  if (lower.includes("дисциплин") || lower.includes("опаздыв") || lower.includes("режим")) {
    await sendHuman(chatId,
      "Давайте обсудим дисциплину.\n" +
      "С чем именно сложности: режим дня, график, внимание или обещания самому себе?"
    );
    return { ok: true };
  }

  // 3. Если тема не определена
  await sendHuman(
    chatId,
    "Я с вами. Давайте точно сформулируем вопрос: продажи, мотивация, клиентская ситуация, стресс или дисциплина?"
  );

  return { ok: true };
}

  } catch (err) {
    console.error("❌ FATAL ERROR:", err.message, err.stack);
    return { ok: true };
  }
});

// START SERVER
fastify.listen({ port: process.env.PORT || 3006, host: "0.0.0.0" });
console.log("🔥 SERVER ЗАПУЩЕН (LIVE HR MODE)");
