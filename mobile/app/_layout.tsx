import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Newsreader_500Medium, Newsreader_600SemiBold, Newsreader_700Bold } from '@expo-google-fonts/newsreader';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../src/auth/context';
import { ApiError } from '../src/api/client';
import { ToastProvider } from '../src/ui/Sheet';
import { useColors } from '../src/theme/tokens';
import { installNotificationHandlers, registerPush } from '../src/notifications/push';
import { appOpened, askTrackingOnce, retryConsentSync, sendAttribution } from '../src/lib/analytics';
import { noteFirstUse } from '../src/lib/review';
import { wireOnlineManager } from '../src/api/persist';
import { loadAppearance } from '../src/lib/appearance';

/**
 * The root. Gates: fonts → stored session → the app. Routing decisions live
 * in ONE place, app/index.tsx; this layout only ejects a person whose session
 * disappeared back to discovery (one-directional).
 */

SplashScreen.preventAutoHideAsync().catch(() => undefined);
wireOnlineManager();
void loadAppearance();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => (error instanceof ApiError && !error.isOffline ? false : count < 2),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    // Writes are attempted even offline, so the person gets a clear "not saved".
    mutations: { retry: false, networkMode: 'always' },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Newsreader_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <AppShell />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** First route segments a signed-out person may stay on. */
const PUBLIC = new Set(['discover', 'sign-in', 'register', 'forgot-password', 'auth', 'legal', 'support-public', 'index', '']);

function AppShell() {
  const { loading, session, me } = useAuth();
  const c = useColors();
  const router = useRouter();
  const segments = useSegments() as string[];

  // Eject on sign-out: clearing auth state does not navigate anyone.
  // One-directional: never bounce a signed-in person off a form.
  useEffect(() => {
    if (loading || session) return;
    if (PUBLIC.has(segments[0] ?? '')) return;
    router.replace('/discover');
  }, [loading, session, segments, router]);

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync().catch(() => undefined);
  }, [loading]);

  // iOS tracking prompt: only once the projects screen is on screen, and a
  // no-op unless Meta is configured AND advertising consent was given.
  const onHome = segments.includes('projects');
  useEffect(() => {
    if (!onHome || !session) return;
    const t = setTimeout(() => void askTrackingOnce(), 1500);
    return () => clearTimeout(t);
  }, [onHome, session]);

  useEffect(() => {
    appOpened();
  }, []);

  useEffect(() => {
    if (!me?.user.id) return;
    void noteFirstUse();
    retryConsentSync();
    sendAttribution(me.user.id);
  }, [me?.user.id]);

  // Push: re-register a device that already allowed it; taps route inside entitlement checks.
  const paid = Boolean(me?.entitlement.access);
  useEffect(() => {
    if (!session || !paid) return;
    void registerPush();
    let cleanup: (() => void) | undefined;
    void installNotificationHandlers((route) => router.push(route as never)).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [session, paid, router]);

  if (loading) return <View style={{ flex: 1, backgroundColor: c.ground }} />;

  return (
    <View style={{ flex: 1, backgroundColor: c.ground }}>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.ground }, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="discover" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="paywall" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="verify-email" options={{ gestureEnabled: false }} />
        <Stack.Screen name="purchase-status" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
    </View>
  );
}
