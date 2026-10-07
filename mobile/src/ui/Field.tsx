import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View, useWindowDimensions, type KeyboardTypeOptions, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { font, radius, useColors } from '../theme/tokens';
import { T } from './Text';

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  /** Big serif value (amounts, litres). */
  big?: boolean;
  suffix?: string;
  prefix?: string;
  /** A suggested value (from a room or rate): highlighted until the person edits it. */
  suggested?: boolean;
  style?: StyleProp<ViewStyle>;
  secure?: boolean;
  /** A leading icon (auth forms): sits left of the label and value. */
  icon?: React.ReactNode;
  /** Rendered under the field, above the error/hint (a password meter). */
  below?: React.ReactNode;
}

/**
 * A labelled field. Errors name the field and the fix; the label stays
 * visible while typing. `minWidth: 0` and `borderWidth: 0` on the input keep
 * the web build honest (knowledge/traps.md).
 */
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, hint, big, suffix, prefix, suggested, style, secure, icon, below, ...input }, ref) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  // Larger system text must never make the label and the value collide: the
  // compact icon field grows with the font scale (capped like every input).
  const scale = Math.min(Math.max(useWindowDimensions().fontScale || 1, 1), INPUT_MAX_SCALE);
  const inner = useRef<TextInput>(null);
  useImperativeHandle(ref, () => inner.current as TextInput);
  const border = error ? c.danger : focused ? c.primary : suggested ? c.warn : c.line;
  const labelColor = error ? c.danger : focused ? c.primary : c.muted;
  // Android adds font padding above and below text; without this the value sits
  // off-centre next to the icon and the row height differs between platforms.
  const androidText = Platform.OS === 'android' ? ({ includeFontPadding: false, textAlignVertical: 'center' } as const) : Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

  const textInput = (extra?: object) => (
    <TextInput
      ref={inner}
      {...input}
      secureTextEntry={secure ? hidden : false}
      placeholderTextColor={c.faint}
      onFocus={(e) => {
        setFocused(true);
        input.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        input.onBlur?.(e);
      }}
      accessibilityLabel={label}
      maxFontSizeMultiplier={INPUT_MAX_SCALE}
      style={[
        {
          flex: 1,
          minWidth: 0,
          borderWidth: 0,
          padding: 0,
          color: c.ink,
          fontFamily: big ? font.display : font.body,
          fontSize: big ? 26 : 16,
          fontVariant: big ? ['tabular-nums'] : undefined,
        },
        androidText,
        extra,
      ]}
    />
  );
  const eye = secure ? (
    <Pressable onPress={() => setHidden((h) => !h)} accessibilityLabel={hidden ? 'Show password' : 'Hide password'} hitSlop={12} style={{ paddingLeft: 8 }}>
      {hidden ? <Eye size={19} color={c.muted} /> : <EyeOff size={19} color={c.muted} />}
    </Pressable>
  ) : null;
  const footerText = (
    <>
      {below}
      {error ? (
        <T v="small" color={c.danger} style={{ marginTop: 5, marginLeft: 4 }} accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : hint ? (
        <T v="small" style={{ marginTop: 5, marginLeft: 4 }}>
          {hint}
        </T>
      ) : null}
    </>
  );

  /**
   * With an icon (sign-in, create account, reset, change password): a fixed
   * 64-pt row so the box never changes size. Empty and unfocused, the label
   * sits on the icon's line like a placeholder; on focus or with a value it
   * moves up small and the text takes the icon's line. One row, one alignment.
   */
  if (icon && !input.multiline) {
    const resting = !focused && !input.value && !input.placeholder;
    const left = 14 + 22 + 12; // padding + icon + gap
    return (
      <View style={style}>
        {/*
          The TextInput fills the whole box and NEVER moves or resizes, whatever the
          state. Icon, label and eye are drawn over it with pointerEvents="none"
          (except the eye), so a tap always lands on this field's input and nothing
          shifts under the finger while the keyboard opens.
        */}
        <View style={{ height: Math.round(64 * scale), borderRadius: radius.input + 2, borderWidth: 1.5, borderColor: border, backgroundColor: c.surface, overflow: 'hidden' }}>
          {textInput({
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            height: undefined,
            flex: undefined,
            paddingLeft: left,
            paddingRight: secure ? 48 : 14,
            paddingTop: Math.round(24 * scale),
            paddingBottom: Math.round(8 * scale),
            ...(Platform.OS === 'android' ? { textAlignVertical: 'top' } : null),
          })}
          <View pointerEvents="none" style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 22, alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </View>
          <View pointerEvents="none" style={resting ? { position: 'absolute', left, right: 14, top: 0, bottom: 0, justifyContent: 'center' } : { position: 'absolute', left, right: 14, top: Math.round(9 * scale) }}>
            <T style={resting ? { fontFamily: font.body, fontSize: 16, lineHeight: 22, color: c.muted } : { fontFamily: font.medium, fontSize: 12, lineHeight: 15, color: labelColor }} numberOfLines={1} maxFontSizeMultiplier={INPUT_MAX_SCALE}>
              {label}
            </T>
          </View>
          {eye ? <View style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>{eye}</View> : null}
        </View>
        {footerText}
      </View>
    );
  }

  return (
    <View style={style}>
      <View
        style={{
          backgroundColor: suggested && !focused ? (c.warnTint) : c.surface,
          borderWidth: 1.5,
          borderColor: border,
          borderRadius: radius.input + 2,
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: big ? 10 : 9,
        }}
      >
        <T style={{ fontFamily: font.medium, fontSize: 12, color: labelColor }}>{label}</T>
        <View style={{ flexDirection: 'row', alignItems: input.multiline ? 'flex-start' : 'center', gap: 6, marginTop: 4, minHeight: big ? 34 : 24 }}>
          {prefix ? <T style={{ fontFamily: big ? font.display : font.medium, fontSize: big ? 24 : 16, color: c.ink }}>{prefix}</T> : null}
          {textInput()}
          {suffix ? <T style={{ fontFamily: font.medium, fontSize: 14, color: c.muted }}>{suffix}</T> : null}
          {eye}
        </View>
      </View>
      {footerText}
    </View>
  );
});

/** Inputs and the labels drawn over them scale with system text up to this much. */
export const INPUT_MAX_SCALE = 1.4;

export const decimalPad: KeyboardTypeOptions = 'decimal-pad';
export const numberPad: KeyboardTypeOptions = 'number-pad';

/** A tappable row that looks like a field (opens a picker). */
export function PickerField({ label, value, placeholder, onPress, error, icon }: { label: string; value?: string | null; placeholder?: string; onPress: () => void; error?: string; icon?: React.ReactNode }) {
  const c = useColors();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder ?? ''}`}
        onPress={onPress}
        style={({ pressed }) => ({ backgroundColor: c.surface, borderWidth: 1.5, borderColor: error ? c.danger : c.line, borderRadius: radius.input + 2, paddingHorizontal: 14, paddingVertical: 10, opacity: pressed ? 0.85 : 1 })}
      >
        <T style={{ fontFamily: font.medium, fontSize: 12, color: c.muted }}>{label}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <T v="body" color={value ? c.ink : c.faint} style={{ flex: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {value || placeholder || 'Choose'}
          </T>
          {icon}
        </View>
      </Pressable>
      {error ? (
        <T v="small" color={c.danger} style={{ marginTop: 5, marginLeft: 4 }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}
