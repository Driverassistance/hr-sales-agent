export function isGarbage(text) {
  if (!text) return true;

  const t = text.trim();

  if (t.length < 4) return true;

  // латиница без смысла
  if (/^[a-zA-Z]+$/.test(t) && t.length < 8) return true;

  // повторяющиеся символы
  if (/^(.)\1{2,}$/.test(t)) return true;

  // наборы типа asdf, qwer, aaaa
  if (/^[a-zA-Z]{3,}$/.test(t) && !/[aeiouаеёиоуыэюя]/i.test(t)) return true;

  // только символы
  if (/^[^a-zA-Zа-яА-Я0-9]+$/.test(t)) return true;

  return false;
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
