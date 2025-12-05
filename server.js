// ===============================
//  HR / SALES AGENT — AYNA MURATОВНА
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

// Telegram sender
async function sendTG(chatId, text) {
  const url = `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown"
    })
  });

  const data = await resp.json().catch(() => null);
  console.log("🔥 sendTG response:", data);
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

    const res = await pool.query(
      "SELECT * FROM employees WHERE tg_id = $1",
      [chatId]
    );

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
        "Меня зовут **Айна Муратовна**.\n" +
        "Я корпоративный психолог, коуч и бизнес-тренер компании.\n\n" +
        "Чтобы начать — напиши, пожалуйста, **своё полное имя**."
      );

      return { ok: true };
    }

    // Refresh after creation
    const res2 = await pool.query(
      "SELECT * FROM employees WHERE tg_id = $1",
      [chatId]
    );
    employee = res2.rows[0];
    const state = employee.registration_state;

    // ------------------------------
    // Step 1 — Full name
    // ------------------------------
    if (state === "awaiting_fullname") {
      await pool.query(
        "UPDATE employees SET full_name = $1, registration_state = 'awaiting_birthday' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(chatId, "Отлично! Теперь напиши, пожалуйста, **дату рождения** (ДД.ММ.ГГГГ).");
      return { ok: true };
    }

    // ------------------------------
    // Step 2 — Birthday
    // ------------------------------
    if (state === "awaiting_birthday") {
      await pool.query(
        "UPDATE employees SET birthday = $1, registration_state = 'awaiting_position' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(chatId, "Спасибо! Теперь укажи, пожалуйста, **должность**.");
      return { ok: true };
    }

    // ------------------------------
    // Step 3 — Position
    // ------------------------------
    if (state === "awaiting_position") {
      await pool.query(
        "UPDATE employees SET position = $1, registration_state = 'awaiting_experience' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(chatId, "Отлично. Теперь напиши — **какой у тебя опыт работы?**");
      return { ok: true };
    }

    // ------------------------------
    // Step 4 — Experience
    // ------------------------------
    if (state === "awaiting_experience") {
      await pool.query(
        "UPDATE employees SET experience = $1, registration_state = 'complete' WHERE tg_id = $2",
        [text, chatId]
      );

      await sendTG(
        chatId,
        "Благодарю 🙏\n\n" +
        "Регистрация завершена!\n\n" +
        "Теперь я помогу тебе расти профессионально:\n" +
        "• улучшать продажи\n" +
        "• повышать эффективность\n" +
        "• держать мотивацию\n" +
        "• работать со стрессом\n\n" +
        "Пиши в любой момент — я рядом ❤️"
      );

      return { ok: true };
    }

    // ------------------------------
    // AFTER REGISTRATION
    // ------------------------------
    if (state === "complete") {
      await sendTG(chatId, "Я рядом. Что тебя волнует сейчас?");
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
