import { SettingsRoot } from '../../src/settings/SettingsRoot';
import { useTabBarSpace } from '../../src/ui/TabBar';

/** Settings tab: the same screen as /settings, with room for the tab bar. */
export default function SettingsTab() {
  return <SettingsRoot tab bottomPad={useTabBarSpace()} />;
}
