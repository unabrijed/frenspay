// The four scenes, stacked and crossfading. Every one was cropped to put its
// waterline on the same row (apps/landing/scripts/scenes.mjs), so the sea holds
// still across a swap and only the land, sky and people rearrange.
//
// All four load eagerly — together they are ~270KB, and a slide arriving blank
// mid-rotation is worse than the bytes.
export type Scene = { word: string };

export function ThingsBackdrop({ scenes, index }: { scenes: readonly Scene[]; index: number }) {
  return (
    <div className="things-backdrop" aria-hidden="true">
      {scenes.map((scene, i) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={scene.word}
          className={`things-scene${i === index ? ' is-active' : ''}`}
          data-scene={scene.word}
          src={`/scenes/${scene.word}-2000.webp`}
          alt=""
          width={2000}
          height={861}
          decoding="async"
          fetchPriority={i === index ? 'high' : 'low'}
        />
      ))}
      <div className="things-scrim" />
    </div>
  );
}
