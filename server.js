// ===============================
//  HR / SALES AGENT — AYNA MURATOVNA
// ===============================

// Load ENV
import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import fetch from "node-fetch";
import pkg from "pg";

// Init Fastify
const fastify = Fastify({ logger: true });

// DB
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------------------------------
// Telegram sender
// ---------------------------------
async function sendTG(chatId, text) {
  const url = `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  const data = await resp.json().catch(() => null);
  console.log("🔥 sendTG response:", data);
}

// ---------------------------------
// Helpers: tone & validation
// ---------------------------------

// Простейший детект хамства
function isRude(text = "") {
  const t = text.toLowerCase();
  const rudeWords = [
    "заткнись",
    "отстань",
    "иди отсюда",
    "иди на",
    "нах",
    "нахер",
    "нахуй",
    "дура",
    "тупая",
    "долбо",
    "идиот",
    "еба",
    "ебан",
    "пошел вон",
    "пошёл вон",
    "пошла вон",
    "пошла на",
  ];
  return rudeWords.some((w) => t.includes(w));
}

// Простейший детект «шутки/несерьёза»
function looksLikeJokeOrTrash(text = "") {
  const t = text.toLowerCase().trim();

  if (!t) return false;

  // много «ахах», смайлов, «лол» и т.п.
  if (t.includes("ахах") || t.includes("хаха") || t.includes("лол") || t.includes("кек"))
    return true;

  // смайлики без содержания
  if (/^[\s\p{Emoji_Presentation}\p{Emoji}\p{Extended_Pictographic}]+$/u.test(t)) return true;

  // очень короткая абракадабра
  if (t.length <= 3 && !/[а-яa-z]/i.test(t)) return true;

  // клавиатурный спам: почти одни согласные/бессмысленное
  const letters = t.replace(/[^a-zа-яё]/gi, "");
  if (letters && letters.length >= 4) {
    const vowels = letters.match(/[aeiouаеёиоуыэюя]/gi) || [];
    if (vowels.length / letters.length < 0.2) return true;
  }

  return false;
}

// Валидация ФИО
function validateFullName(text = "") {
  const t = text.trim();
  if (t.length < 5) return false;
  if (/\d/.test(t)) return false;

  const parts = t.split(/\s+/);
  if (parts.length < 2) return false;

  // хотя бы 2 адекватных слова
  const validParts = parts.filter((p) => p.length >= 2);
  return validParts.length >= 2;
}

// Валидация даты рождения: ДД.ММ.ГГГГ + диапазон 1950–2007
function validateBirthday(text = "") {
  const t = text.trim();
  const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return false;

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);

  if (year < 1950 || year > 2007) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // грубая проверка месяцев
  const thirtyDayMonths = [4, 6, 9, 11];
  if (thirtyDayMonths.includes(month) && day > 30) return false;
  if (month === 2 && day > 29) return false;

  return true;
}

// Валидация должности
function validatePosition(text = "") {
  const t = text.trim();
  if (t.length < 3 || t.length > 50) return false;
  if (/^\d+$/.test(t)) return false; // только цифры
  if (!/[a-zа-яё]/i.test(t)) return false; // нет букв
  return true;
}

// Нормализация и валидация опыта
function normalizeExperience(text = "") {
  const t = text.toLowerCase().trim();

  const mapping = [
    { variants: ["новичок", "без опыта", "только начал", "начинающий"], value: "новичок" },
    { variants: ["менее года", "<1 года", "< 1 года", "0-1"], value: "менее года" },
    { variants: ["1 год", "один год", "1год"], value: "1 год" },
    { variants: ["2 года", "два года", "2года"], value: "2 года" },
    { variants: ["3 года", "три года", "3года", "3+ лет", "3+ года"], value: "3+ лет" },
    {
      variants: [
        "больше 5 лет",
        "5 лет",
        "5+ лет",
        "много",
        "давно",
        "10 лет",
        "10+ лет",
      ],
      value: "5+ лет",
    },
  ];

  for (const item of mapping) {
    if (item.variants.some((v) => t.includes(v))) {
      return item.value;
    }
  }

  // Попробуем по цифре
  const num = parseInt(t.replace(/\D/g, ""), 10);
  if (!isNaN(num)) {
    if (num === 0) return "менее года";
    if (num === 1) return "1 год";
    if (num === 2) return "2 года";
    if (num === 3 || num === 4) return "3+ лет";
    if (num >= 5) return "5+ лет";
  }

  return null; // не смогли распознать
}

// Общий обработчик «тона»
async function handleToneGuard(chatId, text) {
  if (isRude(text)) {
    await sendTG(
      chatId,
      "Такой тон *недопустим*.\n\n" +
        "Я фиксирую это как случай неуважительного обращения.\n" +
        "Информация будет передана вашему руководителю.\n\n" +
        "Давайте продолжим в рабочем формате."
    );
    return "rude";
  }

  if (looksLikeJokeOrTrash(text)) {
    await sendTG(
      chatId,
      "Давайте без шуточек 😊\n" +
        "Мы сейчас работаем над вашей профессиональной программой развития.\n" +
        "Ответьте, пожалуйста, корректно — это важно для вас же."
    );
    return "joke";
  }

  return "ok";
}

// ------------------------------
// MAIN WEBHOOK HANDLER
// ------------------------------
fastify.post("/webhook", async (req, reply) => {
  try {
    console.log("🔥 RAW UPDATE:", JSON.stringify(req.body, null, 2));

    const body = req.body;
    if (!body.message) return { ok: true };

    const chatId = body.message.chat.id;
    const text = (body.message.text || "").trim();

    console.log("🔥 point A: BEFORE SELECT");

    const res = await pool.query("SELECT * FROM employees WHERE tg_id = $1", [chatId]);
    let employee = res.rows[0];

    console.log("🔥 point B: employee =", employee);

    // ------------------------------
    // FIRST TIME — NO EMPLOYEE
    // ------------------------------
    if (!employee) {
      console.log("🔥 point C: NEW USER — start registration");

      await pool.query(
        "INSERT INTO employees (tg_id, registration_state) VALUES ($1, $2)",
        [chatId, "awaiting_fullname"]
      );

      await sendTG(
        chatId,
        "Приветствую 👋\n\n" +
          "Меня зовут *Айна Муратовна*.\n" +
          "Я корпоративный психолог, коуч и бизнес-тренер компании.\n\n" +
          "Для начала давайте познакомимся.\n" +
          "Напишите, пожалуйста, *своё полное имя* (ФИО)."
      );

      return { ok: true };
    }

    // Refresh after creation
    const res2 = await pool.query("SELECT * FROM employees WHERE tg_id = $1", [chatId]);
    employee = res2.rows[0];
    const state = employee.registration_state;

    // Если человек уже зарегистрирован и пишет /start
    if (state === "complete" && text === "/start") {
      await sendTG(
        chatId,
        "Снова на связи, *Айна Муратовна*.\n" +
          "Я рядом. Можем разобрать рабочие ситуации, продажи, стресс или мотивацию.\n\n" +
          "Что волнует вас сейчас?"
      );
      return { ok: true };
    }

    // ------------------------------
    // Step 1 — Full name
    // ------------------------------
    if (state === "awaiting_fullname") {
      // сначала проверяем тон
      const tone = await handleToneGuard(chatId, text);
      if (tone !== "ok") {
        // не двигаем состояние, ждём нормальный ответ
        return { ok: true };
      }

      if (!validateFullName(text)) {
        await sendTG(
          chatId,
          "ФИО выглядит некорректно.\n\n" +
            "Пожалуйста, укажите *полностью*: имя и фамилию (при необходимости отчество).\n" +
            "Например: *Иванов Иван Иванович*."
        );
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET full_name = $1, registration_state = 'awaiting_birthday' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(
        chatId,
        "Отлично 👌\n\nТеперь напишите, пожалуйста, *дату рождения* в формате *ДД.ММ.ГГГГ*.\n" +
          "Например: *05.09.1990*."
      );
      return { ok: true };
    }

    // ------------------------------
    // Step 2 — Birthday
    // ------------------------------
    if (state === "awaiting_birthday") {
      const tone = await handleToneGuard(chatId, text);
      if (tone !== "ok") {
        return { ok: true };
      }

      if (!validateBirthday(text)) {
        await sendTG(
          chatId,
          "Дата рождения указана в некорректном формате или нереалистична.\n\n" +
            "Пожалуйста, введите дату в формате *ДД.ММ.ГГГГ* в разумном диапазоне.\n" +
            "Например: *14.03.1987*."
        );
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET birthday = $1, registration_state = 'awaiting_position' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(
        chatId,
        "Спасибо 🙌\n\nТеперь укажите, пожалуйста, *вашу должность* в компании.\n" +
          "Например: *торговый представитель*, *супервайзер*, *заведующий складом*."
      );
      return { ok: true };
    }

    // ------------------------------
    // Step 3 — Position
    // ------------------------------
    if (state === "awaiting_position") {
      const tone = await handleToneGuard(chatId, text);
      if (tone !== "ok") {
        return { ok: true };
      }

      if (!validatePosition(text)) {
        await sendTG(
          chatId,
          "Не поняла вашу должность 🤔\n\n" +
            "Напишите, пожалуйста, *реальную должность* без шуток и сокращений.\n" +
            "Например: *торговый представитель*, *мерчендайзер*, *руководитель отдела продаж*."
        );
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET position = $1, registration_state = 'awaiting_experience' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(
        chatId,
        "Хорошо 👍\n\nТеперь напишите, пожалуйста, *ваш опыт работы в продажах* или в текущей роли.\n" +
          "Можно в свободной форме — например: *новичок*, *1 год*, *3 года*, *больше 5 лет*."
      );
      return { ok: true };
    }

    // ------------------------------
    // Step 4 — Experience
    // ------------------------------
    if (state === "awaiting_experience") {
      const tone = await handleToneGuard(chatId, text);
      if (tone !== "ok") {
        return { ok: true };
      }

      const normalized = normalizeExperience(text);
      if (!normalized) {
        await sendTG(
          chatId,
          "Чтобы я могла правильно выстроить программу развития, давайте определимся с опытом.\n\n" +
            "Выберите один из вариантов и напишите его:\n" +
            "• *новичок*\n" +
            "• *менее года*\n" +
            "• *1 год*\n" +
            "• *2 года*\n" +
            "• *3+ лет*\n" +
            "• *5+ лет*"
        );
        return { ok: true };
      }

      await pool.query(
        "UPDATE employees SET experience = $1, registration_state = 'complete' WHERE tg_id = $2",
        [normalized, chatId]
      );

      await sendTG(
        chatId,
        "Благодарю 🙏\n\n" +
          "Регистрация завершена.\n\n" +
          "Теперь моя задача — помочь вам:\n" +
          "• усиливать *продажи* и результаты\n" +
          "• прокачивать *переговоры* и работу с возражениями\n" +
          "• держать *дисциплину* и внутренний тонус\n" +
          "• справляться со *стрессом* и нагрузкой\n\n" +
          "Пишите в любой момент — я рядом. Начнём с чего-то конкретного или хотите общую диагностику?"
      );

      return { ok: true };
    }

    // ------------------------------
    // AFTER REGISTRATION
    // ------------------------------
    if (state === "complete") {
      // здесь дальше можно будет разветвить логику:
      // продажи, стресс, план на день, отчёт и т.п.
      await sendTG(
        chatId,
        "Я рядом.\n" +
          "Можем разобрать конкретную ситуацию с клиентом, ваш день, мотивацию или состояние.\n\n" +
          "Напишите, что сейчас для вас самое актуальное."
      );
      return { ok: true };
    }

    return { ok: true };
  } catch (err) {
    console.error("❌ FATAL ERROR:", err.message, err.stack);
    return { ok: true };
  }
});

// START SERVER
fastify.listen({ port: process.env.PORT || 3006, host: "0.0.0.0" });
console.log("🔥 SERVER ЗАПУЩЕН");
