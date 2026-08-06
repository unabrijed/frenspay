export const SOFT_EASE = [0.22, 1, 0.36, 1] as const;
export const PAPER_EASE = [0.76, 0, 0.24, 1] as const;

export const NOTE_MOTION = {
  headlineDelay: 0.1,
  headlineDuration: 0.72,
  noteDelay: 0.18,
  noteDuration: 1.04,
  layerStagger: 0.07,
  wordHoldMs: 1550,
  wordTransition: 0.56,
  idleDuration: 9,
} as const;

export const STORY_RANGES: Record<'centre' | 'open' | 'lengthen' | 'resolve', [number, number]> = {
  centre: [0.04, 0.22],
  open: [0.2, 0.5],
  lengthen: [0.46, 0.76],
  resolve: [0.74, 0.96],
};
