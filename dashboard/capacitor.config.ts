import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.substrate.dashboard',
  appName: 'Substrate',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },
  server: {
    androidScheme: 'http',
    cleartext: true,
    hostname: 'substrate.local',
    allowNavigation: ['*'],
  },
};

export default config;
