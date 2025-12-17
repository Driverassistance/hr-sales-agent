export function isGarbage(text) {
  if (!text) return true;
  if (text.length < 3) return true;
  return /^[^a-zA-Zа-яА-Я0-9]+$/.test(text);
}

export function strictReply(count) {
  if (count === 1) {
    return "Прошу отвечать по существу.";
  }
  if (count === 2) {
    return "Давайте без шуточек. Это рабочий диалог.";
  }
  return "Хватит поясничать. Соберитесь. Мы здесь работаем, не играем.";
}
