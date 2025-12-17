export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function humanDelay(text) {
  const length = text.length;

  if (length < 40) {
    await sleep(2000 + Math.random() * 2000);
  } else if (length < 120) {
    await sleep(4000 + Math.random() * 3000);
  } else {
    await sleep(7000 + Math.random() * 5000);
  }
}

export async function busyDelay() {
  const variants = [5000, 7000, 10000];
  const delay = variants[Math.floor(Math.random() * variants.length)];
  await sleep(delay);
}
