import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, CircleAlert, Info } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { font, space, useColors } from '../theme/tokens';
import { T } from './Text';
import { Button } from './Button';

/** A bottom sheet: grabber, serif title, dims what is behind it. */
export function Sheet({ visible, onClose, title, subtitle, children, scroll }: { visible: boolean; onClose: () => void; title?: string; subtitle?: string; children: React.ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ backgroundColor: c.ground, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + space.lg }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: space.md }} />
          {title ? (
            <T v="h3" style={{ marginBottom: subtitle ? 4 : space.md }} accessibilityRole="header">
              {title}
            </T>
          ) : null}
          {subtitle ? (
            <T v="small" style={{ marginBottom: space.md }}>
              {subtitle}
            </T>
          ) : null}
          {scroll ? (
            <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A confirmation that names what will happen. */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  destructive,
  loading,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <T v="body" style={{ marginBottom: space.lg, color: undefined }}>
        {message}
      </T>
      {children}
      <View style={{ gap: space.xs, marginTop: children ? space.lg : 0 }}>
        <Button title={confirmLabel} kind={destructive ? 'danger' : 'primary'} onPress={onConfirm} loading={loading} />
        <Button title="Cancel" kind="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** One option row in an action/picker sheet. */
export function SheetOption({ label, hint, onPress, selected, icon, destructive }: { label: string; hint?: string; onPress: () => void; selected?: boolean; icon?: React.ReactNode; destructive?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: selected ? c.primaryTint : pressed ? c.ground2 : 'transparent',
      })}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" color={destructive ? c.danger : c.ink}>
          {label}
        </T>
        {hint ? <T v="small">{hint}</T> : null}
      </View>
      {selected ? <CircleCheck size={20} color={c.scheme === 'dark' ? c.gold2 : c.primary} /> : null}
    </Pressable>
  );
}

/* ── toasts ───────────────────────────────────────────────────────────── */

type ToastTone = 'ok' | 'error' | 'info';
interface ToastValue {
  show(message: string, tone?: ToastTone): void;
}
const ToastContext = createContext<ToastValue>({ show: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; key: number } | null>(null);
  const opacity = useRef(new RNAnimated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, tone: ToastTone = 'ok') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, tone, key: Date.now() });
      if (tone === 'ok') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (tone === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      RNAnimated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        RNAnimated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
      }, tone === 'error' ? 4200 : 2600);
    },
    [opacity],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const Icon = toast?.tone === 'error' ? CircleAlert : toast?.tone === 'info' ? Info : CircleCheck;
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <RNAnimated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 8, opacity, zIndex: 50 }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 13,
              paddingHorizontal: 16,
              borderRadius: 16,
              backgroundColor: toast.tone === 'error' ? c.danger : '#17332E',
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 8,
            }}
          >
            <Icon size={20} color={toast.tone === 'error' ? '#FFFFFF' : '#7FD1BC'} />
            <T style={{ fontFamily: font.medium, fontSize: 14.5, color: '#FFFFFF', flex: 1 }}>{toast.message}</T>
          </View>
        </RNAnimated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  return useContext(ToastContext);
}
