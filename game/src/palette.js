// The look plan, in one place. Emberline is a dusk foundry yard: cold steel blues
// against one hot amber, so the two teams read at a glance. Every colour the game
// draws comes from these names; the same names are the CSS custom properties.
export const PALETTE = {
  canvas: '#10141a',
  surface: '#1b212a',
  hairline: '#2b333f',
  ink: '#ece8de',
  muted: '#8b98a5',
  accent: '#f0a830',
  ember: '#f0a830',
  slate: '#5b8fd6',
  danger: '#e0533d',
  ok: '#7dc383',
};

export function shade(name) {
  return PALETTE[name];
}
