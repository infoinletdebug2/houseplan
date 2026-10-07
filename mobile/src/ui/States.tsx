import { useOnline } from '../api/persist';
import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { radius, space, useColors } from '../theme/tokens';
import { IMAGES, type ImageKey } from '../assets/images';
import { ApiError, messageOf } from '../api/client';
import { T } from './Text';
import { Button } from './Button';

/** A designed empty state: an arched photo, one promise, one action. */
export function EmptyState({ image = 'placeholder', title, body, action, onAction, compact }: { image?: ImageKey; title: string; body?: string; action?: string; onAction?: () => void; compact?: boolean }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? space.lg : space.xxl, gap: space.sm }}>
      {/* The arched still: a fully rounded top, every empty state (blueprint C3). */}
      <View
        style={{
          width: compact ? 112 : 168,
          height: compact ? 92 : 140,
          borderTopLeftRadius: compact ? 56 : 84,
          borderTopRightRadius: compact ? 56 : 84,
          borderBottomLeftRadius: 16,
          borderBottomRightRadius: 16,
          overflow: 'hidden',
          marginBottom: space.xs,
          borderWidth: 1,
          borderColor: c.line,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Image source={IMAGES[image]} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      </View>
      <T v="h3" center>
        {title}
      </T>
      {body ? (
        <T v="small" center style={{ maxWidth: 300 }}>
          {body}
        </T>
      ) : null}
      {action && onAction ? <Button title={action} onPress={onAction} style={{ marginTop: space.sm, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const c = useColors();
  const offline = error instanceof ApiError && error.isOffline;
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.ground2, alignItems: 'center', justifyContent: 'center' }}>
        {offline ? <CloudOff size={26} color={c.muted} /> : <RefreshCw size={24} color={c.muted} />}
      </View>
      <T v="h3" center>
        {offline ? 'You’re offline' : 'That didn’t load'}
      </T>
      <T v="small" center style={{ maxWidth: 300 }}>
        {offline ? 'Showing what’s saved on this phone. Pull to refresh when you’re back online.' : messageOf(error)}
      </T>
      {onRetry ? <Button title="Try again" kind="outline" small onPress={onRetry} style={{ marginTop: space.xs }} /> : null}
    </View>
  );
}

export function Skeleton({ height = 64, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const o = useSharedValue(reduce ? 0.8 : 0.55);
  useEffect(() => {
    if (reduce) return; // Reduce Motion: a still placeholder, no pulse
    o.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height, borderRadius: radius.md, backgroundColor: c.ground2 }, anim, style]} />;
}

export function SkeletonList({ rows = 4, height = 64 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: space.sm }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}

/** "Offline · showing saved data" */
/** Shown only while the phone is offline; renders nothing otherwise. */
export function OfflineBanner() {
  const c = useColors();
  const online = useOnline();
  if (online) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.ground2 }} accessibilityLiveRegion="polite">
      <CloudOff size={16} color={c.muted} />
      <T v="small">Offline · showing saved data</T>
    </View>
  );
}
