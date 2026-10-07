import { Redirect, Tabs } from 'expo-router';
import { BrainCircuit, Calculator, Home, Settings2 } from 'lucide-react-native';
import { TabBar, type BarProps } from '../../src/ui/TabBar';
import { useAuth } from '../../src/auth/context';

/**
 * Bottom tabs after entitlement (BRD §7): Projects · Calculators · Advisor ·
 * Settings, on our own tab bar. Every tab route checks access itself; hiding
 * navigation is never the guard (BRD §11).
 */
export default function TabsLayout() {
  const { session, me, needsPaywall, needsVerification, needsTerms, needsOnboarding } = useAuth();
  if (!session) return <Redirect href="/discover" />;
  if (me && (needsVerification || needsTerms || needsOnboarding || needsPaywall)) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <TabBar
          {...(props as unknown as BarProps)}
          icons={{
            projects: (c) => <Home size={22} color={c} />,
            calculators: (c) => <Calculator size={22} color={c} />,
            advisor: (c) => <BrainCircuit size={22} color={c} />,
            settings: (c) => <Settings2 size={22} color={c} />,
          }}
        />
      )}
    >
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="calculators" options={{ title: 'Calculators' }} />
      <Tabs.Screen name="advisor" options={{ title: 'Advisor' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
