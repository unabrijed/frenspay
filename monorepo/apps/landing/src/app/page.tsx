import { HeroCopy } from '@/components/frenspay/hero-copy';
import { MysteryCopy } from '@/components/frenspay/mystery-copy';
import { Navigation } from '@/components/frenspay/navigation';
import { NoteStory } from '@/components/frenspay/note-story';

export default function Page() {
  return (
    <>
      <Navigation />
      <main>
        <NoteStory heroCopy={<HeroCopy />} mysteryCopy={<MysteryCopy />} />
      </main>
    </>
  );
}
