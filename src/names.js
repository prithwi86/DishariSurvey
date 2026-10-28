'use strict';
const crypto = require('crypto');

const ADJECTIVES = ['black', 'blue', 'red', 'golden', 'silver', 'green', 'amber', 'scarlet', 'misty', 'jade'];
const ANIMALS = ['tiger', 'peacock', 'lotus', 'falcon', 'dolphin', 'panther', 'sparrow', 'elephant', 'koel', 'heron'];
// Used only once the base lists start colliding.
const MORE_ADJECTIVES = ['coral', 'ivory', 'indigo', 'saffron', 'crimson', 'olive', 'copper', 'pearl', 'sunny', 'quiet'];
const MORE_ANIMALS = ['myna', 'kingfisher', 'deer', 'otter', 'swan', 'parrot', 'leopard', 'crane', 'robin', 'lark'];

const pick = (list) => list[crypto.randomInt(list.length)];

function candidate(adjectives, animals) {
  return pick(adjectives) + pick(animals) + (1 + crypto.randomInt(99));
}

/** Returns a display name not yet used in this survey. `isTaken(name)` checks the DB. */
function uniqueDisplayName(isTaken) {
  for (let i = 0; i < 40; i++) {
    const name = candidate(ADJECTIVES, ANIMALS);
    if (!isTaken(name)) return name;
  }
  const adjectives = ADJECTIVES.concat(MORE_ADJECTIVES);
  const animals = ANIMALS.concat(MORE_ANIMALS);
  for (let i = 0; i < 200; i++) {
    const name = candidate(adjectives, animals);
    if (!isTaken(name)) return name;
  }
  // Practically unreachable: fall back to a wider number range.
  for (;;) {
    const name = pick(adjectives) + pick(animals) + (100 + crypto.randomInt(9900));
    if (!isTaken(name)) return name;
  }
}

module.exports = { uniqueDisplayName, ADJECTIVES, ANIMALS };
