import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, TextInput, View, type ScrollView, type StyleProp, type ViewStyle } from 'react-native';

const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/**
 * Keeps a form and its bottom bar above the keyboard.
 *
 * iOS: React Native's KeyboardAvoidingView (padding).
 *
 * Android: this app is edge-to-edge, so the window does NOT shrink for the
 * keyboard — fields were hidden under it. KeyboardAvoidingView is not used
 * there because it re-measures its own frame after adding padding, which can
 * oscillate (the "dancing" fields). Instead the OUTER view — whose size never
 * depends on the padding — is measured once when the keyboard opens, and the
 * inner view gets exactly the covered height as bottom padding. One change per
 * open, one per close.
 */
export function KeyboardArea({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const outer = useRef<View>(null);
  const [covered, setCovered] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'ios') return;
    const show = Keyboard.addListener(SHOW, (e) => {
      const top = e.endCoordinates.screenY;
      outer.current?.measureInWindow((_x, y, _w, h) => {
        const overlap = Math.max(0, Math.round(y + h - top));
        setCovered(overlap);
      });
    });
    const hide = Keyboard.addListener(HIDE, () => setCovered(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView behavior="padding" style={[{ flex: 1 }, style]}>
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <View ref={outer} style={[{ flex: 1 }, style]} collapsable={false}>
      <View style={{ flex: 1, paddingBottom: covered }}>{children}</View>
    </View>
  );
}

/**
 * When the keyboard opens, scroll the focused field into view (about a third
 * of the way down), once. Works with any ScrollView by ref.
 */
export function useRevealFocused(scroll: React.RefObject<ScrollView | null>) {
  useEffect(() => {
    const sub = Keyboard.addListener(SHOW, () => {
      // Let the padding above settle first.
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput() as unknown as { measureLayout?: (rel: unknown, ok: (x: number, y: number) => void, fail?: () => void) => void } | null;
        const sv = scroll.current as unknown as { getInnerViewRef?: () => unknown; scrollTo: (o: { y: number; animated: boolean }) => void } | null;
        if (!input?.measureLayout || !sv) return;
        const content = sv.getInnerViewRef?.() ?? sv;
        input.measureLayout(
          content,
          (_x, y) => sv.scrollTo({ y: Math.max(0, y - 140), animated: true }),
          () => undefined,
        );
      }, Platform.OS === 'ios' ? 50 : 120);
    });
    return () => sub.remove();
  }, [scroll]);
}
