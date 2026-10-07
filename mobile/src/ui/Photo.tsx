import { useState } from 'react';
import { Linking, Modal, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useQuery } from '@tanstack/react-query';
import { Camera, Check, ImagePlus, X } from 'lucide-react-native';
import { api } from '../api/client';
import { font, space, useColors } from '../theme/tokens';
import { newIdempotencyKey as newId } from '../api/client';
import { T } from './Text';
import { Sheet, SheetOption } from './Sheet';
import { useReduceMotion } from '../lib/motion';

export interface CapturedPhoto {
  id: string;
  uri: string;
  contentType: string;
  size: number;
}

export class PermissionDenied extends Error {}

/**
 * Take or choose a photo, shrunk to 1600 px on the long edge and RE-ENCODED as
 * JPEG, which drops EXIF and GPS before anything leaves the phone (BRD §6.12).
 * The library uses the system's limited picker; the camera asks only when the
 * person chooses to take a photo (BRD §11).
 */
export async function capturePhoto(source: 'camera' | 'library'): Promise<CapturedPhoto | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new PermissionDenied(permission.canAskAgain ? 'Camera access is needed to take the photo.' : 'Camera access is off. Turn it on in Settings, or choose a photo instead.');
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  let uri = a.uri;
  try {
    const long = Math.max(a.width ?? 0, a.height ?? 0);
    const resize = long > 1600 ? [{ resize: (a.width ?? 0) >= (a.height ?? 0) ? { width: 1600 } : { height: 1600 } }] : [];
    const out = await manipulateAsync(a.uri, resize, { compress: 0.72, format: SaveFormat.JPEG });
    uri = out.uri;
  } catch {
    // keep the original
  }
  const blob = await (await fetch(uri)).blob().catch(() => null);
  return { id: newId(), uri, contentType: 'image/jpeg', size: blob?.size ?? a.fileSize ?? 0 };
}

/** A server photo by attachment id, via a 10-minute signed link (BRD §6.12). */
export function AttachmentImage({ id, style, contentFit = 'cover' }: { id: string; style?: StyleProp<ViewStyle>; contentFit?: 'cover' | 'contain' }) {
  const c = useColors();
  const q = useQuery({
    queryKey: ['attachment-url', id],
    queryFn: () => api.get<{ url: string }>(`/attachments/${id}/download-url`),
    enabled: Boolean(id),
    staleTime: 8 * 60_000,
    gcTime: 9 * 60_000,
  });
  return (
    <View style={[{ backgroundColor: c.ground2, overflow: 'hidden' }, style]}>
      {q.data?.url ? <Image source={{ uri: q.data.url }} style={{ width: '100%', height: '100%' }} contentFit={contentFit} transition={150} cachePolicy="memory-disk" recyclingKey={id} /> : null}
    </View>
  );
}

/** Full-screen viewer for one server photo. */
export function PhotoViewer({ id, visible, onClose }: { id: string | null; visible: boolean; onClose: () => void }) {
  const reduce = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduce ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' }} onPress={onClose} accessibilityLabel="Close photo">
        {id ? <AttachmentImage id={id} style={{ width: '100%', height: '78%' }} contentFit="contain" /> : null}
        <View style={{ position: 'absolute', top: 54, right: 20 }}>
          <X size={28} color="#FFFFFF" />
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * A photo slot in a form (receipt, quote, progress). Empty: a camera tile
 * with a "Required" mark when the form needs it. Filled: the thumbnail
 * with a tick; tap to replace or remove.
 */
export function PhotoSlot({
  label,
  photo,
  required,
  onChange,
  onError,
  testID,
}: {
  label: string;
  photo: CapturedPhoto | null;
  required?: boolean;
  onChange: (p: CapturedPhoto | null) => void;
  onError?: (message: string) => void;
  testID?: string;
}) {
  const c = useColors();
  const [choosing, setChoosing] = useState(false);
  const take = async (source: 'camera' | 'library') => {
    setChoosing(false);
    try {
      const p = await capturePhoto(source);
      if (p) onChange(p);
    } catch (e) {
      onError?.((e as Error).message);
      if (e instanceof PermissionDenied && /Settings/.test(e.message)) void Linking.openSettings().catch(() => undefined);
    }
  };
  const need = required && !photo;
  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={photo ? `${label} photo added. Change it` : `Add ${label.toLowerCase()} photo${required ? ', required' : ''}`}
        onPress={() => setChoosing(true)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          padding: 11,
          borderRadius: 16,
          backgroundColor: need ? c.warnTint : c.surface,
          borderWidth: need ? 1.5 : 1,
          borderStyle: need ? 'dashed' : 'solid',
          borderColor: need ? c.warn : c.line,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {photo ? (
          <Image source={{ uri: photo.uri }} style={{ width: 44, height: 52, borderRadius: 8 }} contentFit="cover" />
        ) : (
          <View style={{ width: 44, height: 52, borderRadius: 10, backgroundColor: c.goldTint, alignItems: 'center', justifyContent: 'center' }}>
            <Camera size={21} color={c.goldInk} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <T v="bodyStrong" style={{ fontSize: 14 }}>
            {label}
          </T>
          {photo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Check size={13} color={c.ok} strokeWidth={2.6} />
              <T style={{ fontFamily: font.semibold, fontSize: 12, color: c.ok }}>Added</T>
            </View>
          ) : (
            <T style={{ fontFamily: font.semibold, fontSize: 12, color: required ? c.goldInk : c.muted, marginTop: 3 }}>{required ? 'Required' : 'Optional'}</T>
          )}
        </View>
      </Pressable>
      <Sheet visible={choosing} onClose={() => setChoosing(false)} title={`${label} photo`}>
        <SheetOption label="Take a photo" onPress={() => void take('camera')} icon={<Camera size={20} color={c.ink} />} />
        <SheetOption label="Choose from library" onPress={() => void take('library')} icon={<ImagePlus size={20} color={c.ink} />} />
        {photo ? <SheetOption label="Remove photo" destructive onPress={() => { setChoosing(false); onChange(null); }} icon={<X size={20} color={c.danger} />} /> : null}
        <View style={{ height: space.xs }} />
      </Sheet>
    </>
  );
}
