'use client';

// One paper plate behind everything. The file is a baked palindrome (forward +
// reverse), so native `loop` never shows a seam and no runtime fade is needed.
export function ThingsBackdrop({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="things-backdrop" aria-hidden="true">
      {reducedMotion ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/backdrops/paper.jpg" alt="" className="things-plate" />
      ) : (
        <video className="things-plate" poster="/backdrops/paper.jpg" autoPlay muted loop playsInline>
          <source src="/backdrops/paper.mp4" type="video/mp4" />
        </video>
      )}
      <div className="things-scrim" />
    </div>
  );
}
