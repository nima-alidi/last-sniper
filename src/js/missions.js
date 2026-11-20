// Story contracts. Each one is a different city layout (seed) and a different target.
// `look` overrides the random look of the target so he can be recognised from the dossier photo.
export const CONTRACTS = [
  {
    id: 1, seed: 206, title: 'THE BANKER', codename: 'GOLDEN PARACHUTE',
    name: 'Viktor Hale', age: 54, role: 'Private banker',
    intro: 'Hale moved the money that paid for three coups. Tonight he takes his usual walk through the financial district — with two armed men at his back.',
    look: { model: 'business_man', scale: 1.05, skin: 0xe3b48c, hair: 0x9a9a98, suit: 0xe2d8bd, tie: 0xc23b32, shoe: 0x4a3220,
      acc: [{ type: 'fedora', color: 0xe8e6e1 }, { type: 'glasses' }] },
    civilians: 54, guards: 2, snipers: 1, time: 330, aimTime: 2.5,
  },
  {
    id: 2, seed: 208, title: 'THE DIRECTOR', codename: 'FINAL CUT',
    name: 'Elena Marsh', age: 47, role: 'Media executive',
    intro: 'Marsh buried the footage that would have ended a war crimes trial. She never leaves the building without security, but she always walks the last block.',
    look: { model: 'woman_c', scale: 1.0, skin: 0xc78e5f, hair: 0x16110f, top: 0x8e1b2e, bottom: 0x1d1d20, shoe: 0x151515, acc: [{ type: 'glasses' }] },
    civilians: 56, guards: 3, snipers: 1, time: 330, aimTime: 2.3,
  },
  {
    id: 3, seed: 203, title: 'THE SMUGGLER', codename: 'DEAD DROP',
    name: 'Dmitri Voss', age: 41, role: 'Import / export',
    intro: 'Voss ships weapons in grain containers. His crew watches the rooftops too, so expect return fire from above as well as from the street.',
    look: { model: 'adventurer', scale: 1.02, skin: 0xe3b48c, hair: 0x35241a, top: 0xe07a2c, bottom: 0x1d1d20, shoe: 0x4a3220,
      acc: [{ type: 'cap', color: 0xe0b92b }, { type: 'backpack', color: 0x1b1b1d }] },
    civilians: 58, guards: 3, snipers: 2, time: 320, aimTime: 2.2,
  },
  {
    id: 4, seed: 204, title: 'THE POP STAR', codename: 'ENCORE',
    name: 'Nova Cross', age: 26, role: 'Recording artist',
    intro: 'Nova laundered a cartel\'s cash through her tours. The concert crowd is huge today and her entourage is armed. Watch the civilians.',
    look: { model: 'punk_b', scale: 1.0, skin: 0x6e4529, top: 0xe0709e, bottom: 0x1d1d20, shoe: 0xdddddd, acc: [{ type: 'glasses' }] },
    civilians: 66, guards: 3, snipers: 2, time: 300, aimTime: 2.0,
  },
  {
    id: 5, seed: 202, title: 'THE SENATOR', codename: 'LAST VOTE',
    name: 'Anton Kral', age: 62, role: 'Senator',
    intro: 'Kral can swing the vote that opens the borders to the cartel. The best-protected man in the city: four guards on foot and three shooters on the buildings.',
    look: { model: 'man_in_suit', scale: 1.04, skin: 0xe3b48c, hair: 0xdddddd, suit: 0x1c2947, tie: 0x7a3fa8, acc: [{ type: 'fedora', color: 0x6b6e74 }, { type: 'glasses' }] },
    civilians: 66, guards: 4, snipers: 3, time: 300, aimTime: 1.8,
  },
];

const KEY = 'ls_story';
export function loadProgress() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return { stars: p.stars || [], unlocked: Math.max(1, p.unlocked || 1) }; }
  catch (e) { return { stars: [], unlocked: 1 }; }
}
export function saveProgress(idx, stars) {
  const p = loadProgress();
  p.stars[idx] = Math.max(p.stars[idx] || 0, stars);
  p.unlocked = Math.min(CONTRACTS.length, Math.max(p.unlocked, idx + 2));
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* storage unavailable */ }
  return p;
}
