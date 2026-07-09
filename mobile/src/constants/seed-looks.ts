import type { Look, ClothingItem } from '@/lib/state/lookStore';

const makeItem = (
  id: string,
  category: ClothingItem['category'],
  name: string,
  price: string,
  emoji: string,
  seed: number
): ClothingItem => ({
  id,
  category,
  name,
  price,
  link: '#',
  emoji,
  photoUri: `https://picsum.photos/seed/item${seed}/400/400`,
  alternates: [],
});

export const SEED_LOOKS: Look[] = [
  {
    id: 'seed-look-001',
    title: 'Spring Transition Outfit',
    photoUri: 'https://picsum.photos/seed/spring-transition/800/1200',
    items: [
      makeItem('item-001a', 'Outerwear', 'Linen Blazer', '89', '🧥', 101),
      makeItem('item-001b', 'Pants', 'Wide Leg Trousers', '65', '👖', 102),
      makeItem('item-001c', 'Shoes', 'Leather Loafers', '120', '👞', 103),
      makeItem('item-001d', 'Jewelry', 'Gold Hoops', '28', '✨', 104),
    ],
    layout: 'minimal-luxury',
    caption:
      'Spring is calling and I am ANSWERING 🌸 This linen blazer has been on repeat — throws over everything and instantly pulls a look together. Paired with my fave wide leg trousers and the comfiest loafers. Effortless but elevated!',
    hashtags: [
      '#SpringStyle',
      '#TransitionOutfit',
      '#LinenBlazer',
      '#OOTD',
      '#StyledInMotion',
      '#MinimalLuxury',
    ],
    createdAt: '2026-01-15T10:30:00.000Z',
    clicks: 142,
    archived: false,
  },
  {
    id: 'seed-look-002',
    title: 'Morning Workout Set',
    photoUri: 'https://picsum.photos/seed/morning-workout/800/1200',
    items: [
      makeItem('item-002a', 'Top', 'Sports Bra', '48', '🏋️‍♀️', 201),
      makeItem('item-002b', 'Pants', 'Leggings', '72', '🦵', 202),
      makeItem('item-002c', 'Shoes', 'Running Shoes', '135', '👟', 203),
      makeItem('item-002d', 'Accessory', 'Water Bottle', '38', '💧', 204),
    ],
    layout: 'bold-influencer',
    caption:
      '5 AM club check-in 💪🔥 There is something about a matching set that just hits different at the gym. This sports bra has the BEST support and these leggings? Squat proof, trust me. Lace up and let us go!',
    hashtags: [
      '#FitnessMotivation',
      '#GymOutfit',
      '#WorkoutStyle',
      '#ActiveWear',
      '#StyledInMotion',
      '#MorningRoutine',
    ],
    createdAt: '2026-01-28T06:15:00.000Z',
    clicks: 98,
    archived: false,
  },
  {
    id: 'seed-look-003',
    title: 'Errands but Make It Cute',
    photoUri: 'https://picsum.photos/seed/errands-cute/800/1200',
    items: [
      makeItem('item-003a', 'Top', 'Oversized Tee', '34', '👕', 301),
      makeItem('item-003b', 'Pants', 'Mom Jeans', '88', '👖', 302),
      makeItem('item-003c', 'Bag', 'Belt Bag', '45', '👜', 303),
      makeItem('item-003d', 'Accessory', 'Sunglasses', '29', '🕶️', 304),
    ],
    layout: 'cozy-neutral',
    caption:
      'Target run but make it fashion 😂🛒 The mom uniform that actually looks put together. This oversized tee is SO soft and the belt bag keeps my hands free for coffee and chaos. Mom life, styled life!',
    hashtags: [
      '#MomStyle',
      '#ErrandOutfit',
      '#CasualChic',
      '#MomLife',
      '#StyledInMotion',
      '#CozyNeutral',
    ],
    createdAt: '2026-02-10T14:00:00.000Z',
    clicks: 67,
    archived: false,
  },
  {
    id: 'seed-look-004',
    title: 'Date Night Done Right',
    photoUri: 'https://picsum.photos/seed/date-night/800/1200',
    items: [
      makeItem('item-004a', 'Dress', 'Wrap Dress', '110', '👗', 401),
      makeItem('item-004b', 'Shoes', 'Block Heels', '95', '👠', 402),
      makeItem('item-004c', 'Bag', 'Mini Bag', '75', '👛', 403),
      makeItem('item-004d', 'Jewelry', 'Gold Necklace', '42', '📿', 404),
    ],
    layout: 'minimal-luxury',
    caption:
      'He said "dress up" so I said SAY LESS 💃✨ This wrap dress is THE one — flattering on every body type and the color is *chef\'s kiss*. Block heels because we are walking to dinner and I am not about to suffer. Elegance meets comfort!',
    hashtags: [
      '#DateNight',
      '#WrapDress',
      '#EveningStyle',
      '#DressUp',
      '#StyledInMotion',
      '#MinimalLuxury',
    ],
    createdAt: '2026-02-22T18:45:00.000Z',
    clicks: 134,
    archived: false,
  },
  {
    id: 'seed-look-005',
    title: 'Start the Week Strong',
    photoUri: 'https://picsum.photos/seed/week-strong/800/1200',
    items: [
      makeItem('item-005a', 'Accessory', 'Motivational Journal', '24', '📓', 501),
      makeItem('item-005b', 'Accessory', 'Tumbler', '35', '🥤', 502),
      makeItem('item-005c', 'Outerwear', 'Cozy Cardigan', '67', '🧶', 503),
      makeItem('item-005d', 'Accessory', 'Wireless Earbuds', '89', '🎧', 504),
    ],
    layout: 'clean-grid',
    caption:
      'Monday mindset: locked in 🔒📝 My non-negotiables for a productive week — journal for brain dumps, tumbler so I actually drink water, cozy cardigan for WFH vibes, and earbuds for the focus playlist. Set yourself up to WIN!',
    hashtags: [
      '#MondayMotivation',
      '#ProductivityEssentials',
      '#WeeklyReset',
      '#Motivation',
      '#StyledInMotion',
      '#CleanGrid',
    ],
    createdAt: '2026-03-05T08:00:00.000Z',
    clicks: 53,
    archived: false,
  },
  {
    id: 'seed-look-006',
    title: 'Weekend Casual Perfection',
    photoUri: 'https://picsum.photos/seed/weekend-casual/800/1200',
    items: [
      makeItem('item-006a', 'Top', 'Striped Tee', '32', '🎽', 601),
      makeItem('item-006b', 'Pants', 'Shorts', '55', '🩳', 602),
      makeItem('item-006c', 'Shoes', 'Canvas Sneakers', '68', '👟', 603),
      makeItem('item-006d', 'Bag', 'Tote Bag', '44', '🛍️', 604),
    ],
    layout: 'cozy-neutral',
    caption:
      'Weekend mode: activated 🌤️ Sometimes simple is best — a classic striped tee, comfy shorts, and my go-to sneakers. Throw in a tote for farmers market finds and you are golden. Easy, breezy, weekend ready!',
    hashtags: [
      '#WeekendVibes',
      '#CasualStyle',
      '#StripedTee',
      '#WeekendOutfit',
      '#StyledInMotion',
      '#CozyNeutral',
    ],
    createdAt: '2026-03-18T11:30:00.000Z',
    clicks: 88,
    archived: false,
  },
];

export function initSeedData(lookStore: {
  getState: () => { looks: Look[] };
  setState: (partial: { looks: Look[] }) => void;
}) {
  const { looks } = lookStore.getState();
  const kerriLooks = looks.filter(l => l.creatorId === 'kerri-001' || (!l.creatorId && l.id.startsWith('seed-look-')));
  if (kerriLooks.length === 0) {
    const seeded = SEED_LOOKS.map(l => ({ ...l, creatorId: 'kerri-001' }));
    const nonKerri = looks.filter(l => l.creatorId && l.creatorId !== 'kerri-001');
    lookStore.setState({ looks: [...seeded, ...nonKerri] });
  } else {
    // Ensure existing seed looks have creatorId set
    const updated = looks.map(l =>
      l.id.startsWith('seed-look-') && !l.creatorId ? { ...l, creatorId: 'kerri-001' } : l
    );
    lookStore.setState({ looks: updated });
  }
}
