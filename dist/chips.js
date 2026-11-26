// Values increase in whole multiples so a large chip can be exchanged exactly.
const clay = [
  [1, '#f2e9cd'], [5, '#ce4541'], [25, '#278d70'], [100, '#384956'],
  [500, '#9674c8'], [1000, '#d5aa40'], [5000, '#568fc4'], [25000, '#bf7450'],
  [100000, '#b56087'], [500000, '#508e96'], [1000000, '#b59666']
];

export function chipCounts(amount, buyIn) {
  let remaining = amount;
  const counts = clay.map(() => 0);
  let count = 0;
  for (let i = clay.length - 1; i >= 0; i--) {
    counts[i] = Math.floor(remaining / clay[i][0]);
    remaining %= clay[i][0];
    count += counts[i];
  }

  // Keep small pots legible and give typical buy-ins about two stacks.
  const target = Math.min(24, Math.max(5, Math.round(18 * amount / buyIn)));
  for (let i = clay.length - 1; i > 0; i--) {
    const change = clay[i][0] / clay[i - 1][0];
    const exchanges = Math.min(counts[i], Math.max(0, Math.floor((target - count) / (change - 1))));
    counts[i] -= exchanges;
    counts[i - 1] += exchanges * change;
    count += exchanges * (change - 1);
  }
  return counts.map((quantity, i) => ({quantity, value: clay[i][0], color: clay[i][1]}))
    .filter(chip => chip.quantity > 0);
}

export function chipPile(amount, buyIn) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 5 * buyIn) return '';
  const breakdown = chipCounts(amount, buyIn);
  const discs = breakdown.flatMap(({quantity, color}) => Array(quantity).fill(color));
  const stacks = [];
  const capacity = Math.max(8, Math.ceil(discs.length / 3));
  for (let i = 0; i < discs.length; i += capacity) {
    const column = discs.slice(i, i + capacity);
    const layers = column.map((color, level) =>
      `<i style="--clay:${color};--level:${level}"></i>`).join('');
    stacks.push(`<span class="chip-tower" style="--height:${column.length}">${layers}</span>`);
  }
  const label = breakdown.map(({quantity, value}) => quantity + ' × ' + value.toLocaleString('en-US')).join(', ');
  return `<span class="chip-pile" role="img" aria-label="Chip values: ${label}" title="${label}">${stacks.join('')}</span>`;
}
