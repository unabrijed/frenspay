'use client';

// /account/install — put the console on the home screen. Nothing of ours installs: the browser does it,
// and each one hides the option somewhere different, so this screen only says where. Android Chrome
// offers a real prompt we can hold and open from a button; iOS only ever does it from the share sheet.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BackButton } from '@fpay/ui/BackButton';
import { Btn } from '@fpay/ui/Button';
import { ScrollView, View } from '@fpay/ui/rn';
import { Screen } from '@fpay/ui/Screen';
import { Txt } from '@fpay/ui/Txt';
import { styles } from '@/components/OneField';
import { type } from '@fpay/ui/theme';

type InstallPrompt = Event & { prompt: () => Promise<unknown> };

export default function Install() {
  const router = useRouter();
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    // Chrome fires this once it deems the page installable. Holding it lets our button open it.
    const hold = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', hold);
    return () => window.removeEventListener('beforeinstallprompt', hold);
  }, []);

  return (
    <Screen edges={['top']} style={styles.safe}>
      <View style={styles.head}>
        <BackButton onPress={() => router.push('/account')} />
      </View>
      <ScrollView style={styles.scroll}>
        <Txt style={type.handle}>Add to home screen</Txt>
        <Txt style={[type.lead, { marginTop: 8 }]}>Opens full screen like an app, one tap from your home screen.</Txt>
        {ios ? (
          <Txt style={[type.lead, { marginTop: 6 }]}>In Safari, tap Share, then Add to Home Screen.</Txt>
        ) : prompt ? (
          <View style={{ marginTop: 18 }}>
            <Btn label="Add to home screen" variant="primary" onPress={() => void prompt.prompt()} />
          </View>
        ) : (
          <Txt style={[type.lead, { marginTop: 6 }]}>Open the browser menu and tap Install app, or Add to Home screen.</Txt>
        )}
      </ScrollView>
    </Screen>
  );
}
