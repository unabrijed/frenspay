export const FRENSPAY_COPY = {
  headline: ['frens pay.', 'frens get paid.'],
  supporting: 'something for people who know people.',
  words: ['play', 'stay', 'relay', 'pay'],
  captions: {
    play: 'where it starts.',
    stay: 'the ones who stick.',
    relay: 'pass it on.',
  },
  mystery: ['What happens between frens', 'stays between frens.'],
  interruption: 'mostly.',
  fragments: [
    'f-you',
    'f-us',
    'f-sent',
    'f-received',
    'f-found',
    'f-coming',
    'fyi',
    'considered settled',
    'pass it on',
  ],
  fList: 'join the f-list',
  success: 'fyi, you’re in.',
  final: 'you’ll know when you’re in.',
} as const;

export type WordStripWord = (typeof FRENSPAY_COPY.words)[number];
