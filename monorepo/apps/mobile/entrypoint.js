// Polyfills required by @privy-io/expo — these MUST run before any other import.
// (Privy React Native install guide: https://docs.privy.io/basics/react-native/installation)
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';

// Hand off to expo-router's normal entry. `package.json` "main" points here instead of
// "expo-router/entry" so the polyfills load first; routing/behaviour is otherwise unchanged.
import 'expo-router/entry';
