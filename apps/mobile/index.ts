import { registerRootComponent } from 'expo';

// Imported for its side effect: TaskManager.defineTask must run in global
// scope so headless (WorkManager) launches find the sync task.
import './src/background.ts';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
