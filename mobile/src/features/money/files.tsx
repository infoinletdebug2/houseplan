import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { Camera, FileText, ImagePlus, Paperclip } from 'lucide-react-native';
import { api, messageOf, upload, type ApiError } from '../../api/client';
import { capturePhoto, PermissionDenied } from '../../ui/Photo';
import { Sheet, SheetOption, useToast } from '../../ui/Sheet';
import { T } from '../../ui/Text';
import { font, radius, space, useColors } from '../../theme/tokens';
import { ago } from '../../lib/format';
import type { Attachment } from './types';

export type AttachmentTarget = 'quote' | 'cost' | 'payment' | 'phase' | 'procurement';
type Kind = 'receipt' | 'quote' | 'photo' | 'progress' | 'document';

/** The file as FormData: a Blob on the web, a {uri,name,type} part on a phone. */
async function formFor(uri: string, name: string, type: string, fields: Record<string, string>): Promise<FormData> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', new File([blob], name, { type }));
  } else {
    form.append('file', { uri, name, type } as unknown as Blob);
  }
  return form;
}

/**
 * Receipts, quote PDFs and progress photos on a record (BRD §6.12). Photos
 * are re-encoded on the phone first (drops EXIF/GPS); the server checks the
 * real file type, size and PDF contents. Up to 10 per record.
 */
export function Attachments({ projectId, target, targetId, kind, readOnly, title = 'Files' }: { projectId: string; target: AttachmentTarget; targetId: string; kind: Kind; readOnly?: boolean; title?: string }) {
  const c = useColors();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = ['p', projectId, 'attachments', target, targetId];
  const q = useQuery<Attachment[], ApiError>({ queryKey: key, queryFn: () => api.get<Attachment[]>('/attachments', { target_type: target, target_id: targetId }), enabled: Boolean(targetId) });

  const send = async (uri: string, name: string, type: string) => {
    setBusy(true);
    try {
      const form = await formFor(uri, name, type, { attachment_type: kind, project_id: projectId, target_type: target, target_id: targetId });
      await upload<Attachment>('/attachments', form);
      await qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['p', projectId] });
      toast.show('File added.');
    } catch (error) {
      toast.show(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const fromPhoto = async (source: 'camera' | 'library') => {
    setOpen(false);
    try {
      const photo = await capturePhoto(source);
      if (photo) await send(photo.uri, `${kind}-${photo.id.slice(0, 8)}.jpg`, 'image/jpeg');
    } catch (error) {
      toast.show(error instanceof PermissionDenied ? error.message : messageOf(error), 'error');
    }
  };

  const fromPdf = async () => {
    setOpen(false);
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;
    if ((a.size ?? 0) > 20 * 1024 * 1024) return toast.show('Files can be up to 20 MB.', 'error');
    await send(a.uri, a.name || 'document.pdf', 'application/pdf');
  };

  const openFile = async (a: Attachment) => {
    try {
      const { url } = await api.get<{ url: string }>(`/attachments/${a.id}/download-url`);
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      toast.show(messageOf(error), 'error');
    }
  };

  const files = q.data ?? [];
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="h3">{title}</T>
        {!readOnly && files.length < 10 ? (
          <T v="smallStrong" color={c.goldInk} onPress={() => setOpen(true)} accessibilityRole="button" suppressHighlighting>
            {busy ? 'Adding…' : 'Add a file ›'}
          </T>
        ) : null}
      </View>
      {files.length === 0 ? (
        <Pressable
          disabled={readOnly}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          style={{ borderRadius: radius.tile, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.line, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
        >
          <Paperclip size={18} color={c.muted} />
          <T v="small" style={{ flex: 1 }}>
            {readOnly ? 'No files.' : kind === 'receipt' ? 'Add the invoice or receipt: a photo or a PDF.' : kind === 'progress' ? 'Add progress photos.' : 'Add the quote PDF or a photo of it.'}
          </T>
        </Pressable>
      ) : (
        files.map((a) => (
          <Pressable key={a.id} onPress={() => void openFile(a)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderRadius: radius.tile, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            {a.mime === 'application/pdf' ? <FileText size={20} color={c.brand} /> : <ImagePlus size={20} color={c.brand} />}
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: font.semibold, fontSize: 14, color: c.ink }} numberOfLines={1}>
                {a.original_name ?? (a.mime === 'application/pdf' ? 'PDF document' : 'Photo')}
              </T>
              <T v="small">
                {Math.max(1, Math.round(a.size_bytes / 1024))} KB · added {ago(a.created_at)}
              </T>
            </View>
          </Pressable>
        ))
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Add a file" subtitle="Photos lose their location data before they leave your phone.">
        <SheetOption label="Take a photo" icon={<Camera size={20} color={c.ink} />} onPress={() => void fromPhoto('camera')} />
        <SheetOption label="Choose a photo" icon={<ImagePlus size={20} color={c.ink} />} onPress={() => void fromPhoto('library')} />
        <SheetOption label="Choose a PDF" icon={<FileText size={20} color={c.ink} />} onPress={() => void fromPdf()} />
      </Sheet>
    </View>
  );
}
