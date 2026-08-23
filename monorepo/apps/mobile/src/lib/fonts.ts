// Font assets to load at startup. Family names here become the `fontFamily` strings used
// throughout the app (see `fonts` in theme.ts). frenspay v2 has two faces and no third:
// Spectral says, JetBrains Mono marks (labels, counters, money columns).
//
// NOTE: apps/mobile is parked out of the yarn workspace, so these two packages are declared in
// its package.json but not installed here. Run `yarn install` inside apps/mobile when the app is
// resumed — see the Expo note in the repo README.
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Spectral_300Light,
  Spectral_400Regular,
  Spectral_500Medium,
  Spectral_600SemiBold,
} from '@expo-google-fonts/spectral';

export const fontMap = {
  Spectral_300Light,
  Spectral_400Regular,
  Spectral_500Medium,
  Spectral_600SemiBold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
};
